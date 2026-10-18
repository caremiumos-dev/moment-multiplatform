/**
 * 主进程入口。
 *
 * 安全基线：
 * - `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`，
 *   渲染进程碰不到 Node；
 * - 只通过 preload 的 contextBridge 暴露一组白名单方法；
 * - 禁止新窗口、禁止导航到站外地址（点话题外链要跳系统浏览器）。
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc, restoreSession } from './ipc'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    backgroundColor: '#FAF8F4',
    title: '好友圈',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // 首帧画完再显示，避免白屏闪一下。
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 渲染进程的报错主进程看不到，开发时打到控制台，方便定位白屏。
  mainWindow.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event
    console.log(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] 进程异常退出', details)
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[renderer] 加载失败', code, description, url)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 站内链接留在应用里，站外的（话题 jumpUrl 之类）交给系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url !== current) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // 先把上次加密保存的凭据读回来，再开窗，免得界面先闪一下登录页。
  await restoreSession()
  registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
