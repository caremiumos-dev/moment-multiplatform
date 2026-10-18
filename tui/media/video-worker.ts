/**
 * 视频解码子进程。
 *
 * 由 `video.ts` fork 出来，负责所有重活：
 * demux → decode → scale → sixel 编码，以及音轨 → speaker。
 *
 * 关键设计：
 *
 * - **按真实时钟出帧**。视频是 30fps 而终端可能只能承受 15fps，
 *   所以这里按「该帧的时间戳」决定要不要解、解完要不要推。
 *   跟不上的帧直接丢，保证音频与画面对得上（音频不能丢帧）。
 * - **编码在子进程完成**。主进程只拿到一个字符串就 write，不做任何计算。
 * - **音频独立于视频节奏**。PCM 直接推进 speaker，speaker 自己按声卡速度消费，
 *   不需要我们算采样数。这样即使画面掉帧，声音依然连续。
 */

import { image2sixel } from 'sixel'

interface StartMessage {
  type: 'start'
  source: {
    path: string
    width: number
    fps: number
    audio: boolean
  }
}

type ParentMessage = StartMessage | { type: 'stop' } | { type: 'pause'; paused: boolean }

let stopped = false
let paused = false
let speakerRef: { write(chunk: Buffer): boolean; end(): void; destroy?(): void } | null = null

const send = (message: unknown): void => {
  if (process.connected) process.send?.(message)
}

process.on('message', (raw: unknown) => {
  const message = raw as ParentMessage
  if (message.type === 'stop') {
    stopped = true
    speakerRef?.end()
  } else if (message.type === 'pause') {
    paused = message.paused
  } else if (message.type === 'start') {
    void run(message.source).catch((error: Error) => {
      send({ type: 'error', message: error.message })
      process.exit(0)
    })
  }
})

process.on('disconnect', () => {
  stopped = true
  process.exit(0)
})

async function run(source: StartMessage['source']): Promise<void> {
  // 动态 import：node-av 是原生模块，加载有开销，放到子进程里加载
  // 就不会拖慢主进程启动。
  const { Demuxer, Decoder, Scaler } = await import('node-av/api')

  await using input = await Demuxer.open(source.path)
  const video = input.video()
  if (!video) {
    send({ type: 'error', message: '这个文件里没有视频流' })
    return
  }

  const audioStream = input.audio()
  const durationMs = Math.round((input.duration ?? 0) * 1000)
  send({
    type: 'ready',
    durationMs,
    hasAudio: Boolean(audioStream),
    width: source.width,
    height: Math.round(source.width * ((video.codecpar.height ?? 9) / (video.codecpar.width ?? 16))),
  })

  // 音轨先起：它自己按声卡节奏消费，不占视频的循环。
  if (source.audio && audioStream) {
    void playAudio(input, audioStream, Decoder).catch(() => {
      // 播不了声音不影响画面。
    })
  }

  await using decoder = await Decoder.create(video)
  using scaler = new Scaler()

  // 高度要在拿到第一帧后才知道，这里先按宽高比估算，实际编码时再对齐。
  let targetWidth = 0
  let targetHeight = 0
  const minIntervalMs = source.fps > 0 ? 1000 / source.fps : 0

  let frameIndex = 0
  let lastEmitAt = 0
  const startedAt = Date.now()

  for await (const frame of decoder.frames(input.packets(video.index))) {
    if (stopped) break
    // 生成器收尾时可能吐出 null（解码器 flush），跳过而不是崩。
    if (!frame) continue

    // 首帧确定目标尺寸。
    if (targetWidth === 0) {
      targetWidth = Math.max(8, source.width)
      // 高度按源比例，并取偶数（Sixel 的行是 6 像素对齐的，偶数高度不会浪费）。
      const ratio = (frame.height ?? 1) / (frame.width ?? 1)
      targetHeight = Math.max(8, Math.round((targetWidth * ratio) / 2) * 2)
    }

    // 时间戳换算成毫秒。pts 是 bigint，timeBase 是 Rational。
    const pts = Number(frame.pts ?? 0n)
    const timeBase = frame.timeBase ?? { num: 1, den: 1 }
    const frameTimeMs = (pts * Number(timeBase.num) * 1000) / Number(timeBase.den)

    // 按真实时钟节流：还没到该出帧的时间就跳过编码，省下 CPU。
    const elapsed = Date.now() - startedAt
    if (frameTimeMs > elapsed + 120) {
      // 解码跑得比播放快，等一下让它按播放速度出。
      await sleep(Math.min(80, frameTimeMs - elapsed))
    }
    if (minIntervalMs > 0 && Date.now() - lastEmitAt < minIntervalMs * 0.8) {
      continue
    }

    if (paused) {
      await sleep(40)
      continue
    }

    try {
      const rgba = scaler.toBufferSync(frame, {
        resize: { width: targetWidth, height: targetHeight },
        format: 'rgba',
      })
      const data = image2sixel(new Uint8Array(rgba), targetWidth, targetHeight, 256, 1)
      lastEmitAt = Date.now()

      send({
        type: 'frame',
        data,
        rows: Math.ceil(targetHeight / 16),
        index: frameIndex,
        timeMs: Math.round(frameTimeMs),
      })
      frameIndex++
    } catch (error) {
      send({ type: 'error', message: `帧编码失败：${(error as Error).message}` })
      break
    }
  }

  // 等音频把尾巴放完再退出，否则最后一小段声音会被切断。
  if (source.audio && audioStream && !stopped) {
    await sleep(400)
  }
  speakerRef?.end()
  send({ type: 'end' })
  process.exit(0)
}

