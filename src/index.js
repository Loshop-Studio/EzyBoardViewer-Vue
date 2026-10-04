import EzyBoardViewer from './EzyBoardViewer.vue'
import NoteViewer from './NoteViewer.vue'
import { openSource, convert, detect, loadRec, exportMp4, mergeSvgs, MP4_QUALITY } from './core/board.js'
import { writeZip } from './core/writer.js'
import {
  detectNoteFormat, inspectNote, resolvePages,
  noteToSvgs, noteToSvgBlob, notePageSvg, NOTE_FORMAT
} from './core/note.js'

EzyBoardViewer.install = app => { app.component('EzyBoardViewer', EzyBoardViewer) }
NoteViewer.install = app => { app.component('NoteViewer', NoteViewer) }

/** 不挂载组件：每页一个 SVG 字符串（图片 base64 内联）。source 同组件。 */
export async function boardToSvgs(source, options = {}) {
  const z = await openSource(source, options.fetchOptions)
  return (await convert(z)).map(r => (r.err ? { error: r.err } : { svg: r.svg }))
}
/** 不挂载组件：导出 SVG Blob（多页纵向合并为一个） */
export async function boardToSvgBlob(source, options = {}) {
  const z = await openSource(source, options.fetchOptions)
  return new Blob([mergeSvgs(await convert(z))], { type: 'image/svg+xml' })
}
/** 不挂载组件：导出 MP4 Blob（仅录制；需要浏览器 WebCodecs）。options: { quality: 'low'|'mid'|'high'|{long,kbps}, onProgress(stage, frac), signal, force } */
export async function boardToMp4Blob(source, options = {}) {
  const z = await openSource(source, options.fetchOptions)
  if (!options.force && !(await detect(z)).length) throw Error('这是静态内容，没有可导出的 MP4（需要录制内容；或传 force: true 按命令回放导出）')
  const R = await loadRec(z)
  try {
    const q = options.quality && typeof options.quality === 'object' ? { key: 'custom', ...options.quality } : MP4_QUALITY[options.quality || 'mid']
    if (!q) throw Error('未知画质：' + options.quality)
    return await exportMp4(R, q, options.onProgress, options.signal)
  } finally { R.clips.forEach(c => URL.revokeObjectURL(c.url)) }
}
/** [{ path, blob }] → zip Blob */
export async function filesToZip(files) {
  const z = await openSource(files)
  return writeZip(await Promise.all(z.names.map(async name => ({ name, data: await z.read(name) }))))
}

/** 笔记：不挂载组件，每页一张 SVG（基于笔记格式自动适配新旧笔记） */
export { noteToSvgs, noteToSvgBlob, notePageSvg, detectNoteFormat, inspectNote, resolvePages, NOTE_FORMAT }
/** 新版笔记的 mdb 解析：page_mdb/data.mdb → TouchSource 字节（不挂载组件时可用） */
export { buildTouchSourceFromMdb, readMdbEntries, encodeTouchSource, collectTouchRefs, readBgLineConfig, readHeaderBgColor } from './core/mdb.js'

export { createBoard, parseColor, GRAPH, CMD } from './core/builder.js'
export { MP4_QUALITY, EzyBoardViewer, NoteViewer }
export default EzyBoardViewer

/* ---------------- 适配层（可选能力，按需引入） ---------------- */

/**
 * 云笔记资源元数据 → 按需拉取的虚拟文件系统，直接喂给 <NoteViewer :source="vfs" />。
 * 需要走代理 / 鉴权时通过 opts.fetchBlob 注入自定义请求函数。
 */
export { createNoteVfs } from './utils/noteVfs.ts'

/** 把画板 SVG 以矢量方式绘入 jsPDF（路径/文字/图形保持矢量，不栅格化） */
export { drawSvgToPdf } from './utils/svgToPdf.ts'

/** PDF 中文矢量字体：注册进 jsPDF（字体文件由使用方托管，路径可用 setCjkFontPath 覆盖） */
export { ensureCjkPdfFont, loadCjkFontBase64, setCjkFontPath, CJK_PDF_FONT } from './utils/pdfFont.ts'
