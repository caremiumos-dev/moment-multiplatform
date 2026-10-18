#!/usr/bin/env node
/**
 * 好友圈 · 终端版入口。
 *
 * 子命令：
 *   moment                启动交互界面
 *   moment feed           打印一页动态（非交互，可管道）
 *   moment show <序号>    显示某条动态的图片（Sixel / iTerm2 / 色块）
 *   moment play <文件>    在终端里播放视频（画面 + 声音）
 *   moment doctor         检查终端能力与依赖
 *
 * 之所以保留非交互子命令：终端用户习惯把东西接进管道（`moment feed | head`），
 * 只给一个全屏 TUI 反而不方便。
 */

import { parseArgs } from 'node:util'
import process from 'node:process'

const USAGE = `
好友圈 · 终端版

用法
  moment                 打开交互界面
  moment feed [--limit n] 打印动态（非交互）
  moment show <序号>      显示动态里的图片
  moment play <文件>      在终端播放视频（Sixel 画面 + 声音）

选项
  --theme dark|light|auto   配色（默认 auto）
  --no-images               不显示图片
  --width n                 图片宽度（像素，默认 200）

环境变量
  MOMENT_IMAGES=sixel|iterm|blocks|none   强制图片协议
  MOMENT_SIXEL=1|0                        强制开关 Sixel
  MOMENT_CONFIG_DIR                       配置目录
`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      theme: { type: 'string', default: 'auto' },
      'no-images': { type: 'boolean', default: false },
      width: { type: 'string', default: '200' },
      limit: { type: 'string', default: '20' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })

  if (values.help) {
    process.stdout.write(USAGE)
    return
  }
  if (values.version) {
    process.stdout.write('moment-tui 0.1.0\n')
    return
  }

  if (values['no-images']) process.env.MOMENT_IMAGES = 'none'

  const command = positionals[0] ?? 'ui'

  switch (command) {
    case 'ui':
      await runUi(values.theme as string)
      break
    case 'feed':
      await runFeed(Number(values.limit))
      break
    case 'show':
      await runShow(Number(positionals[1] ?? '1'), Number(values.width))
      break
    case 'play':
      await runPlay(positionals[1], Number(values.width))
      break
    case 'doctor':
      await runDoctor()
      break
    default:
      process.stderr.write(`未知命令：${command}\n${USAGE}`)
      process.exitCode = 1
  }
}

async function runUi(theme: string): Promise<void> {
  const { detectImageCapability } = await import('./media/capability.js')
  const { startTui } = await import('./app.js')

  // ink 需要真正的 TTY 才能接管光标和键盘；重定向到管道时它会画出半屏乱码。
  // 这种情况直接告诉用户该用哪个子命令，而不是硬渲染。
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write(
      '交互界面需要一个真正的终端（stdout 不是 TTY）。\n' +
        '如果是在脚本或管道里用，试试这些非交互命令：\n' +
        '  moment feed      打印动态\n' +
        '  moment show 1    显示图片\n' +
        '  moment doctor    检查终端能力\n',
    )
    process.exitCode = 1
    return
  }

  const capability = detectImageCapability()

  await startTui({
    capability,
    theme: theme === 'dark' || theme === 'light' ? theme : 'auto',
    version: '0.1.0',
  })
}

async function runFeed(limit: number): Promise<void> {
  const data = await import('./data.js')
  const { loadCredential } = await import('./store.js')
  await ensureSession(data, loadCredential)

  const page = await data.listFeed(undefined, Math.min(Math.max(limit, 1), 200))
  for (const [index, moment] of page.moments.entries()) {
    const text = moment.text.replace(/\s+/g, ' ').trim()
    process.stdout.write(
      `${String(index + 1).padStart(2)}  ${moment.authorName}  ${text.slice(0, 60)}\n`,
    )
  }
  process.stdout.write(`\n共 ${page.total} 条\n`)
}

