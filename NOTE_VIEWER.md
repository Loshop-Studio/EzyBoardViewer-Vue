# NoteViewer 控件（云笔记适配）

基于逆向成果，把云笔记（friday / 优客畅学）的两种本地存储格式**统一封装**为一个 Vue 控件，渲染复用 `EzyBoardViewer` 的核心。

## 两种笔记格式

| 维度 | 旧笔记（old） | 新笔记（new） |
|---|---|---|
| 判据 | 无 `.mdb` | 页内含 `page_mdb/data.mdb`（`lock.mdb` 不计） |
| 笔触存储 | 独立 `<UUID>_touch.bin` 文件，snapshot 按 `sourceFileName + sourceId` 引用 | **不上传** `_touch.bin`，笔触存于 `data.mdb` 的 ObjectBox（`TouchEventEntity` 线宽/颜色 + `TouchInfoEntity` x/y/时间/段号） |
| 笔触获取 | 直接下载该文件 | 浏览器端解析 mdb（LMDB + FlatBuffers）合成 TouchSource，再按 snapshot 引用的文件名注入 |
| 渲染所需 | header.bin / snapshot.bin / res/image/* / `*_touch.bin` | header.bin（可合成）/ snapshot.bin / `page_mdb/data.mdb` / res/image/* |

格式判据与 APK `FileManager.getFinalDownloadList` 一致：**只要出现 `.mdb` 就按新笔记规则处理**（此时下载列表只保留 图片 / `.mdb` / `snapshot.bin`，`_touch.bin` 从来不在列表里）。

mdb 解析实现见 `src/core/mdb.js`（`buildTouchSourceFromMdb`），渲染层 board.js 无需改动。

## 文件清单

- `src/NoteViewer.vue` — 主控件（多页面切换 + 缩略图栏 + 元信息条）
- `src/core/note.js` — 笔记适配层（格式探测、页面解析、SVG 导出）
- `src/index.js` — 导出 `NoteViewer`、`noteToSvgs`、`noteToSvgBlob`、`detectNoteFormat`、`inspectNote`、`NOTE_FORMAT`
- `index.d.ts` — TypeScript 类型定义

## 快速上手

```vue
<template>
  <NoteViewer
    :source="noteZip"           // zip Blob / URL / BoardFile[]
    :initial-page="1"
    @loaded="onLoaded"
    @pagechange="onPageChange"
  />
</template>

<script setup>
import { NoteViewer } from 'ezy-board-viewer'
</script>
```

`source` 接受与 `EzyBoardViewer` 完全相同的 `BoardSource`（zip Blob/File/ArrayBuffer/Uint8Array/URL、文件列表、或 `createBoard()` 返回的画板）。

## API

```ts
export interface NoteViewerProps {
  source?: BoardSource | null         // 笔记来源（zip / 文件列表 / URL / BoardFile[]）
  format?: 'auto' | 'old' | 'new'     // 默认 'auto'，按文件路径启发式识别
  initialPage?: number                // 起始页（1-based），默认 1
  showPages?: boolean                 // 是否显示左侧缩略图栏，默认 true
  showMeta?: boolean                  // 是否显示顶部元信息条，默认 true
  minZoom?: number                    // 缩放下限，默认 0.25
  maxZoom?: number                    // 缩放上限，默认 8
  fileName?: string                   // 导出文件名（不含扩展名），默认 'note'
  fetchOptions?: RequestInit          // URL 拉取时的额外选项
  contextMenu?: boolean               // 右键 / 长按菜单，默认 true
}

export interface NoteViewerInstance {
  nextPage(): void
  prevPage(): void
  gotoPage(idx: number): void         // 1-based
  exportSvg(opts?: { download?: boolean }): Promise<Blob>
  pageSvg(order: number): Promise<string | null>   // 单页 SVG（查看器内页序，1-based），供矢量 PDF 等消费
}
```

## 不挂载组件

```ts
import { noteToSvgs, noteToSvgBlob, inspectNote, detectNoteFormat, NOTE_FORMAT } from 'ezy-board-viewer'

// 笔记每页一张 SVG
const list = await noteToSvgs(zipBlob)
// [{ svg: '<svg ...>...</svg>' }, ...]

// 整篇合并为单个 SVG Blob
const blob = await noteToSvgBlob(zipBlob)

// 探测笔记格式
const format = detectNoteFormat(['data.mdb', 'lock.mdb', 'page1/snapshot.bin', 'page1/<UUID>_touch.bin'])
// → 'old'

// 元信息：页数、格式、图片/笔触数量
const info = await inspectNote(zipBlob)
// { format: 'old', pages: 5, touchCount: 42, imageCount: 12, hasMdb: true, pageDirs: [...] }
```

## 渲染细节（基于逆向）

- **header.bin**（protobuf）：field 2 = 宽 / 3 = 高 / 6 = 时长 / 10 / 11 = 背景色 / 13 / 14 = 背景网格线
- **snapshot.bin**（protobuf）：`PageSnapshot { cameraMatrix=1; graphSnapshot=2; }`
- **GraphSnapshot**：1 = id / 2 = 图元类型 (0=ROOT, 1=GROUP, 2=IMAGE, 3=STROKE, 4=BEELINE, 5=TEXT, 6=GEOMETRY) / 3 = outRect / 4 = matrix / 5 = childGraph[] / 6 = sourceFileName / 7 = sourceId / 9 = paint / 10 = content(text) / 11 = pointList (inline 笔触) / 12 = filePath (image)
- **TouchSource**（`<UUID>_touch.bin`）：外部笔触数据，通过 `sourceFileName + sourceId` 引用，避免 snapshot 体积过大；
  `TouchSource { repeated TouchInfo = 1 }` / `TouchInfo { repeated Point = 1; Paint paint = 2 }` / `Point { float x = 3; float y = 4 }` / `Paint { float width = 1; int32 color = 2 }`
- **mdb（新笔记）**：LMDB 页 4KB，页头 `flags@+10 / lower@+12 / upper@+14 / ptrs@+16`，node = `mn_lo(2)+mn_hi(2)+flags(2)+ksize(2)` + key + value；8 字节 key 的 value 为 ObjectBox FlatBuffers。实测实体字段：
  - `TouchEventEntity`：f0=id, **f1=线宽(float)**, **f2=颜色(int32)**
  - `TouchInfoEntity`：f0=id, f1=eventTime(i64), **f2=x(float)**, **f3=y(float)**, f5=所属段 id(i64)

完整 proto 字段定义在 `src/core/board.js` 的 `pb()` 解码器和 `pageSvg()` 渲染逻辑里；mdb 的字段映射与合成逻辑在 `src/core/mdb.js`。
