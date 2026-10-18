/**
 * iTerm2 内联图片协议。
 *
 * iTerm2 支持的**不是** Sixel，而是它自家的 OSC 1337 序列：
 *
 *     ESC ] 1337 ; File = inline=1;size=<字节数>;width=<N>px : <base64> BEL
 *
 * 相比 Sixel 的好处是能直接塞 PNG，不用自己量化到 256 色，画质好得多。
 * 所以检测到 iTerm2 时优先走这条，而不是硬发 Sixel。
 *
 * 注意 `size` 必须是 base64 之前的**原始字节数**，写错 iTerm2 会直接丢掉整张图。
 */

import { encodeSixel, type SixelImage } from './sixel.js'

export interface InlineImage {
  data: string
  pixelWidth: number
  pixelHeight: number
  rows: number
}

/** 一个字符格子的像素高度，和 sixel.ts 保持一致，占位行数才对得上。 */
const PIXELS_PER_CELL_HEIGHT = 16

/**
 * 包装成 iTerm2 内联图片序列。
 *
 * @param png PNG 字节
 * @param width / height 显示尺寸（像素）
 * @param name 可选文件名，只影响 iTerm2 把它拖出来时的默认名
 */
export function encodeItermInline(
  png: Buffer | Uint8Array,
  width: number,
  height: number,
  name = 'moment.png',
): InlineImage {
  const base64 = Buffer.from(png).toString('base64')
  // width/height 用 px 单位（带 px 后缀），让 iTerm2 别按单元格拉伸。
  const args = [
    'inline=1',
    `size=${png.length}`,
    `name=${Buffer.from(name).toString('base64')}`,
    `width=${width}px`,
    `height=${height}px`,
    'preserveAspectRatio=0',
  ].join(';')

  return {
    data: `\x1b]1337;File=${args}:${base64}\x07`,
    pixelWidth: width,
    pixelHeight: height,
    rows: Math.ceil(height / PIXELS_PER_CELL_HEIGHT),
  }
}

/** 统一表示「一张已经编码好的终端图片」。 */
export type TerminalImage =
  | { kind: 'sixel'; image: SixelImage }
  | { kind: 'iterm'; image: InlineImage }

/** 供渲染层使用的公共形状。 */
export interface RenderableImage {
  data: string
  pixelWidth: number
  pixelHeight: number
  rows: number
}

export function asRenderable(encoded: TerminalImage): RenderableImage {
  return encoded.image
}

export { encodeSixel }
