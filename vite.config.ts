import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 库构建：把 src/index.js 及其依赖（含 .vue 组件与 TS 适配层）打成单文件 ESM 产物。
 * 宿主框架与 UI 库一律 external，避免使用方重复安装多份 Vue / Element Plus。
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      // 一律由使用方提供：vue / element-plus 是运行必需，
      // mp4-muxer 仅在导出 MP4 时按需安装，jspdf 本包只用其类型
      external: ['vue', 'element-plus', '@element-plus/icons-vue', 'mp4-muxer', 'jspdf']
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // 库产物不压缩，交给使用方的打包器统一处理
    minify: false,
    target: 'es2020'
  }
})
