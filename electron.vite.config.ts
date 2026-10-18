import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 三段构建：
 * - main：Node 环境，SDK 只在主进程用，所以第三方依赖一律 external 掉，
 *   不参与打包（SDK 内部依赖 node:crypto / node:fs，打包进来反而会坏）。
 * - preload：运行在隔离上下文里，同样 external。
 * - renderer：纯浏览器环境，只有 React 与样式。
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload/index.ts') },
        // sandbox: true 的 preload 运行在一个受限的 CJS 环境里，
        // 不认 ESM 的 import 语句，所以必须打成 .cjs。
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})
