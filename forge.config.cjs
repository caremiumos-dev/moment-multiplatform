/**
 * electron-forge 打包配置。
 *
 * 只打桌面端。TUI 不参与打包 —— `tui/` 目录以及 ink / node-av / speaker /
 * sixel 这些依赖都在 `devDependencies` 里，forge 的 prune 阶段会直接跳过它们，
 * 连原生模块重建都不会碰（speaker 的 binding.node 是按 Node ABI 编的，
 * 留在生产依赖里会触发 @electron/rebuild，多半直接失败）。
 *
 * 运行时真正需要的外部依赖只有 moment SDK：
 * - 主进程的 `core/` 已经被 electron-vite 打进 `out/main/index.js`；
 * - 渲染层整体打进 `out/renderer`，React 不需要以 node_modules 形式存在。
 */
module.exports = {
  // forge 默认输出到 `out/`，而 electron-vite 的构建产物也在 `out/`。
  // packager 会把自己 outDir 下的内容整体排除，两者撞上就会报
  // 「out directory contains your app's main entry point」——所以必须错开。
  outDir: 'release',
  packagerConfig: {
    name: 'moment-web',
    executableName: 'moment-web',
    asar: true,
    appBundleId: 'com.caremiumos.moment',
    appCategoryType: 'public.app-category.social-networking',
    ignore: [
      // 源码与开发期资产，运行时用不到（main/preload 的产物都在 out/）
      /^\/\.git($|\/)/,
      /^\/\.gitignore$/,
      /^\/electron($|\/)/,
      /^\/src($|\/)/,
      /^\/core($|\/)/,
      /^\/tui($|\/)/,
      /^\/scripts($|\/)/,
      /^\/tsconfig[^/]*\.json$/,
      /^\/electron\.vite\.config\.ts$/,
      /^\/forge\.config\.cjs$/,
      /^\/README\.md$/,
      // 构建缓存与调试产物
      /^\/out\/.*\.map$/,
      /^\/node_modules\/\.vite($|\/)/,
      /^\/node_modules\/\.package-lock\.json$/,
      // 兜底：即使依赖被放回生产依赖，也不让 TUI 相关模块进包
      /^\/node_modules\/(ink|figures|node-av|speaker|sixel|react-devtools-core)($|\/)/,
      /^\/node_modules\/@seydx($|\/)/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin', 'linux'],
    },
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'moment_web',
        setupExe: 'moment-web-setup.exe',
        noMsi: true,
      },
    },
  ],
}
