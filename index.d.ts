import type { DefineComponent, Plugin } from 'vue'

export interface BoardFile { path: string; blob: Blob | Uint8Array | ArrayBuffer }
/**
 * 虚拟文件系统（VFS）接口：由调用方提供 names 与 read，
 * 渲染层按需拉取对应文件的字节。与 readZip() 输出一致。
 */
export interface BoardVfs {
  names: string[]
  read(name: string): Promise<Uint8Array | null>
}
/** zip（Blob/File/ArrayBuffer/Uint8Array/URL）、文件列表、VFS，或 createBoard() 返回的画板 */
export type BoardSource = Blob | File | ArrayBuffer | Uint8Array | string | BoardFile[] | BoardVfs | Board

export interface EzyBoardViewerProps {
  /** zip（Blob / File / ArrayBuffer / Uint8Array / URL）、文件列表 [{ path, blob }]，或 createBoard() 返回的画板 */
  source?: BoardSource | null
  /** 'auto' 自动识别静态/录制，也可强制指定。默认 'auto' */
  mode?: 'auto' | 'static' | 'recording'
  /** 录制：载入后自动播放。默认 true */
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  /** 倍速档位。默认 [0.5, 0.75, 1, 1.25, 1.5, 2] */
  speeds?: number[]
  /** 音频起点计时基准。默认 'chain'（按 _audio.bin 自身命令链） */
  audioAnchor?: 'chain' | 'segment'
  /** 缩放下/上限，相对"适应窗口"的倍数。默认 0.25 / 8 */
  minZoom?: number
  maxZoom?: number
  /** 导出文件名（不含扩展名）。默认 'board' */
  fileName?: string
  fetchOptions?: RequestInit
  /** 右键 / 长按菜单。默认 true */
  contextMenu?: boolean
}

export interface EzyBoardLoadedInfo {
  kind: 'static' | 'recording'
  pages: number
  /** 录制总时长（ms），静态为 0 */
  duration: number
}

export interface EzyBoardViewerInstance {
  zoomIn(): void
  zoomOut(): void
  resetView(): void
  play(): void
  pause(): void
  toggle(): void
  seek(ms: number): void
  setRate(rate: number): void
  setMuted(muted: boolean): void
  /** 导出 SVG，返回 Blob；download:true 时同时触发浏览器下载 */
  exportSvg(options?: { download?: boolean }): Promise<Blob>
  /** 导出 MP4（仅录制），返回 Blob */
  exportMp4(options?: Mp4Options & { download?: boolean }): Promise<Blob>
}

export declare const EzyBoardViewer: DefineComponent<EzyBoardViewerProps> & Plugin
export default EzyBoardViewer

/* ---------------- 云笔记（NoteViewer） ---------------- */
export const NOTE_FORMAT: { OLD: 'old'; NEW: 'new'; UNKNOWN: 'unknown' }

/** 笔记元信息 */
export interface NoteInfo {
  /**
   * 'new' 含 mdb（笔触存于 page_mdb/data.mdb，查看器现场解析）
   * 'old' 无 mdb（笔触为独立 <UUID>_touch.bin 文件）
   * 'unknown' 两者都没探测到
   */
  format: 'old' | 'new' | 'unknown'
  pages: number
  /** [{ dir, idx }]，dir 形如 'page1/' */
  pageDirs: Array<{ dir: string; idx: number }>
  /** <UUID>_touch.bin 笔触文件数（新笔记为 0，改由 mdb 承载） */
  touchCount: number
  /** res/image/ 图片数 */
  imageCount: number
  /** 是否含 .mdb（锁文件 lock.mdb 不计），是区分新旧笔记的核心标志 */
  hasMdb: boolean
  /** 笔触是否由 mdb 现场解析（true 时 touchCount 为 0 属正常） */
  touchFromMdb: boolean
}

export interface NoteViewerProps {
  /** zip（Blob / File / ArrayBuffer / Uint8Array / URL）、文件列表 [{ path, blob }] */
  source?: BoardSource | null
  /** 'auto' 自动识别（默认），也可强制 'old' / 'new' */
  format?: 'auto' | 'old' | 'new'
  /** 起始页（1-based）。默认 1 */
  initialPage?: number
  /** 是否显示左侧缩略图栏。默认 true */
  showPages?: boolean
  /** 是否显示顶部笔记元信息。默认 true */
  showMeta?: boolean
  /** 缩放范围，相对"适应窗口"的倍数 */
  minZoom?: number
  maxZoom?: number
  /** 导出文件名（不含扩展名）。默认 'note' */
  fileName?: string
  fetchOptions?: RequestInit
  /** 右键 / 长按菜单 */
  contextMenu?: boolean
}

