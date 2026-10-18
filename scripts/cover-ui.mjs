/**
 * 界面 + IPC 验证：直接用真实的主进程入口启动应用，只把文件对话框换成固定值。
 *
 * 用 `require('electron')` 的 require cache 在入口加载前打补丁，
 * 然后正常 import 主入口，它自己会注册 IPC、恢复登录态、开主窗口。
 *
 * 用法：electron scripts/cover-ui.mjs <video.mp4>
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const { app, dialog, BrowserWindow } = electron

const cwd = process.cwd()
// 取第一个非 `--` 开头的参数作为视频路径：`--user-data-dir=...` 之类的开关
// 会排在后面，不能直接拿 argv 的最后一项。
const videoPath =
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ??
  (() => {
    console.error('[ui] 用法：electron scripts/cover-ui.mjs <video.mp4> [--user-data-dir=...]')
    process.exit(2)
  })()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[ui]', ...a)

// 全局替换文件对话框：任何一次调用都返回预设视频。
dialog.showOpenDialog = async () => {
  log('showOpenDialog → 返回预设视频')
  return { canceled: false, filePaths: [videoPath] }
}

// 加载真正的主入口。它是副作用式模块：app.whenReady 后恢复登录态、
// 注册 IPC、创建主窗口。
await import(pathToFileURL(join(cwd, 'out/main/index.js')).href)
log('主入口已加载')

app.whenReady().then(async () => {
  try {
    // 等主窗口出现
    let win = null
    for (let i = 0; i < 40; i++) {
      await sleep(300)
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (win) break
    }
    if (!win) {
      log('没等到主窗口')
      app.exit(1)
      return
    }
    log('主窗口就绪')
    await sleep(2500)

    const evalJs = (code) => win.webContents.executeJavaScript(code, true)
    const shot = async (name) => {
      const image = await win.webContents.capturePage()
      await writeFile(join(cwd, name + '.png'), image.toPNG())
      log(`已保存 ${name}.png`)
    }

    const statusRaw = await evalJs(
      `(async () => JSON.stringify(await window.moment.accountStatus()))()`,
    )
    const status = JSON.parse(statusRaw)
    log('signedIn =', status.data?.signedIn, '| watchId =', String(status.data?.watchId ?? '').slice(0, 8))
    if (!status.data?.signedIn) {
      log('未登录，无法验证发布器。')
      await shot('cover-ui-notsigned')
      app.exit(1)
      return
    }

    await evalJs(`(() => {
      const btn = [...document.querySelectorAll('button')].find((n) => n.textContent.includes('写点什么'))
      if (btn) btn.click()
      return Boolean(btn)
    })()`)
    await sleep(800)

    log('点击「视频」…')
    await evalJs(`(() => {
      const btn = [...document.querySelectorAll('.composer__tool')].find((n) => n.textContent.includes('视频'))
      if (btn) btn.click()
      return Boolean(btn)
    })()`)

    let hasThumb = false
    const t0 = Date.now()
    for (let i = 0; i < 90; i++) {
      await sleep(500)
      hasThumb = await evalJs(`Boolean(document.querySelector('.composer__coverbox img'))`)
      if (hasThumb) {
        log(`封面缩略图出现，用时 ${Date.now() - t0}ms`)
        break
      }
    }

    const info = await evalJs(`
      (() => {
        const img = document.querySelector('.composer__coverbox img')
        return {
          hasThumb: Boolean(img),
          thumbW: img ? img.naturalWidth : 0,
          thumbH: img ? img.naturalHeight : 0,
          meta: document.querySelector('.composer__covermeta .num')?.textContent?.trim() ?? '',
          actions: [...document.querySelectorAll('.composer__coveract')].map((n) => n.textContent.trim()),
          error: document.querySelector('.composer__error')?.textContent ?? '',
        }
      })()
    `)
    log('结果：', JSON.stringify(info))
    await shot('cover-ui-result')
  } catch (error) {
    log('FAIL', error instanceof Error ? error.stack : error)
  } finally {
    app.exit(0)
  }
})
