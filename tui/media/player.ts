/**
 * 终端视频播放器。
 *
 * 播放期间**绕开 ink**，自己接管 stdout：
 *
 * 1. 记住图片区域左上角的位置（`\x1b[s` 存光标，之后每次 `\x1b[u` 回来）；
 * 2. 每收到一帧，回到那个位置、覆盖写出、再把光标推回下方给状态栏用；
 * 3. 退出时擦掉这块区域，恢复终端。
 *
 * 为什么不交给 ink：一帧 200×113 的 Sixel 是 44KB，ink 每次 `setState` 都会
 * 重新 diff 整棵树并按字符估算宽度，实测会把帧率压到个位数。
 * 这里只做「回光标 + 写字节」，稳定跑满 15fps。
 */

import type { VideoHandle } from './video.js'
import { playVideo } from './video.js'

export interface PlayerOptions {
  /** 本地视频路径。 */
  path: string
  /** 画面宽度（像素）。高度按源比例。 */
  width: number
  /** 目标帧率。 */
  fps?: number
  /** 是否播放声音。 */
  audio?: boolean
  /** 每帧渲染后回调，用于画进度/状态栏；`undefined` 表示已结束。 */
  onStatus?: (status: PlayerStatus) => void
  /** 播放结束（自然结束或被 stop）时的回调。 */
  onEnd?: () => void
}

export interface PlayerStatus {
  index: number
  timeMs: number
  durationMs: number
  /** 由外部控制时，用来判断是否还在缓冲。 */
  playing: boolean
}

export interface TerminalPlayer {
  stop(): Promise<void>
  setPaused(paused: boolean): void
}

/**
 * 在当前位置播放一段视频。
 *
 * 调用方要先清好屏并把光标放在图片左上角该在的位置。
 */
export async function playInTerminal(options: PlayerOptions): Promise<TerminalPlayer> {
  const stdout = process.stdout
  const fps = options.fps ?? 15

  // 存下图片区左上角，之后每帧回到这里。
  stdout.write('\x1b[s')

  let durationMs = 0
  let paused = false
  let finished = false
  let handle: VideoHandle | null = null

  const finish = (): void => {
    if (finished) return
    finished = true
    options.onStatus?.({
      index: 0,
      timeMs: durationMs,
      durationMs,
      playing: false,
    })
    options.onEnd?.()
  }

  handle = await playVideo(
    {
      path: options.path,
      width: options.width,
      fps,
      audio: options.audio ?? true,
    },
    {
      onReady: (info) => {
        durationMs = info.durationMs
      },
      onFrame: (frame) => {
        // 回到图片区左上角，整块覆盖写。不用清屏 —— Sixel 会自己填满矩形。
        stdout.write('\x1b[u')
        stdout.write(frame.data)
        stdout.write('\x1b[0m')
        options.onStatus?.({
          index: frame.index,
          timeMs: frame.timeMs,
          durationMs,
          playing: !paused,
        })
      },
      onEnd: finish,
      onError: (message) => {
        options.onStatus?.({ index: 0, timeMs: 0, durationMs, playing: false })
        process.stderr.write(`\n播放出错：${message}\n`)
        finish()
      },
    },
  )

  return {
    setPaused(next: boolean) {
      paused = next
      handle?.setPaused(next)
    },
    async stop() {
      await handle?.stop()
      // 把播放区域擦干净，别让残留像素糊住后面的界面。
      stdout.write('\x1b[u')
      stdout.write('\x1b[0J')
      stdout.write('\x1b[0m')
      finish()
    },
  }
}

/** 格式化 `1:05` 这种时间。 */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * 一条能放进终端的进度条。
 *
 * 用 `█` 和 `░` 而不是 `=`/`-`：后者在等宽字体里看着断断续续，
 * 前者是连续的块，扫一眼就知道进度。
 */
export function progressBar(current: number, total: number, width = 24): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
  const filled = Math.round(ratio * width)
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`
}