export interface NoteViewerInstance {
  nextPage(): void
  prevPage(): void
  gotoPage(idx: number): void
  /** 导出整篇笔记 SVG，返回 Blob；download:true 时同时触发浏览器下载 */
  exportSvg(options?: { download?: boolean }): Promise<Blob>
  /**
   * 取某一页的 SVG 字符串（1-based，指查看器内的页序，不触发下载）；失败返回 null。
   * 可用于把矢量内容直接绘入 PDF。
   */
  pageSvg(order: number): Promise<string | null>
}

export declare const NoteViewer: DefineComponent<NoteViewerProps> & Plugin

/** 不挂载组件：笔记每页一个 SVG 字符串（图片 base64 内联，自动适配新旧笔记） */
export declare function noteToSvgs(source: BoardSource, options?: { fetchOptions?: RequestInit }): Promise<Array<{ svg?: string; error?: string }>>
/** 不挂载组件：导出整篇笔记 SVG Blob（多页纵向合并） */
export declare function noteToSvgBlob(source: BoardSource, options?: { fetchOptions?: RequestInit }): Promise<Blob>
/** 提取笔记某一页的 SVG（pageIndex 从 0 开始） */
export declare function notePageSvg(source: BoardSource, pageIndex: number, options?: { fetchOptions?: RequestInit }): Promise<string | null>
/** 检测笔记文件格式 */
export declare function detectNoteFormat(fileNames: string[]): 'old' | 'new' | 'unknown'
/** 读取笔记元信息（格式 / 页数 / 笔触数 / 图片数） */
export declare function inspectNote(source: BoardSource, options?: { fetchOptions?: RequestInit }): Promise<NoteInfo>
/** 解析笔记页面顺序（dir 列表） */
export declare function resolvePages(source: BoardSource, options?: { fetchOptions?: RequestInit }): Promise<Array<{ dir: string; idx: number }>>

/* ---------------- 新版笔记 mdb 解析 ---------------- */
/** 读出 LMDB 文件里全部 leaf 记录的 key / value */
export declare function readMdbEntries(u8: Uint8Array): Array<{ key: Uint8Array; val: Uint8Array }>
/**
 * 解析一页的 page_mdb/data.mdb，产出 TouchSource（即 *_touch.bin 的 protobuf 字节）。
 * 返回 null 表示该库里没有笔触数据。
 */
export declare function buildTouchSourceFromMdb(u8: Uint8Array): Uint8Array | null
/**
 * 读取该页背景网格 / 横线配置（BackgroundLineConfigEntity）。
 * 新版笔记不上传 header.bin，背景线只存在 mdb 里；返回 null 表示该页没有背景线。
 */
export declare function readHeaderBgColor(u8: Uint8Array): number | null
export declare function readBgLineConfig(u8: Uint8Array): {
  /** 线色，int32 0xAARRGGBB */
  color: number
  /** 线间距（画布像素） */
  spacing: number
  /** 线宽（画布像素） */
  width: number
  /** true = 横竖交错网格；false = 仅横线 */
  cross: boolean
} | null
/** 把 [{ width, color, points }] 编码成 TouchSource */
export declare function encodeTouchSource(segments: Array<{ width: number; color: number; points: Array<{ x: number; y: number }> }>): Uint8Array
/** 从 snapshot.bin 中收集被引用的 *_touch.bin 文件名 */
export declare function collectTouchRefs(
  u8: Uint8Array,
  tools: { pb: Function; M: Function; S: Function; A: Function }
): string[]

export interface Mp4Options {
  /** 'low' 960p/1.5Mbps · 'mid' 1280p/3Mbps（默认）· 'high' 1920p/8Mbps，或自定义 { long: 长边像素, kbps } */
  quality?: 'low' | 'mid' | 'high' | { long: number; kbps: number }
  /** stage: 'mix' | 'encode' | 'noaudio'；frac: 0~1 */
  onProgress?: (stage: string, frac: number) => void
  signal?: AbortSignal
}

/** 不挂载组件：每页一个 SVG 字符串（图片 base64 内联） */
export declare function boardToSvgs(source: BoardSource, options?: { fetchOptions?: RequestInit }): Promise<Array<{ svg?: string; error?: string }>>
/** 不挂载组件：导出 SVG Blob（多页纵向合并） */
export declare function boardToSvgBlob(source: BoardSource, options?: { fetchOptions?: RequestInit }): Promise<Blob>
/** 不挂载组件：导出 MP4 Blob（仅录制；需要 WebCodecs） */
export declare function boardToMp4Blob(source: BoardSource, options?: Mp4Options & { fetchOptions?: RequestInit; /** 静态内容默认拒绝，force 则按命令回放导出 */ force?: boolean }): Promise<Blob>
/** [{ path, blob }] → zip Blob */
export declare function filesToZip(files: BoardFile[]): Promise<Blob>
export declare const MP4_QUALITY: Record<'low' | 'mid' | 'high', { key: string; label: string; long: number; kbps: number }>