/**
 * 音轨播放。
 *
 * 链路：解出音频帧 → `aformat` 滤镜统一成 s16/44.1k/双声道 → 取原始 PCM → 推给 speaker。
 *
 * 为什么要过滤镜：源里的音频可能是 22050Hz 单声道 AAC，而声卡只接受固定格式。
 * 不转换直接写，听起来是「快放/慢放 + 噼啪噪声」，那种问题很难从现象反推原因。
 * `AudioFrameBuffer` 是给编码器做定长缓冲的，不是干这个用的；格式统一交给滤镜最直接。
 *
 * 为什么不在主进程做：speaker 的 write 会阻塞等声卡缓冲，放在主进程会把 ink 重绘卡住。
 */
/**
 * 在子进程里播音频。
 *
 * 这里**不用 FilterAPI 重采样**。试过 `aformat=...` + `filter.process(frame)`，
 * 返回的一直是 null（FFmpeg 那边报 "100 buffers queued in out"）—— 图没被激活，
 * 一个 PCM 字节都拿不到。而 `AudioFrameBuffer` 在 node-av 6.1 里构造就抛
 * `nbSamples: A number was expected`，也是个死路。
 *
 * 现在直接读 `frame.data`：解码器已经把音频解成 PCM 了，那就是现成的交织数据。
 * 按**源文件的采样率/声道数**开 speaker，不做任何转换 —— 少一层就少一处出错，
 * 实测能正常出声。
 *
 * 格式不是 s16 的话（极少见）直接跳过音频，不出声总比出噪音好。
 */
/** AV_SAMPLE_FMT_* 常量。 */
const AV_SAMPLE_FMT_S16 = 1
const AV_SAMPLE_FMT_FLT = 3
const AV_SAMPLE_FMT_FLTP = 8

/**
 * 把一个解码帧转成 16 位有符号 PCM。
 *
 * 为什么要手写：FFmpeg 解出来的音频常常是 **FLTP**（每声道一个 float32 平面，
 * AAC 基本都是），而 speaker 只吃 s16 交织。node-av 的两条转换路子都走不通 ——
 *
 * - `FilterAPI` + `aformat`：`filter.process()` 一直返回 null，一个字节都拿不到；
 * - `AudioFrameBuffer`：构造时直接抛 `nbSamples: A number was expected`。
 *
 * 所以自己转。样本量不大（每秒几万），JS 循环完全跟得上。
 */
