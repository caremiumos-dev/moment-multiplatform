/**
 * 视频播放子进程。
 *
 * 为什么要单独开进程：
 *
 * node-av 的原生解码是同步 N-API 调用。哪怕只是解一帧 240×270，
 * 一旦放进主进程的 event loop，Sixel 编码、ink 重绘、按键响应都会被它挡住 ——
 * 实测表现为「画面一顿一顿、按键半秒才响应」。
 *
 * 所以这里把整个解码链路（demux → decode → scale → sixel）放子进程，
 * 用 `child_process.fork` 起一个独立的 Node，靠 IPC 把已经编码好的帧字符串传回来。
 * 主进程只负责「打印这一帧」，几乎没有计算量。
 *
 * 另一个好处是**音频也能天然并行**：ffmpeg 解码出来的 PCM 直接喂给 speaker，
 * 而 speaker 是阻塞的音频设备写入，放在主进程同样会拖慢渲染。
 *
 * 协议：主进程 send({type:'start', ...})，子进程回 {type:'frame'|'end'|'error', ...}。
 */

import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

export interface VideoSource {
  /** 本地文件路径。远程视频先下到临时目录再播。 */
  path: string
  /** 渲染宽度（像素）。高度按源比例算。 */
  width: number
  /** 目标帧率。终端重绘跟不上时可以调低。 */
  fps: number
  /** 是否播放音轨。没有音轨的源会自动跳过。 */
  audio: boolean
}

export type FrameMessage = {
  type: 'frame'
  /** 已编码的 Sixel / OSC1337 数据，主进程直接 write。 */
  data: string
  /** 这一帧应占的字符行数。 */
  rows: number
  /** 帧序号，用于统计丢帧。 */
  index: number
  /** 该帧在视频里的时间（毫秒），用于音画对齐与进度。 */
  timeMs: number
}

export type VideoMessage =
  | FrameMessage
  | { type: 'ready'; durationMs: number; hasAudio: boolean; width: number; height: number }
  | { type: 'end' }
  | { type: 'error'; message: string }

export interface VideoHandle {
  /** 停止播放并等待子进程退出。 */
  stop(): Promise<void>
  /** 暂停/继续（音频同时停）。 */
  setPaused(paused: boolean): void
  /** 子进程是否还活着。 */
  readonly alive: boolean
}

/**
 * 起一个播放子进程。
 *
 * @param onFrame 每解出一帧调用一次。**不要在这里做耗时操作**，
 *                它直接串在子进程的推送节奏上。
 */
export async function playVideo(
  source: VideoSource,
  handlers: {
    onFrame: (frame: FrameMessage) => void
    onReady?: (info: { durationMs: number; hasAudio: boolean; width: number; height: number }) => void
    onEnd?: () => void
    onError?: (message: string) => void
  },
): Promise<VideoHandle> {
  const child = fork(join(HERE, 'video-worker.js'), [], {
    // 子进程只传数据，不继承终端的 stdin —— 否则它和 ink 抢键盘。
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })

  let paused = false
  let ended = false

  const settle = (): void => {
    if (ended) return
    ended = true
    handlers.onEnd?.()
  }

  child.on('message', (raw: unknown) => {
    const message = raw as VideoMessage
    switch (message.type) {
      case 'ready':
        handlers.onReady?.(message)
        break
      case 'frame':
        if (!paused) handlers.onFrame(message)
        break
      case 'end':
        settle()
        break
      case 'error':
        handlers.onError?.(message.message)
        settle()
        break
    }
  })

  child.on('exit', () => {
    settle()
  })

  child.on('error', (error) => {
    handlers.onError?.(error.message)
    settle()
  })

  child.send({ type: 'start', source })

  return {
    get alive() {
      return child.connected && !ended
    },
    setPaused(next: boolean) {
      paused = next
      // 暂停时告诉子进程一起停音频，否则声音会自己跑。
      if (child.connected) child.send({ type: 'pause', paused: next })
    },
    async stop() {
      ended = true
      if (!child.connected) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 1200)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        // 先好好说一声，让子进程释放音频设备。
        child.send({ type: 'stop' })
      })
    },
  }
}

/** 类型方便上层引用。 */
export type { ChildProcess }
