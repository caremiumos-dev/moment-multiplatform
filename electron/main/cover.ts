/**
 * 从视频里抽一帧当封面。
 *
 * 为什么不用 ffmpeg：不想为一个封面引入几十 MB 的二进制依赖，也不想让它变成
 * 「用户装不上应用」的理由。Chromium 本来就能解码 mp4/webm，所以起一个隐藏窗口
 * 加载本地视频，把 `<video>` 画到 canvas 上，取它的 data URL 写盘。
 *
 * 两个必须绕开的坑：
 * - 隐藏窗口里 `requestAnimationFrame` 不会触发（没有合成器在跑），
 *   所以等帧一律用 `setTimeout`，不能用 rAF；
 * - 视频解码同样是异步的，`loadeddata` 之后 `drawImage` 才拿得到画面。
 *
 * 局限（都是接受的）：
 * - 只认 Chromium 能解的容器（mp4/h264、webm/vp9…），选文件时也只放开这些；
 * - 第一帧若是淡入的纯黑，会按 `SEEK_CANDIDATES` 依次往后挪再试；
 * - 抽帧失败不阻断发布，封面留空，由手表端显示默认图。
 */

import { BrowserWindow, nativeImage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
/** 封面尺寸跟服务端 `CloudFileResource` 报的 320x360 对齐，列表里不会被二次拉伸。 */
export const COVER_WIDTH = 320
export const COVER_HEIGHT = 360

/** 单次取帧的硬超时。坏文件、超大文件都不该把发布流程卡死。 */
const CAPTURE_TIMEOUT_MS = 20_000

/**
 * 依次尝试的取帧时间点（秒）。
 *
 * 0 是真·第一帧；后面几个是给「片头是黑场淡入」这类视频兜底的 ——
 * 手表端拿黑图当封面还不如拿第 1 秒的画面。
 */
const SEEK_CANDIDATES = [0, 0.5, 1.5]

/**
 * 在页面里跑的抽帧逻辑。
 *
 * 两个坑都踩过：
 * - 隐藏窗口没有合成器，`requestAnimationFrame` 可能永不触发，等帧一律用定时器；
 * - `executeJavaScript` 返回的 Promise 里**不要**再挂事件监听等 `loadeddata`，
 *   在无头窗口里那个事件可能迟迟不来，整个调用就挂死了。
 *   改成轮询 `readyState`，每 50ms 看一次，简单且不会悬空。
 */
const frameScript = (opts: { src: string; width: number; height: number; at: number }): string => `
(async () => {
  const opts = ${JSON.stringify(opts)}
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = opts.src
  document.body.appendChild(video)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  try {
    // 轮询到「有足够数据可画」为止：HAVE_CURRENT_DATA 就够 drawImage 用了。
    const deadline = Date.now() + 12000
    while (video.readyState < 2) {
      if (video.error) return 'error:video-' + video.error.code
      if (Date.now() > deadline) return 'error:load-timeout'
      await sleep(50)
    }

    if (opts.at > 0) {
      video.currentTime = Math.min(opts.at, Math.max(0, (video.duration || 0) - 0.05))
      const seekDeadline = Date.now() + 5000
      while (Date.now() < seekDeadline) {
        if (video.readyState >= 2) break
        await sleep(50)
      }
      // seek 之后给解码器一点时间。
      await sleep(150)
    }

    const w = opts.width
    const h = opts.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return 'error:no-2d-context'

    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0
    if (!vw || !vh) return 'error:no-video-size'

    // 先铺一层墨色：竖屏视频按 cover 裁满，两侧不会露出白底。
    ctx.fillStyle = '#1C1B19'
    ctx.fillRect(0, 0, w, h)

    const scale = Math.max(w / vw, h / vh)
    const dw = vw * scale
    const dh = vh * scale
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh)

    return canvas.toDataURL('image/jpeg', 0.86)
  } catch (error) {
    return 'error:' + (error && error.message ? error.message : 'unknown')
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
})()
`

/** 画面是不是一片黑（片头淡入的常见情况）。 */
async function isBlankFrame(filePath: string): Promise<boolean> {
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return true
  const { width, height } = image.getSize()
  if (!width || !height) return true
  const bitmap = image.toBitmap() // BGRA
  let sum = 0
  let count = 0
  // 抽样即可，不用逐像素：保证大约采几千个点。
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4
      sum += (bitmap[offset] ?? 0) + (bitmap[offset + 1] ?? 0) + (bitmap[offset + 2] ?? 0)
      count += 1
    }
  }
  if (count === 0) return true
  return sum / count / 765 < 0.08
}

/** 在隐藏窗口里跑一次抽帧，返回 JPEG 字节。 */
async function captureFrame(videoPath: string, at: number): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 本地视频走 file://，而这个窗口不加载任何远端内容。
      // 关掉 webSecurity 才能让 about:blank 里的 <video> 读到 file:// 资源。
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  let timer: NodeJS.Timeout | undefined
  try {
    // `loadURL('about:blank')` 返回后页面即可执行脚本，实测 300ms 内就绪。
    // 不要在这里再挂 did-finish-load 或轮询 isLoading —— 两者组合会互相等待，
    // 表现为抽帧永久挂住（踩过）。
    await win.loadURL('about:blank')

    const payload = frameScript({
      src: pathToFileURL(videoPath).href,
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      at,
    })

    const result = await Promise.race([
      win.webContents.executeJavaScript(payload, true) as Promise<unknown>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('capture timeout')), CAPTURE_TIMEOUT_MS)
      }),
    ])

    if (typeof result !== 'string') throw new Error('unexpected frame payload')
    if (result.startsWith('error:')) throw new Error(result)
    if (!result.startsWith('data:image/')) throw new Error('frame is not an image')

    const comma = result.indexOf(',')
    return Buffer.from(result.slice(comma + 1), 'base64')
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * 抽封面并写到磁盘，返回封面绝对路径。失败时抛错，由调用方决定是否忽略。
 *
 * 封面放在系统临时目录下的独立文件夹里，发布完由 `cleanupCover` 删掉，
 * 不会在用户机器上留垃圾。
 */
export async function extractVideoCover(videoPath: string): Promise<string> {
  const dir = join(tmpdir(), 'moment-web-covers')
  await mkdir(dir, { recursive: true })

  let lastError: unknown = null
  for (const [index, at] of SEEK_CANDIDATES.entries()) {
    const candidate = join(dir, `cover-${Date.now()}-${index}.jpg`)
    try {
      const bytes = await captureFrame(videoPath, at)
      await writeFile(candidate, bytes)
      // 只有第一个档位挑剔纯黑：后面的档位有画面就收，避免全都黑时白折腾。
      if (index === 0 && (await isBlankFrame(candidate))) {
        await rm(candidate, { force: true })
        continue
      }
      return candidate
    } catch (error) {
      lastError = error
      await rm(candidate, { force: true })
    }
  }

  throw lastError instanceof Error ? lastError : new Error('封面抽取失败')
}

/** 把封面读成 data URL，给界面显示「抽到的是哪一帧」。 */
export async function readCoverAsDataUrl(coverPath: string): Promise<string> {
  const bytes = await readFile(coverPath)
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

/** 发布结束（成功或失败）后删掉临时封面。 */
export async function cleanupCover(coverPath: string): Promise<void> {
  await rm(coverPath, { force: true }).catch(() => {})
}