function frameToS16(
  frame: { data?: ArrayLike<number>[]; nbSamples?: number; channels?: number; format?: number },
): { pcm: Buffer; samples: number; channels: number } | null {
  const planes = frame.data
  const nbSamples = frame.nbSamples ?? 0
  const channels = frame.channels ?? 1
  if (!planes || nbSamples <= 0) return null

  const format = frame.format
  const out = Buffer.alloc(nbSamples * channels * 2)

  const readPlane = (channel: number): Uint8Array | null => {
    const plane = planes[channel] as unknown as Uint8Array | undefined
    return plane ?? null
  }

  if (format === AV_SAMPLE_FMT_FLTP) {
    // 每声道一个 float32 平面。
    const chans: Float32Array[] = []
    for (let c = 0; c < channels; c++) {
      const plane = readPlane(c)
      if (!plane) return null
      chans.push(
        new Float32Array(plane.buffer.slice(plane.byteOffset, plane.byteOffset + nbSamples * 4)),
      )
    }
    for (let i = 0; i < nbSamples; i++) {
      for (let c = 0; c < channels; c++) {
        const v = Math.max(-1, Math.min(1, chans[c]![i] ?? 0))
        out.writeInt16LE(Math.round(v * 32767), (i * channels + c) * 2)
      }
    }
    return { pcm: out, samples: nbSamples, channels }
  }

  if (format === AV_SAMPLE_FMT_FLT) {
    // 交织 float32。
    const plane = readPlane(0)
    if (!plane) return null
    const src = new Float32Array(
      plane.buffer.slice(plane.byteOffset, plane.byteOffset + nbSamples * channels * 4),
    )
    for (let i = 0; i < nbSamples * channels; i++) {
      const v = Math.max(-1, Math.min(1, src[i] ?? 0))
      out.writeInt16LE(Math.round(v * 32767), i * 2)
    }
    return { pcm: out, samples: nbSamples, channels }
  }

  if (format === AV_SAMPLE_FMT_S16) {
    const plane = readPlane(0)
    if (!plane) return null
    return { pcm: Buffer.from(plane.subarray(0, nbSamples * channels * 2)), samples: nbSamples, channels }
  }

  return null
}

/**
 * 把 PCM 从源采样率线性插值重采样到目标采样率。
 *
 * 用的是最朴素的线性插值 —— 对语音/音乐来说听感够用，也不需要额外的库。
 */
function resample(
  pcm: Buffer,
  fromRate: number,
  toRate: number,
  channels: number,
): { pcm: Buffer; samples: number } {
  if (fromRate === toRate || fromRate <= 0) {
    return { pcm, samples: pcm.length / (2 * channels) }
  }
  const fromSamples = Math.floor(pcm.length / (2 * channels))
  const toSamples = Math.round((fromSamples * toRate) / fromRate)
  const out = Buffer.alloc(toSamples * channels * 2)
  const ratio = fromRate / toRate
  for (let i = 0; i < toSamples; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(fromSamples - 1, i0 + 1)
    const frac = pos - i0
    for (let c = 0; c < channels; c++) {
      const s0 = pcm.readInt16LE((i0 * channels + c) * 2)
      const s1 = pcm.readInt16LE((i1 * channels + c) * 2)
      out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), (i * channels + c) * 2)
    }
  }
  return { pcm: out, samples: toSamples }
}

/**
 * 在子进程里播音频。
 */
async function playAudio(
  input: unknown,
  audioStream: unknown,
  Decoder: { create(stream: unknown): Promise<unknown> },
): Promise<void> {
  const Speaker = (await import('speaker')).default

  const stream = audioStream as {
    index: number
    codecpar?: { sampleRate?: number; channels?: number }
  }
  const sourceRate = stream.codecpar?.sampleRate ?? 44100
  const targetRate = 44100

  const decoder = (await Decoder.create(stream)) as {
    frames(packets: unknown): AsyncIterable<Record<string, unknown> | null>
  }
  const demuxer = input as { packets(index: number): unknown }

  let speaker: InstanceType<typeof Speaker> | null = null

  try {
    for await (const frame of decoder.frames(demuxer.packets(stream.index))) {
      if (stopped) break
      if (!frame) continue

      const converted = frameToS16(frame as never)
      if (!converted) continue

      // speaker 按第一帧的真实声道数开，避免猜错。
      if (!speaker) {
        const channels = converted.channels
        const rate = sourceRate
        speaker = new Speaker({ sampleRate: rate, channels, bitDepth: 16 })
        speakerRef = speaker as unknown as typeof speakerRef
      }

      const { pcm, channels } = converted as { pcm: Buffer; channels: number }
      const shaped =
        sourceRate === targetRate ? pcm : resample(pcm, sourceRate, targetRate, channels).pcm

      // 暂停时别往声卡写，等缓冲耗尽自然安静。
      while (paused && !stopped) {
        await sleep(30)
      }
      if (stopped) break

      speaker.write(shaped)
    }
  } catch {
    // 音频出问题不能拖垮画面。
  } finally {
    speaker?.end()
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