/* ---------------- 创建新画板 ---------------- */
/** CSS '#rgb' | '#rrggbb' | '#rrggbbaa'，或 Android ARGB int32 */
export type Color = string | number
export interface Pt { x: number; y: number; t?: number }
export type PointLike = [number, number] | [number, number, number] | Pt
export interface Handle { readonly id: string; readonly type: number }
export interface Delay { /** 本条命令之前再等待的毫秒数（delayTime） */ delay?: number }
export interface Parent { /** 挂到某个 group 下，默认根 */ parent?: Handle }
export interface StrokeStyle { color?: Color; lineWidth?: number; /** [实线长, 间隔] */ dash?: [number, number]; style?: number }
export interface StrokeOptions extends StrokeStyle, Delay, Parent {
  /** 书写总时长 ms（点没有 t 时均分）；也可给每个点 t */
  duration?: number
  /** 点没有 t 且没给 duration 时的间隔，默认 16ms */
  step?: number
  /** 默认自动包一层 GROUP（和 App 一致），false 则直接挂在 parent / 根 */
  group?: boolean
}
export interface MoveOptions extends Delay {
  dx?: number; dy?: number; scale?: number; /** 度 */ rotate?: number
  /** 世界坐标，默认图元中心 */ pivot?: { x: number; y: number }
  duration?: number; frames?: number
  /** 单帧直接指定手势矩阵 [scaleX, skewY, skewX, scaleY, transX, transY] */
  matrix?: [number, number, number, number, number, number]
}
export interface Line { color?: Color; space?: number; type?: 'horizontal' | 'staggered'; width?: number }
export interface AuthorInput { name?: string; id?: string; schoolId?: string; url?: string; startTime?: number; duration?: number }

export interface BoardPage {
  /** 下一条命令之前再等待 ms 毫秒 */
  wait(ms: number): this
  group(o?: Delay & Parent): Handle
  image(src: Blob | Uint8Array | ArrayBuffer | string, o?: { x?: number; y?: number; width?: number; height?: number } & Delay & Parent): Promise<Handle>
  stroke(points: PointLike[], o?: StrokeOptions): Handle
  line(a: PointLike, b: PointLike, o?: StrokeOptions & { duration?: number }): Handle
  text(content: string, o?: { x?: number; y?: number; size?: number; color?: Color; width?: number; height?: number } & Delay & Parent): Handle
  oval(o: { x?: number; y?: number; width: number; height: number } & StrokeStyle & Delay & Parent): Handle
  polygon(points: PointLike[], o?: { x?: number; y?: number } & StrokeStyle & Delay & Parent): Handle
  rect(o: { x?: number; y?: number; width: number; height: number } & StrokeStyle & Delay & Parent): Handle
  move(h: Handle, o?: MoveOptions): Handle
  change(h: Handle, o: { content?: string; color?: Color; lineWidth?: number; size?: number; dash?: [number, number]; width?: number; height?: number; points?: PointLike[] } & Delay): Handle
  remove(h: Handle, o?: Delay): void
  /** 用当前完整图元树重置页面（App 的删除/撤销用这条命令） */
  rebuild(o?: Delay): void
  config(o: { background?: Color; backgroundLine?: Line } & Delay): void
  camera(o: { matrix?: MoveOptions['matrix']; scale?: number; dx?: number; dy?: number } & Delay): void
  cameraMove(o?: MoveOptions): void
  /** 激光笔轨迹（🔶 未经真实 App 验证） */
  cursor(points: PointLike[], o?: { duration?: number; step?: number } & Delay): void
  /** 原样写入自定义命令字节（查看器忽略） */
  custom(bytes: Uint8Array, o?: Delay): void
  stop(o?: Delay): void
  /** start：音频在主时间轴上开始的毫秒（按 _audio.bin 命令链计时）；duration 缺省时在浏览器里自动探测，Node 里必须传 */
  audio(src: Blob | Uint8Array | ArrayBuffer | string, o?: { start?: number; duration?: number; ext?: string }): Promise<{ name: string; start: number; duration: number }>
}

