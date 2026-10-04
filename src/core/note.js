/* eslint-disable */
// 云笔记（friday / 优客畅学）适配层
// 笔记 = 客户端上传到 OSS 的资源包，包含 1..N 页 + 全局/页面级元数据（mdb）。
// 两种笔记格式：
//   - 旧笔记（old）：全局 data.mdb / lock.mdb + 每页 <UUID>_touch.bin 笔触文件
//   - 新笔记（new）：每页独立 <UUID>.mdb / <UUID>.lock.mdb + 每页 <UUID>_touch.bin 笔触文件
// 渲染所需最小集：header.bin / snapshot.bin / res/image/* / <UUID>_touch.bin
// EzyBoardViewer 自身已支持这套文件结构，NoteViewer 通过 openSource 复用其渲染。
import { openSource, convert, mergeSvgs, pb, A, S, I } from './board.js'

const NOTE_PAGE_RE = /^(.+)\/(header|snapshot)\.bin$/i
const MDB_RE = /^.*\.mdb$/i
const LOCK_MDB_RE = /^.*\.lock\.mdb$/i
const TOUCH_RE = /^.*_touch\.bin$/i
const ROUTER_NAME = 'page_router.bin'

/** 笔记格式（基于逆向 FileManager.getFinalDownloadList 的判断规则） */
export const NOTE_FORMAT = { OLD: 'old', NEW: 'new', UNKNOWN: 'unknown' }

/**
 * 探测笔记格式（基于文件路径启发式，不读取 mdb 内容）。
 * - 出现任意 `.mdb`（lock.mdb 除外）→ 新笔记
 *   依据 APK FileManager.getFinalDownloadList：只要页内含 `.mdb` 就按“新笔记规则”处理，
 *   此时笔触**不再单独上传** `*_touch.bin`，而是由 `page_mdb/data.mdb`（ObjectBox）承载，
 *   NoteViewer 会现场解析 mdb 合成 TouchSource（见 core/mdb.js）。
 * - 没有 mdb、但有 `*_touch.bin` / `header.bin` / `snapshot.bin` → 旧笔记（每段笔触一个独立文件）
 * - 都没有 → unknown（仍可按 EzyBoardViewer 静态方式渲染）
 */
export function detectNoteFormat(fileNames) {
  const all = (fileNames || []).map(n => String(n).replace(/\\/g, '/').replace(/^\/+/, ''))
  if (!all.length) return NOTE_FORMAT.UNKNOWN
  const hasMdb = all.some(n => MDB_RE.test(n) && !LOCK_MDB_RE.test(n))
  if (hasMdb) return NOTE_FORMAT.NEW
  const hasTouch = all.some(n => TOUCH_RE.test(n))
  const hasPageData = all.some(n => NOTE_PAGE_RE.test(n))
  if (hasTouch || hasPageData) return NOTE_FORMAT.OLD
  return NOTE_FORMAT.UNKNOWN
}

/* ---------- 内部：解析页面列表（接收已 openSource 的 zip） ---------- */
async function resolvePagesFromZip(zip) {
  const routerEntry = zip.names.find(n => n.split('/').pop() === ROUTER_NAME)
  if (routerEntry) {
    const root = routerEntry.slice(0, routerEntry.lastIndexOf('/') + 1)
    const out = []
    try {
      const buf = await zip.read(routerEntry)
      for (const [i, m] of A(pb(buf), 1).entries()) {
        const dir = root + (S(m, 1) || '') + '/'
        out.push({ dir, idx: I(m, 2, i) })
      }
      out.sort((a, b) => a.idx - b.idx)
      if (out.length) return out
    } catch { /* fall through */ }
  }
  const seen = new Set()
  const out = []
  for (const n of zip.names) {
    const m = n.match(NOTE_PAGE_RE)
    if (!m) continue
    const dir = m[1] + '/'
    if (seen.has(dir)) continue
    seen.add(dir)
    out.push({ dir, idx: out.length })
  }
  return out
}

/**
 * 解析页面顺序：接受任意 BoardSource（zip / 文件列表 / URL）或已 openSource 的 zip。
 */
export async function resolvePages(source, options = {}) {
  const zip = source && source.names ? source : await openSource(source, options.fetchOptions)
  return resolvePagesFromZip(zip)
}

/**
 * 计算整篇笔记的元信息：格式、页数、是否包含笔触/图片等。
 * 接受任意 BoardSource（zip / 文件列表 / URL），内部统一走 openSource。
 */
export async function inspectNote(source, options = {}) {
  const zip = source && source.names ? source : await openSource(source, options.fetchOptions)
  const names = zip.names || []
  const format = detectNoteFormat(names)
  const pages = await resolvePagesFromZip(zip)
  const touchFiles = names.filter(n => TOUCH_RE.test(n))
  const imageFiles = names.filter(n => /res\/image\//i.test(n))
  const hasMdb = names.some(n => MDB_RE.test(n) && !LOCK_MDB_RE.test(n))
  return {
    format,
    pages: pages.length,
    pageDirs: pages,
    touchCount: touchFiles.length,
    imageCount: imageFiles.length,
    hasMdb,
    /** 笔触是否来自 mdb 现场解析（新笔记没有 *_touch.bin，仅有 mdb） */
    touchFromMdb: hasMdb && touchFiles.length === 0
  }
}

/* ---------- 辅助：每页一张 SVG ---------- */
/**
 * 把笔记渲染为每页一张 SVG 字符串。
 * 直接复用 convert()（已支持 page_router.bin + snapshot.bin + res/image）。
 */
export async function noteToSvgs(source, options = {}) {
  const z = await openSource(source, options.fetchOptions)
  const list = await convert(z)
  return list.map(r => (r.err ? { error: r.err } : { svg: r.svg }))
}

/**
 * 把笔记所有页 SVG 合并为单个 Blob（多页纵向合并）。
 */
export async function noteToSvgBlob(source, options = {}) {
  const z = await openSource(source, options.fetchOptions)
  const list = await convert(z)
  return new Blob([mergeSvgs(list)], { type: 'image/svg+xml' })
}

/**
 * 提取笔记某一页的 SVG（用于缩略图）。
 * 与 noteToSvgs 同样的来源，但只返回目标索引的那一项。
 */
export async function notePageSvg(source, pageIndex, options = {}) {
  const z = await openSource(source, options.fetchOptions)
  const list = await convert(z)
  if (!list.length) return null
  const target = Math.min(Math.max(pageIndex | 0, 0), list.length - 1)
  const r = list[target]
  return r && r.svg ? r.svg : null
}
