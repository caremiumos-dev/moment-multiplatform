/**
 * 终端图片能力总入口。
 *
 * 三种档位，按能力从高到低：
 *
 * 1. **iTerm2 内联图片**（OSC 1337）—— 直接塞 PNG，无量化损失，画质最好。
 *    只在 iTerm2 里可用。
 * 2. **Sixel** —— 量化到 256 色，实测 240×270 一帧约 4KB、编码 2-5ms。
 *    支持它的终端：Windows Terminal、WezTerm、mintty、mlterm、Konsole、foot、kitty。
 * 3. **色块**（▀ + 24 位色）—— 任何 UTF-8 终端都能用，但分辨率被字符网格
 *    锁死，只够看个构图。
 *
 * 三层都不行（比如 16 色老控制台）就返回 `none`，界面退回纯文字。
 *
 * 这里只做「选哪种」，不碰布局 —— 占位行数由各编码器自己算好。
 */

import { detectSixelSupport, encodeSixel, type SixelImage } from './sixel.js'
import { encodeItermInline, type InlineImage } from './iterm.js'
import { supportsTrueColor } from './blocks.js'

export type ImageProtocol = 'iterm' | 'sixel' | 'blocks' | 'none'

export interface Capability {
  protocol: ImageProtocol
  /** 为什么选这个，界面上会显示一行说明。 */
  reason: string
}

/**
 * 探测当前终端能画到哪一档。
 *
 * 顺序有意义：iTerm2 优先，因为它能保真；Sixel 次之；色块兜底。
 * `MOMENT_SIXEL` 环境变量只影响 Sixel 那一档，不会绕过 iTerm2 的选择。
 */
export function detectImageCapability(): Capability {
  const program = process.env.TERM_PROGRAM ?? ''
  const forced = process.env.MOMENT_IMAGES

  // 兜底开关：明确不要图。
  if (forced === 'none') return { protocol: 'none', reason: 'MOMENT_IMAGES=none' }

  if (program.startsWith('iTerm')) {
    return { protocol: 'iterm', reason: 'iTerm2 内联图片' }
  }

  const sixel = detectSixelSupport()
  if (sixel.supported) {
    return { protocol: 'sixel', reason: sixel.reason }
  }

  if (supportsTrueColor()) {
    return { protocol: 'blocks', reason: '降级为色块（终端不支持 Sixel）' }
  }

  return { protocol: 'none', reason: `终端画不出图：${sixel.reason}` }
}

/** 一张待显示的图。各协议共用这一个形状。 */
export interface PreparedImage {
  /** 要写进终端的数据（Sixel DCS / OSC 1337 / 色块 ANSI 多行）。 */
  data: string
  pixelWidth: number
  pixelHeight: number
  /** 占用的终端行数，用于留白。 */
  rows: number
  /** 实际采用的协议，界面据此决定是否走「原地重绘」而不是逐行打印。 */
  protocol: ImageProtocol
}

/** 编码成 Sixel。 */
export function prepareSixel(rgba: Uint8Array, width: number, height: number): PreparedImage {
  const image: SixelImage = encodeSixel(rgba, width, height)
  return { ...image, protocol: 'sixel' }
}

/** 编码成 iTerm2 内联图片。需要调用方先给 PNG。 */
export function prepareIterm(
  png: Buffer | Uint8Array,
  width: number,
  height: number,
): PreparedImage {
  const image: InlineImage = encodeItermInline(png, width, height)
  return { ...image, protocol: 'iterm' }
}
