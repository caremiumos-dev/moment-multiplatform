/**
 * 抽帧功能的最小验证：直接调 extractVideoCover，把结果写成图片看效果。
 *
 * 注意别在模块顶层 `await app.whenReady()` —— ESM 的顶层 await 会在主进程
 * 完成初始化之前求值，然后整个脚本就静默挂住了。一律放进 `.then()` 里。
 *
 * 用法：npx electron scripts/cover-probe.mjs <video.mp4> [out.jpg]
 */

import { app } from 'electron'
import { copyFile } from 'node:fs/promises'
import { extractVideoCover } from '../out/main/cover-probe.js'

const videoPath = process.argv[2]
const outPath = process.argv[3] ?? 'cover-probe.jpg'

if (!videoPath) {
  console.error('缺少视频路径')
  app.exit(2)
}

app.whenReady().then(async () => {
  try {
    const started = Date.now()
    const cover = await extractVideoCover(videoPath)
    await copyFile(cover, outPath)
    console.log(`OK 抽帧耗时 ${Date.now() - started}ms -> ${outPath}`)
    app.exit(0)
  } catch (error) {
    console.error('FAIL', error instanceof Error ? error.message : error)
    app.exit(1)
  }
})
