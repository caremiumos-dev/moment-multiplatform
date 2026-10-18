/**
 * 把动态里的图片/封面渲染到终端。
 *
 * 两种情况要分开处理：
 *
 * - **动态列表里的小缩略图**：宽度固定几十像素，随列表一起打印。
 *   用 `<Static>` 之外的普通输出即可 —— 列表是「一次性打印一大段」的模式，
 *   打印完就不再重绘，所以图片不会被打断。
 * - **详情页的大图**：用户主动按 `o` 打开，独占一块区域。
 *
 * 图片源是 URL，得先下载到临时文件再交给 node-av 解码（它的 `Demuxer.open`
 * 也能直接吃 Buffer，但走文件更稳，还能复用系统缓存）。
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Capability } from './capability.js'

/**
 * 图片缓存目录。
 *
 * 放系统临时目录而不是配置目录：这些是随时可以丢的派生物，
 * 用户清临时文件时一起清掉也没关系。
 */
function cacheDir(): string {
  return join(tmpdir(), 'moment-tui-images')
}

/** 用 URL 的哈希当文件名，避免长 URL 和不合法字符。 */
function cachePath(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16)
  return join(cacheDir(), `${hash}.img`)
}

/**
 * 下载图片到缓存，返回本地路径。
 *
 * 已缓存就直接复用 —— 终端里翻上翻下重看同一张图很常见，
 * 每次都重新下载会明显拖慢。
 */
export async function fetchImage(url: string): Promise<string> {
  const path = cachePath(url)
  if (existsSync(path)) return path

  await mkdir(cacheDir(), { recursive: true })
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载图片失败：HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(path, buffer)
  return path
}

export interface RenderedImage {
  /** 要写进终端的字节。 */
  data: string
  rows: number
  protocol: Capability['protocol']
}

/**
 * 把一张图渲染成终端能显示的形式。
 *
 * 解码仍然交给 node-av：它对 jpg/png/webp 都能吃，不用再引一个图片库。
 */
export async function renderImage(
  url: string,
  capability: Capability,
  width: number,
): Promise<RenderedImage> {
  const path = await fetchImage(url)

  // 无论哪档协议，都要先解出一帧 RGBA。
  const { Demuxer, Decoder, Scaler } = await import('node-av/api')
  await using input = await Demuxer.open(path)
  const video = input.video()
  if (!video) throw new Error('这个文件里没有图像')

  await using decoder = await Decoder.create(video)
  using scaler = new Scaler()

  // 高度按源图比例算，保证不变形。
  const sourceWidth = video.codecpar.width ?? width
  const sourceHeight = video.codecpar.height ?? width
  const height = Math.max(1, Math.round((width * sourceHeight) / sourceWidth))

  for await (const frame of decoder.frames(input.packets(video.index))) {
    if (!frame) continue
    const rgba = new Uint8Array(
      scaler.toBufferSync(frame, { resize: { width, height }, format: 'rgba' }),
    )

    if (capability.protocol === 'iterm') {
      const { prepareIterm } = await import('./capability.js')
      const png = scaler.toPngSync(frame, { resize: { width, height } })
      const image = prepareIterm(png, width, height)
      return { data: image.data, rows: image.rows, protocol: 'iterm' }
    }

    if (capability.protocol === 'sixel') {
      const { prepareSixel } = await import('./capability.js')
      const image = prepareSixel(rgba, width, height)
      return { data: image.data, rows: image.rows, protocol: 'sixel' }
    }

    // 色块兜底。
    const { encodeBlocks } = await import('./blocks.js')
    const columns = Math.min(width, ((process.stdout as unknown as { columns?: number }).columns ?? 80) - 4)
    const blocks = encodeBlocks(rgba, width, height, columns)
    return { data: blocks.lines.join('\n'), rows: blocks.rows, protocol: 'blocks' }
  }

  throw new Error('没能解出图像')
}

/** 清理缓存目录。`moment doctor --clean` 会调用。 */
export async function clearImageCache(): Promise<void> {
  await rm(cacheDir(), { recursive: true, force: true })
}
