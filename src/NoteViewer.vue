<script setup>
import { ref, shallowRef, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import {
  ElButton, ElIcon, ElAlert, ElMessage, ElProgress
} from 'element-plus'
import {
  ArrowLeft, ArrowRight, Loading, Close,
  Document, Picture, Files, FolderOpened
} from '@element-plus/icons-vue'
import { openSource, convert, pb, M, S, A } from './core/board.js'
import { buildTouchSourceFromMdb, collectTouchRefs } from './core/mdb.js'
import { inspectNote, NOTE_FORMAT } from './core/note.js'
import EzyBoardViewer from './EzyBoardViewer.vue'

defineOptions({ name: 'NoteViewer' })

const props = defineProps({
  /** zip（Blob / File / ArrayBuffer / Uint8Array / URL 字符串）、文件列表 [{ path, blob }] */
  source: { type: [Blob, String, ArrayBuffer, Array, Object], default: null },
  /** 'auto' 自动识别（推荐）；也可强制 'old' / 'new' */
  format: { type: String, default: 'auto' },
  /** 起始页（1-based）。默认 1 */
  initialPage: { type: Number, default: 1 },
  /** 是否显示左侧缩略图栏（侧边栏为页面快照）。默认 true */
  showPages: { type: Boolean, default: true },
  /** 是否显示顶部笔记元信息（页数 / 格式）。默认 true */
  showMeta: { type: Boolean, default: true },
  /** 缩放范围，相对"适应窗口"的倍数 */
  minZoom: { type: Number, default: 0.25 },
  maxZoom: { type: Number, default: 8 },
  /** 导出文件名（不含扩展名）。默认 'note' */
  fileName: { type: String, default: 'note' },
  fetchOptions: { type: Object, default: undefined },
  /** 右键 / 长按菜单 */
  contextMenu: { type: Boolean, default: true }
})

const emit = defineEmits(['loaded', 'error', 'pagechange'])

/* ---------------- 状态 ---------------- */
const phase = ref('idle')                  // idle | loading | ready | error
const errMsg = ref('')
const format = shallowRef(NOTE_FORMAT.UNKNOWN)
const pageDirs = shallowRef([])            // [{ dir, idx }]
const touchCount = ref(0)
const imageCount = ref(0)
const hasMdb = ref(false)
/** 笔触来自 mdb 现场解析（新笔记：无 *_touch.bin 文件） */
const touchFromMdb = ref(false)
const currentPage = ref(Math.max(1, props.initialPage | 0))
const boardSource = shallowRef(null)       // 当前页给 EzyBoardViewer 的 source
const boardLoading = ref(false)
const boardError = ref('')
const exporting = ref(null)                // { stage, frac }

/* 当前页对应的 BoardFile[] 缓存（按 dir 索引），避免重复拉 blob */
const fileCache = new Map()                // dir → BoardFile[]

let zip = null, token = 0
const pages = computed(() => pageDirs.value.length)
const totalPages = pages
const canPrev = computed(() => currentPage.value > 1)
const canNext = computed(() => currentPage.value < totalPages.value)
const formatLabel = computed(() => ({
  [NOTE_FORMAT.OLD]: '旧笔记',
  [NOTE_FORMAT.NEW]: '新笔记',
  [NOTE_FORMAT.UNKNOWN]: '未知格式'
}[format.value] || '未知格式'))
const formatTitle = computed(() => ({
  [NOTE_FORMAT.OLD]: '旧笔记：笔触为独立 *_touch.bin 文件，直接读取',
  [NOTE_FORMAT.NEW]: '新笔记：笔触存放于 page_mdb/data.mdb（ObjectBox），查看器现场解析',
  [NOTE_FORMAT.UNKNOWN]: '未识别到 mdb 数据库（可能笔记缺少资源或不是标准格式）'
}[format.value] || ''))

/* ---------------- 载入笔记 ---------------- */
function dispose() {
  fileCache.clear()
  zip = null
  boardSource.value = null
  pageDirs.value = []
  touchCount.value = 0
  imageCount.value = 0
  hasMdb.value = false
  touchFromMdb.value = false
  format.value = NOTE_FORMAT.UNKNOWN
  boardError.value = ''
}

async function load() {
  if (typeof window === 'undefined') return
  const my = ++token
  dispose()
  if (!props.source) { phase.value = 'idle'; return }
  phase.value = 'loading'
  try {
    zip = await openSource(props.source, props.fetchOptions)
    if (my !== token) return
    const info = await inspectNote(zip)
    if (my !== token) return
    pageDirs.value = info.pageDirs
    touchCount.value = info.touchCount
    imageCount.value = info.imageCount
    hasMdb.value = info.hasMdb
    touchFromMdb.value = !!info.touchFromMdb
    // 'auto'：使用启发式探测的结果；指定值则按指定
    format.value = props.format === 'auto' ? info.format : props.format
    if (!info.pageDirs.length) throw Error('没有可显示的笔记页面（缺少 snapshot.bin / header.bin）')
    currentPage.value = Math.min(Math.max(1, props.initialPage | 0), info.pageDirs.length)
    phase.value = 'ready'
    await nextTick()
    await selectPage(currentPage.value, my)
    emit('loaded', {
      format: format.value,
      pages: info.pageDirs.length,
      touchCount: info.touchCount,
      imageCount: info.imageCount,
      hasMdb: info.hasMdb
    })
  } catch (e) {
    if (my !== token) return
    phase.value = 'error'
    errMsg.value = e && e.message ? e.message : String(e)
    emit('error', e)
  }
}

/* ---------------- 切页 ---------------- */
async function selectPage(pageIndex, my = token) {
  if (!zip || !pageDirs.value.length) return
  const idx = Math.min(Math.max(pageIndex, 1), pageDirs.value.length)
  const target = pageDirs.value[idx - 1]
  if (!target) return
  boardLoading.value = true
  boardError.value = ''
  try {
    boardSource.value = await buildPageFiles(target.dir)
    if (my === token) {
      currentPage.value = idx
      emit('pagechange', idx)
    }
    // 当前页缩略图：触发懒渲染（命中缓存时直接返回）
    renderThumb(idx)
    // 预渲染前后各 1 页
    renderThumb(idx - 1)
    renderThumb(idx + 1)
  } catch (e) {
    boardError.value = e && e.message ? e.message : String(e)
    boardSource.value = null
  } finally {
    boardLoading.value = false
  }
}

const goPrev = () => canPrev.value && selectPage(currentPage.value - 1)
const goNext = () => canNext.value && selectPage(currentPage.value + 1)

/* ---------------- 组装某一页的文件列表 ---------------- */
/**
 * 新版笔记（页内含 page_mdb/data.mdb）不上传 *_touch.bin，笔触只存在 mdb 里。
 * 这里现场解析 mdb 合成 TouchSource，并按 snapshot 引用的文件名注入，
 * 使 board.js 的 stroke() 能像读真实文件一样取到点位。旧笔记（有 _touch.bin）不受影响。
 */
async function appendSyntheticTouch(dir, entries, snapshotU8) {
  if (entries.some(e => /_touch\.bin$/i.test(e.path))) return
  const mdbName = zip.names.find(n => n.startsWith(dir) && /(^|\/)data\.mdb$/i.test(n))
  if (!mdbName || !snapshotU8) return
  const mdbU8 = await zip.read(mdbName)
  if (!mdbU8) return
  const src = buildTouchSourceFromMdb(mdbU8)
  if (!src || !src.length) return
  const refs = collectTouchRefs(snapshotU8, { pb, M, S, A })
  for (const r of refs) entries.push({ path: dir + r, blob: new Blob([src]) })
}

async function buildPageFiles(dir) {
  if (fileCache.has(dir)) return fileCache.get(dir)
  // 该页必备：header.bin / snapshot.bin；外加全局 res/image/* 与该页 *_touch.bin。
  // 注意：res/image/* 是顶层共享的，必须始终带上；不能被 wantPrefix 过滤掉。
  const wantPrefix = dir
  const want = new Set()
  const entries = []
  let snapshotU8 = null
  for (const name of zip.names) {
    if (name.endsWith('/')) continue
    if (name.startsWith(wantPrefix)) {
      const base = name.slice(wantPrefix.length)
      if (
        base === 'header.bin' ||
        base === 'snapshot.bin' ||
        /_touch\.bin$/i.test(base)
      ) {
        want.add(name)
      }
    } else if (name.startsWith('res/image/')) {
      // 全局共享图片（多页共用），每页都要带上
      want.add(name)
    }
  }
  for (const name of want) {
    const u = await zip.read(name)
    if (!u) continue
    entries.push({ path: name, blob: new Blob([u]) })
    if (name.slice(wantPrefix.length) === 'snapshot.bin') snapshotU8 = u
  }
  if (!entries.some(e => e.path.endsWith('snapshot.bin'))) {
    throw Error('该页缺少 snapshot.bin')
  }
  await appendSyntheticTouch(dir, entries, snapshotU8)
  fileCache.set(dir, entries)
  return entries
}

/** 整篇的文件集合（各页已注入合成笔触），供 SVG 导出使用 */
async function buildAllFiles() {
  const all = []
  const seen = new Set()
  for (const p of pageDirs.value) {
    for (const e of await buildPageFiles(p.dir)) {
      if (seen.has(e.path)) continue
      seen.add(e.path)
      all.push(e)
    }
  }
  return all
}

/** 把 [{ path, blob }] 包成与 readZip 同形的 VFS，供 convert() 使用 */
function filesToVfs(entries) {
  return {
    names: entries.map(e => e.path),
    read: async (n) => {
      const e = entries.find(x => x.path === n)
      if (!e) return null
      return new Uint8Array(await e.blob.arrayBuffer())
    }
  }
}

/* ---------------- 缩略图（按需懒渲染，避免一次性吃光内存） ---------------- */
const thumbnails = ref({})                 // pageIdx(1-based) → dataURL | null
const thumbLoading = ref({})               // pageIdx → bool
async function renderThumb(pageIndex) {
  if (!zip || thumbnails.value[pageIndex] || thumbLoading.value[pageIndex]) return
  const pdir = pageDirs.value[pageIndex - 1]
  if (!pdir) return
  thumbLoading.value = { ...thumbLoading.value, [pageIndex]: true }
  try {
    // 单页 VFS：header.bin + snapshot.bin + res/image/* + (*_touch.bin 或 mdb 合成)
    const entries = await buildPageFiles(pdir.dir)
    const list = await convert(filesToVfs(entries))
    const r = list[0]
    if (r && r.svg) {
      const m = /width="(\d+)" height="(\d+)"/.exec(r.svg.slice(0, 400))
      const w = +(m && m[1]) || 0, h = +(m && m[2]) || 0
      thumbnails.value = { ...thumbnails.value, [pageIndex]: await svgToPng(r.svg, 120, w, h) }
    }
  } catch {
    thumbnails.value = { ...thumbnails.value, [pageIndex]: null }
  } finally {
    thumbLoading.value = { ...thumbLoading.value, [pageIndex]: false }
  }
}

function svgToPng(svg, targetW, srcW, srcH) {
  return new Promise((resolve, reject) => {
    if (!srcW || !srcH) srcW = srcW || 1, srcH = srcH || 1
    const ratio = srcH / srcW
    const w = targetW, h = Math.round(targetW * ratio)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const cx = c.getContext('2d')
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h)
      cx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

/* ---------------- 导出 SVG（整篇） ---------------- */
async function exportNoteSvg(download = true) {
  if (!zip) return null
  const list = await convert(filesToVfs(await buildAllFiles()))
  if (!list.length) throw Error('无可导出页面')
  const GAP = 16
  const ok = list.filter(r => r.svg)
  if (!ok.length) throw Error('所有页面都渲染失败')
  const sizes = ok.map(r => {
    const m = /width="(\d+)" height="(\d+)"/.exec(r.svg.slice(0, 400))
    return [+(m && m[1]) || 0, +(m && m[2]) || 0]
  })
  const W = Math.max(...sizes.map(s => s[0]))
  let y = 0
  const parts = ok.map((r, i) => {
    const t = r.svg.replace('<svg ', `<svg x="0" y="${y}" `)
    y += sizes[i][1] + GAP
    return t
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y - GAP}" viewBox="0 0 ${W} ${y - GAP}">${parts.join('')}</svg>`
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  if (download) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = props.fileName + '.svg'; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  return blob
}

async function saveSvg() {
  try { await exportNoteSvg(true); ElMessage.success('已保存为 SVG') }
  catch (e) { ElMessage.error('导出 SVG 失败：' + (e.message || e)) }
}

async function saveCurrentSvg() {
  if (!boardSource.value) return
  try {
    const list = await convert(filesToVfs(boardSource.value))
    const ok = list.find(r => r.svg)
    if (!ok) throw Error('当前页渲染失败')
    const blob = new Blob([ok.svg], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${props.fileName}-page${currentPage.value}.svg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    ElMessage.success('已保存当前页为 SVG')
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || e))
  }
}

/* ---------------- 生命周期 ---------------- */
watch(() => [props.source, props.format], () => load(), { immediate: true })
watch(() => props.initialPage, (v) => {
  if (phase.value !== 'ready') return
  if (v && v !== currentPage.value) selectPage(v)
})
onBeforeUnmount(() => { token++; dispose() })

/**
 * 取某一页的 SVG 字符串（1-based，指**查看器内的页序**，非原始 pageIndex）。
 * 供外部把矢量内容直接绘入 PDF；命中文件缓存时无需重新拉取。
 */
async function getPageSvg(pageIndex) {
  if (!zip || !pageDirs.value.length) return null
  const idx = Math.min(Math.max(pageIndex | 0, 1), pageDirs.value.length)
  const pdir = pageDirs.value[idx - 1]
  if (!pdir) return null
  try {
    const entries = await buildPageFiles(pdir.dir)
    const list = await convert(filesToVfs(entries))
    const ok = list.find(r => r.svg)
    return ok ? ok.svg : null
  } catch {
    return null
  }
}

defineExpose({
  nextPage: goNext,
  prevPage: goPrev,
  gotoPage: (i) => selectPage(i),
  exportSvg: (o = {}) => exportNoteSvg(!!o.download),
  /** 单页 SVG（矢量），用于高清 PDF 导出 */
  pageSvg: getPageSvg
})

/* ---------------- 样式 ---------------- */
const rootStyle = { position: 'relative', display: 'flex', height: '100%', minHeight: '320px', background: 'var(--el-fill-color-light)', overflow: 'hidden' }
const sidebarStyle = {
  width: '120px', flex: '0 0 120px', padding: '8px', overflowY: 'auto',
  background: 'var(--el-bg-color)', borderRight: '1px solid var(--el-border-color-lighter)',
  boxSizing: 'border-box'
}
const mainStyle = { flex: '1', position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }
const topbarStyle = {
  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
  background: 'var(--el-bg-color)', borderBottom: '1px solid var(--el-border-color-lighter)'
}
const stageWrapStyle = { position: 'relative', flex: '1', minHeight: 0 }
const thumbItemStyle = (idx) => ({
  position: 'relative', width: '100%', marginBottom: '8px', cursor: 'pointer',
  border: idx === currentPage.value ? '2px solid var(--el-color-primary)' : '2px solid transparent',
  borderRadius: '4px', overflow: 'hidden', background: '#fff'
})
const thumbLabelStyle = (idx) => ({
  position: 'absolute', bottom: '2px', right: '4px', fontSize: '11px',
  color: idx === currentPage.value ? 'var(--el-color-primary)' : 'var(--el-text-color-secondary)',
  background: 'rgba(255,255,255,0.85)', padding: '0 4px', borderRadius: '2px'
})
const metaTagStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px',
  fontSize: '12px', color: 'var(--el-text-color-secondary)',
  background: 'var(--el-fill-color-light)', borderRadius: '10px'
}
const floatStyle = {
  position: 'absolute', display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
  background: 'var(--el-bg-color-overlay)', border: '1px solid var(--el-border-color-lighter)',
  borderRadius: 'var(--el-border-radius-base)', boxShadow: 'var(--el-box-shadow-light)'
}
const pagerBarStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
  padding: '8px', background: 'var(--el-bg-color)', borderTop: '1px solid var(--el-border-color-lighter)'
}
</script>

<template>
  <div class="ezy-note-viewer" :style="rootStyle">
    <!-- 左侧缩略图栏 -->
    <aside v-if="showPages && phase === 'ready'" :style="sidebarStyle">
      <div
        v-for="(p, i) in pageDirs"
        :key="p.dir"
        :style="thumbItemStyle(i + 1)"
        @click="selectPage(i + 1)"
      >
        <img
          v-if="thumbnails[i + 1]"
          :src="thumbnails[i + 1]"
          :style="{ width: '100%', display: 'block', background: '#fff' }"
          alt=""
        />
        <div v-else :style="{ width: '100%', paddingBottom: '140%', background: '#f3f3f3', display: 'flex', alignItems: 'center', justifyContent: 'center' }">
          <ElIcon :size="20" color="#bbb"><Document /></ElIcon>
        </div>
        <span :style="thumbLabelStyle(i + 1)">第 {{ i + 1 }} 页</span>
      </div>
    </aside>

    <!-- 主区 -->
    <div :style="mainStyle">
      <!-- 顶部元信息条 -->
      <div v-if="showMeta && phase !== 'error'" :style="topbarStyle">
        <span :style="{ fontSize: '14px', fontWeight: 600, color: 'var(--el-text-color-primary)' }">
          {{ totalPages > 0 ? `第 ${currentPage} / ${totalPages} 页` : '笔记预览' }}
        </span>
        <span :style="metaTagStyle" :title="formatTitle">
          <ElIcon :size="14"><FolderOpened /></ElIcon>
          {{ formatLabel }}
        </span>
        <span v-if="imageCount > 0" :style="metaTagStyle">
          <ElIcon :size="14"><Picture /></ElIcon>
          {{ imageCount }} 张图片
        </span>
        <span v-if="touchCount > 0 || touchFromMdb" :style="metaTagStyle">
          <ElIcon :size="14"><Files /></ElIcon>
          {{ touchFromMdb ? '笔触来自 mdb' : touchCount + ' 个笔触' }}
        </span>
        <div :style="{ flex: 1 }" />
        <ElButton :icon="Picture" size="small" @click="saveCurrentSvg" :title="'导出当前页 SVG'">当前页</ElButton>
        <ElButton :icon="Document" size="small" type="primary" @click="saveSvg" :title="'导出整篇笔记 SVG'">整篇</ElButton>
      </div>

      <!-- 画板舞台 -->
      <div :style="stageWrapStyle">
        <!-- 加载中 -->
        <div v-if="phase === 'loading' || boardLoading"
             :style="{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--el-text-color-secondary)' }">
          <ElIcon class="is-loading" :size="32"><Loading /></ElIcon>
        </div>

        <!-- 错误 -->
        <ElAlert v-else-if="phase === 'error'" :title="errMsg" type="error" show-icon :closable="false"
                 :style="{ position: 'absolute', left: '12px', right: '12px', top: '12px' }" />
        <ElAlert v-else-if="boardError" :title="boardError" type="warning" show-icon :closable="false"
                 :style="{ position: 'absolute', left: '12px', right: '12px', top: '12px' }" />

        <!-- 渲染 -->
        <EzyBoardViewer
          v-else-if="boardSource"
          :source="boardSource"
          :min-zoom="minZoom"
          :max-zoom="maxZoom"
          :context-menu="contextMenu"
          :file-name="`${fileName}-page${currentPage}`"
          :style="{ position: 'absolute', inset: 0 }"
        />
      </div>

      <!-- 底部翻页 -->
      <div v-if="phase === 'ready' && totalPages > 0" :style="pagerBarStyle">
        <ElButton :disabled="!canPrev" :icon="ArrowLeft" @click="goPrev">上一页</ElButton>
        <span :style="{ fontSize: '13px', color: 'var(--el-text-color-regular)' }">
          {{ currentPage }} / {{ totalPages }}
        </span>
        <ElButton :disabled="!canNext" @click="goNext">
          下一页<ElIcon style="margin-left: 4px;"><ArrowRight /></ElIcon>
        </ElButton>
      </div>
    </div>

    <!-- 导出进度 -->
    <div v-if="exporting" :style="{ ...floatStyle, left: '50%', top: '12px', transform: 'translateX(-50%)', width: 'min(360px, 80%)', flexDirection: 'column', alignItems: 'stretch', zIndex: 9 }">
      <div :style="{ display: 'flex', alignItems: 'center', gap: '8px' }">
        <ElProgress :percentage="Math.round((exporting.frac || 0) * 100)" :stroke-width="10" :style="{ flex: 1 }" />
        <ElButton circle size="small" :icon="Close" @click="exporting = null" />
      </div>
    </div>
  </div>
</template>
