# EzyBoardViewer-Vue

Ezy 画板 / 云笔记的 **Vue 3 预览组件与导出工具集**。渲染 `.bin` 画板快照、翻页缩放、播放笔迹动画，并导出 SVG / MP4 / PDF。

- `EzyBoardViewer` —— 通用画板预览（随身答等场景）
- `NoteViewer` —— 云笔记预览（自动适配新旧笔记格式、按需拉取资源、mdb 现场解析笔触）
- 导出工具 —— SVG（单页 / 整篇）、MP4（录屏）、PDF（矢量）

## 安装

```bash
npm i ezy-board-viewer

# 运行时必需（peer）
npm i vue element-plus @element-plus/icons-vue

# 仅当需要导出 MP4 时
npm i mp4-muxer

# 仅当需要导出 PDF 时
npm i jspdf
```

## 快速上手

### 通用画板

```vue
<script setup>
import { EzyBoardViewer } from 'ezy-board-viewer'
import 'element-plus/dist/index.css'

const source = { names: [...], read: (name) => /* Promise<Uint8Array> */ }
</script>

<template>
  <EzyBoardViewer :source="source" />
</template>
```

### 云笔记

`NoteViewer` 接受 zip / 文件列表 / URL，也接受一个「虚拟文件系统」，从云端按需拉取：

```vue
<script setup>
import { ref } from 'vue'
import { NoteViewer, createNoteVfs } from 'ezy-board-viewer'

const vfs = ref(null)

async function load(resourceList, images) {
  // resourceList：服务端返回的资源元数据（screenshot.png / snapshot.bin / data.mdb / _touch.bin ...）
  vfs.value = await createNoteVfs({
    pages: [{
      pageKey: 1,
      snapshotUrl: 'https://.../snapshot.bin',
      mdbUrl: 'https://.../data.mdb',   // 新版笔记笔触存这里
      width: 2200, height: 2529         // 取该页截图尺寸
    }],
    images,
    // 需要走代理 / 带鉴权头时注入；不传则直接 fetch
    fetchBlob: (url) => fetch(url, { headers: { Authorization: token } }).then(r => r.blob())
  })
}
</script>

<template>
  <NoteViewer ref="viewer" :source="vfs" :initial-page="1" @pagechange="p => console.log(p)" />
</template>
```

**底色与背景网格不需要手动传**：`createNoteVfs` 会从该页 `data.mdb` 里读
（`HeaderEntity.defaultBackgroundColor` + `BackgroundLineConfigEntity`），
读不到时才退回调用方传的 `bgcolor` / `bgLines`。

### 导出 PDF（矢量）

```ts
import { jsPDF } from 'jspdf'
import { drawSvgToPdf, ensureCjkPdfFont, setCjkFontPath } from 'ezy-board-viewer'

// 中文要矢量，需要一份 TTF（本包不便随包分发 8MB 字体，请自行托管到 public 下）
setCjkFontPath('fonts/HarmonyOS_Sans_SC_Regular.ttf')

const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4', compress: true, floatPrecision: 2 })
const cjkFont = await ensureCjkPdfFont(pdf)   // 失败返回 undefined，中文自动回退位图

const svg = await viewer.value.pageSvg(1)     // <NoteViewer> 实例方法
await drawSvgToPdf(pdf, svg, { x: 0, y: 0, w: 595, h: 842 }, { cjkFont })
pdf.save('note.pdf')
```

路径、文字、图形均以**矢量**写入；图片按原格式嵌入，带旋转的图片会自动烘焙。

### 不挂载组件

```ts
import { noteToSvgs, noteToSvgBlob, boardToMp4Blob, filesToZip } from 'ezy-board-viewer'
```

## 主要导出

| 导出 | 说明 |
| --- | --- |
| `EzyBoardViewer` / `NoteViewer` | 预览组件（均带 `install`，可 `app.use()`） |
| `boardToSvgs` / `boardToSvgBlob` / `boardToMp4Blob` / `filesToZip` | 无组件导出 |
| `noteToSvgs` / `noteToSvgBlob` / `notePageSvg` / `inspectNote` | 笔记专用导出与探测 |
| `createNoteVfs` | 云笔记资源 → 按需 VFS |
| `drawSvgToPdf` / `ensureCjkPdfFont` / `setCjkFontPath` | 矢量 PDF 导出 |
| `createBoard` / `parseColor` / `GRAPH` / `CMD` | 从零构造画板 |
| `detectBgLines` | 从截图推断背景网格（兜底） |

完整类型见 [index.d.ts](./index.d.ts)，格式说明见 [NOTE_VIEWER.md](./NOTE_VIEWER.md)。

## 开发

```bash
npm install
npm run build       # 产出 dist/index.js（ESM）
npm run dev         # watch 构建
```

## 发布

```bash
npm run build                  # prepublishOnly 会自动跑，这里可先手动确认
npm publish --access public    # 首次发布；scoped 包需 --access public
```

发布前改 `package.json` 的 `version`（遵循 semver）。

## License

[MIT](./LICENSE)