async function runShow(index: number, width: number): Promise<void> {
  const data = await import('./data.js')
  const { loadCredential } = await import('./store.js')
  const { detectImageCapability } = await import('./media/capability.js')
  const { prepareSixel } = await import('./media/capability.js')
  const { encodeBlocks } = await import('./media/blocks.js')
  await ensureSession(data, loadCredential)

  const capability = detectImageCapability()
  const page = await data.listFeed()
  const moment = page.moments[index - 1]
  if (!moment) {
    process.stderr.write(`没有第 ${index} 条动态\n`)
    process.exitCode = 1
    return
  }

  const imageUrl = moment.images[0] ?? moment.cover
  if (!imageUrl) {
    process.stderr.write('这条动态没有图片\n')
    return
  }

  const file = await downloadToTemp(imageUrl)
  const { Demuxer, Decoder, Scaler } = await import('node-av/api')
  await using input = await Demuxer.open(file)
  const video = input.video()
  if (!video) {
    process.stderr.write('这个文件里没有图像\n')
    return
  }
  await using decoder = await Decoder.create(video)
  using scaler = new Scaler()

  const codec = (video as { codecpar: { width?: number; height?: number } }).codecpar
  const height = Math.round((width * (codec.height ?? 9)) / (codec.width ?? 16))
  for await (const frame of decoder.frames(input.packets(video.index))) {
    if (!frame) continue

    if (capability.protocol === 'sixel' || capability.protocol === 'iterm') {
      const rgba = scaler.toBufferSync(frame, {
        resize: { width, height },
        format: 'rgba',
      })
      const image = prepareSixel(new Uint8Array(rgba), width, height)
      process.stdout.write(image.data)
      process.stdout.write('\x1b[0m\n')
    } else {
      const rgba = scaler.toBufferSync(frame, { resize: { width, height }, format: 'rgba' })
      const blocks = encodeBlocks(new Uint8Array(rgba), width, height, ((process.stdout as unknown as { columns?: number }).columns ?? 80) - 2)
      process.stdout.write(`${blocks.lines.join('\n')}\n`)
    }
    break
  }
}

async function runPlay(path: string | undefined, width: number): Promise<void> {
  if (!path) {
    process.stderr.write('用法：moment play <视频文件>\n')
    process.exitCode = 1
    return
  }

  const { playInTerminal, formatTime, progressBar } = await import('./media/player.js')
  const { detectImageCapability } = await import('./media/capability.js')
  const capability = detectImageCapability()

  if (capability.protocol !== 'sixel' && capability.protocol !== 'iterm') {
    process.stderr.write(
      `当前终端画不出视频画面（${capability.reason}）。\n` +
        'Windows Terminal、WezTerm、mintty、mlterm、Konsole 都支持 Sixel。\n' +
        '也可以设 MOMENT_IMAGES=sixel 强制尝试。\n',
    )
    process.exitCode = 1
    return
  }

  process.stdout.write('\x1b[2J\x1b[H')
  let duration = 0

  const player = await playInTerminal({
    path,
    width,
    fps: 15,
    audio: true,
    onStatus: (status) => {
      duration = status.durationMs
      // 状态栏画在图片下方：先推到图片外，再写一行。
      process.stdout.write(
        `\r音量 ▮  ${formatTime(status.timeMs)} / ${formatTime(duration)}  ${progressBar(status.timeMs, duration)}`,
      )
    },
    onEnd: () => {
      process.stdout.write('\n')
      process.exit(0)
    },
  })

  // Ctrl+C 优雅收尾，别把终端留在半屏图形状态。
  process.on('SIGINT', () => {
    void player.stop().then(() => process.exit(0))
  })
}

async function runDoctor(): Promise<void> {
  const { detectImageCapability } = await import('./media/capability.js')
  const capability = detectImageCapability()

  const lines: string[] = []
  lines.push('好友圈 · 终端诊断\n')
  lines.push(`Node        ${process.version}`)
  lines.push(`平台        ${process.platform} ${process.arch}`)
  lines.push(`终端        TERM=${process.env.TERM ?? '(未设置)'}  TERM_PROGRAM=${process.env.TERM_PROGRAM ?? '(未设置)'}`)
  lines.push(`Windows Terminal  ${process.env.WT_SESSION ? '是' : '否'}`)
  lines.push(`真彩色      ${process.env.COLORTERM ?? '(未设置)'}`)
  lines.push('')
  lines.push(`图片协议    ${capability.protocol}  (${capability.reason})`)

  // 检查可选依赖。
  for (const name of ['node-av', 'speaker', 'sixel']) {
    try {
      await import(name)
      lines.push(`依赖 ${name.padEnd(9)} 可用`)
    } catch {
      lines.push(`依赖 ${name.padEnd(9)} 缺失`)
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`)
}

async function ensureSession(
  data: typeof import('./data.js'),
  loadCredential: () => Promise<import('../core/credential.js').Credential | null>,
): Promise<void> {
  const credential = await loadCredential()
  if (!credential) {
    process.stderr.write('还没有登录。先运行 moment 打开界面登录一次。\n')
    process.exit(1)
  }
  const session = await data.login({
    mode: credential.mode,
    baseUrl: credential.baseUrl,
    username: '',
    password: '',
    watchId: credential.watchId,
    chipId: credential.chipId,
  })
  data.setSession({ credential, profile: session.profile })
}

async function downloadToTemp(url: string): Promise<string> {
  const { writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const response = await fetch(url)
  const buffer = Buffer.from(await response.arrayBuffer())
  const path = join(tmpdir(), `moment-tui-${Date.now()}.bin`)
  await writeFile(path, buffer)
  return path
}

void main().catch((error: unknown) => {
  process.stderr.write(`出错了：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