export interface BoardOptions {
  /** 像素 */ width: number; height: number
  background?: Color; backgroundLine?: Line
  moveConfig?: { isEnable?: boolean; verticalTranslate?: boolean; horizontalTranslate?: boolean; scale?: boolean; rotate?: boolean; maxHeightTimes?: number; maxWidthTimes?: number }
  author?: AuthorInput; provider?: AuthorInput[]; convertUrl?: string
  /** 'auto'：有音频 / 停止标记 / 激光笔即为录制 */
  recording?: boolean | 'auto'
  createDate?: number
  /** 浏览器里默认生成 screenshot.png 预览图，false 关闭 */
  screenshot?: boolean
}
export interface Board {
  page(index?: number): BoardPage
  addPage(o?: { width?: number; height?: number; background?: Color; backgroundLine?: Line }): BoardPage
  readonly pages: BoardPage[]
  /** [{ path, blob }]，可直接作为查看器的 source */
  toFiles(): Promise<Array<BoardFile & { data: Uint8Array }>>
  toBlob(): Promise<Blob>
}
export declare function createBoard(options: BoardOptions): Board
export declare function parseColor(c: Color, fallback?: number): number
export declare const GRAPH: { ROOT: 0; GROUP: 1; IMAGE: 2; STROKE: 3; BEELINE: 4; TEXT: 5; GEOMETRY: 6 }
export declare const CMD: { ADD: 1; REMOVE: 2; MATRIX: 3; CHANGE: 4; CUSTOM: 5; AUDIO: 6; CAMERA: 7; CAMERA_MATRIX: 8; CONFIG: 9; STOP: 10; CURSOR: 11; REBUILD: 12 }

/* ---------------- 适配层（可选能力，按需引入） ---------------- */

/** 背景网格 / 横线参数 */
export interface BgLines {
  /** 线色，int32 0xAARRGGBB */
  color: number
  /** 线间距（画布像素） */
  spacing: number
  /** 线宽（画布像素） */
  width: number
  /** true = 横竖交错网格；false = 仅横线 */
  cross: boolean
}

/** 云笔记某一页的资源指针 */
export interface NotePage {
  /** 当前页号（1-based）。用作虚拟目录名（如 '1'、'2'） */
  pageKey: number
  /** 该页 snapshot.bin 的完整 URL */
  snapshotUrl: string
  /** 该页 _touch.bin 列表（旧笔记：每段笔触一个独立文件） */
  touchUrls?: string[]
  /** 新版笔记的 page_mdb/data.mdb（笔触存在这里，页内不再上传 _touch.bin） */
  mdbUrl?: string
  /** 画布尺寸，建议取该页截图像素尺寸 */
  width?: number
  height?: number
  /** 画布底色（int32 0xAARRGGBB）。不传时依次尝试：mdb 的 HeaderEntity → 截图采样 */
  bgcolor?: number
  /** 背景网格 / 横线。不传时依次尝试：mdb 的 BackgroundLineConfigEntity → 截图推断 */
  bgLines?: BgLines
}
/** 全局共享图片（多页共用，对应 res/image/*） */
export interface NoteImage {
  fileName: string
  url: string
}
/** 可直接作为 <NoteViewer :source="vfs" /> 的虚拟文件系统 */
export interface NoteVfs {
  names: string[]
  read(name: string): Promise<Uint8Array | null>
}
export interface NoteVfsOptions {
  pages: NotePage[]
  images?: NoteImage[]
  /** 自定义请求函数（走代理、带鉴权头等）；不传则直接 fetch */
  fetchBlob?: (url: string) => Promise<Blob>
}
/** 云笔记资源元数据 → 按需拉取的虚拟文件系统 */
export declare function createNoteVfs(opts: NoteVfsOptions): Promise<NoteVfs>

/** 从页面截图推断背景网格 / 横线；无网格时返回 null */
export declare function detectBgLines(img: HTMLImageElement): BgLines | null

export interface SvgDrawBox {
  x: number
  y: number
  w: number
  h: number
}
export interface SvgPdfOptions {
  /** 已注册进 jsPDF 的中文字体名（见 ensureCjkPdfFont）；缺失时中文回退为位图 */
  cjkFont?: string
}
/**
 * 把画板 SVG 以矢量方式绘入 jsPDF 当前页的指定矩形内（等比缩放居中）。
 * 路径 / 文字 / 图形保持矢量；图片按格式嵌入，带旋转的图片会自动烘焙。
 * @param pdf jsPDF 实例（本包不依赖 jspdf，只用到其公开 API）
 * @returns 实际绘制出的图元数量；0 表示没画出东西
 */
export declare function drawSvgToPdf(
  pdf: any,
  svgText: string,
  box: SvgDrawBox,
  options?: SvgPdfOptions
): Promise<number>

/** 注册进 jsPDF 后的中文字体名 */
export declare const CJK_PDF_FONT: string
/** 覆盖中文字体路径（相对部署根目录）。字体约 8MB，请由使用方托管到站点 public 下 */
export declare function setCjkFontPath(path: string): void
/** 懒加载中文字体 base64；失败返回 null（调用方回退位图文字） */
export declare function loadCjkFontBase64(): Promise<string | null>
/** 把中文字体注册进 jsPDF，返回 setFont 用的名称；不可用时返回 undefined */
export declare function ensureCjkPdfFont(pdf: any): Promise<string | undefined>
