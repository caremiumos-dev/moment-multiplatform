/**
 * 构建 TUI。
 *
 * 用 esbuild 打两个产物：
 *
 * - `tui-dist/index.js` —— 主程序，所有 TS/TSX 打平成一个 ESM 文件。
 *   原生模块（node-av / speaker）和 sixel 保持 external：前者带 .node 二进制，
 *   塞进 bundle 会坏；后者是纯 JS 但保持 external 能少一次重复打包。
 * - `tui-dist/video-worker.js` —— 视频解码子进程，必须单独一个文件，
 *   因为它是被 `fork()` 起来的。
 *
 * 为什么不走 tsc：ink 的 JSX 需要 React 转换，而 tsc 输出 .jsx + 运行时转换太绕；
 * esbuild 一条命令就够，还快。
 */

import { build } from 'esbuild'
import { rm, mkdir } from 'node:fs/promises'

const external = ['node-av', 'node-av/api', 'speaker', 'sixel', 'electron']

/**
 * ink 的 devtools 模块会静态 `import('react-devtools-core')`，而那个包是
 * 浏览器 bundle（内部直接引用 `self`），在 Node 里加载就崩。
 * ink 只在设置了 `DEVTOOLS` 环境变量时才真正用到它，所以这里用 esbuild 的
 * alias 把它替换成一个空模块 —— 比装包更靠谱，也不用去改 ink 的源码。
 */
const devtoolsStub = {
  name: 'devtools-stub',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'devtools-stub',
      namespace: 'devtools-stub',
    }))
    build.onLoad({ filter: /.*/, namespace: 'devtools-stub' }, () => ({
      contents: 'export default null',
      loader: 'js',
    }))
  },
}

const common = {
  bundle: true,
  platform: 'node',
  // 必须是 ESM：ink 依赖的 yoga-layout 和 ink 自己都用了顶层 await，
  // CJS 输出直接报 `Top-level await is currently not supported`。
  format: 'esm',
  target: 'node20',
  external,
  jsx: 'automatic',
  jsxImportSource: 'react',
  logLevel: 'info',
  plugins: [devtoolsStub],
  /**
   * ESM 下没有 `require`，而有些 CJS 依赖（nanoid 用的 signal-exit 等）会在
   * 运行时做动态 `require('assert')`。esbuild 为此生成了一个 `__require` shim，
   * 但它只在**全局存在 `require` 变量**时才转调，否则直接 throw
   * `Dynamic require of "assert" is not supported`。
   *
   * 所以这里用 `createRequire` 造一个真的 require，并明确挂成全局 `require` ——
   * esbuild 的 shim 检查的正是这个名字。光挂 `globalThis.__momentRequire`
   * 是没用的（踩过一次）。
   */
  banner: {
    js: [
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
    ].join('\n'),
  },
  define: {
    'import.meta.url': 'import.meta.url',
  },
}

await rm('tui-dist', { recursive: true, force: true })
await mkdir('tui-dist', { recursive: true })

await build({
  ...common,
  entryPoints: ['tui/index.tsx'],
  outfile: 'tui-dist/index.js',
  // 源文件里已经写了 shebang，这里不能再加一遍 —— 重复的 `#!` 会让 Node
  // 在第二行报 `Invalid or unexpected token`。
})

await build({
  ...common,
  entryPoints: ['tui/media/video-worker.ts'],
  outfile: 'tui-dist/video-worker.js',
})

console.log('TUI 构建完成 → tui-dist/')
