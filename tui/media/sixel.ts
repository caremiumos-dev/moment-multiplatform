/**
 * Sixel 图片渲染。
 *
 * 终端里没有「像素」这个概念，Sixel 是把位图硬塞进字符网格的老办法：
 * 每个格子里画 6×1 像素的小块，靠 `\x1bP0;0;q ... \x1b\\` 这层 DCS 序列下发。
 *
 * 几个实测结论（都影响这里的实现，改之前先看）：
 *
 * - **必须用 `image2sixel`，不是 `sixelEncode`**。后者收的是「已经量化成索引色」的
 *   数据，直接把 RGBA 喂进去不会报错，但画出来是一片白 —— 因为像素值被当成了
 *   调色板下标。`image2sixel` 内部会先做 `reduce` 量化再编码，并且自带完整的
 *   `introducer` + `FINALIZER` 包裹，不需要外面再补。
 * - 一张 240×270 的帧量化后约 4KB，编码 2-5ms，够做 15fps 的视频。
 * - **必须给占位行**。Sixel 是「画在光标处」，如果渲染器不知道这片区域被占了，
 *   重绘时会把图片盖掉。`rows` 就是换算出来的字符行数，调用方据此留空。
 * - 不支持 Sixel 的终端会把这些字节当乱码打出来，所以必须先探测能力。
 */

import { image2sixel } from 'sixel'

/**
 * 一个字符格子对应多少像素。
 *
 * 这个值终端不会告诉我们（没有标准查询方式），只能按经验取。
 * 取 16 的依据：主流终端字号下单元格约 8×16 像素，而图片按 2 倍密度画
 * 看起来最清楚。算偏了的表现是图片压住下面的文字，或者底下空一大块。
 */
const PIXELS_PER_CELL_HEIGHT = 16

export interface SixelImage {
  /** 完整 DCS 序列，直接写 stdout。 */
  data: string
  pixelWidth: number
  pixelHeight: number
  /** 换算成字符行数，用于给它占位。 */
  rows: number
}

/**
 * 把 RGBA 缓冲区编码成 Sixel。
 *
 * `width * height * 4` 必须严格等于 `rgba.length`，否则上游缩放一定出了问题
 * （注意 `Scaler.toBuffer` 的参数形状是 `{ resize: { width, height } }`，
 * 写成扁平的 `{ width, height }` 不会报错，但会按原尺寸出图）。
 */
export function encodeSixel(rgba: Uint8Array, width: number, height: number): SixelImage {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `Sixel 输入尺寸不符：${width}x${height} 需要 ${width * height * 4} 字节，实际 ${rgba.length}`,
    )
  }

  const data = image2sixel(rgba, width, height, 256, 1)

  return {
    data,
    pixelWidth: width,
    pixelHeight: height,
    rows: Math.ceil(height / PIXELS_PER_CELL_HEIGHT),
  }
}

/**
 * 探测终端是否支持 Sixel。
 *
 * 标准做法是发 DA1 查询（`\x1b[c`）读回复里的 `;4;` 能力位，但那要求终端是
 * 交互式的、且要等回包，稍有不慎就把启动卡住。这里改用环境变量判断。
 *
 * 判错的代价不对称：认成支持 → 满屏乱码；认成不支持 → 只是退回文字。
 * 所以对「不确定」的终端一律说不支持，并留 `MOMENT_SIXEL=1` 给高级用户强行打开。
 *
 * 注意：Windows Terminal **已经支持 Sixel**（实测 1.x 起可用，在本机验证通过），
 * 不要再按旧资料把它排掉。
 */
export function detectSixelSupport(): { supported: boolean; reason: string } {
  const forced = process.env.MOMENT_SIXEL
  if (forced === '1') return { supported: true, reason: 'MOMENT_SIXEL=1 强制开启' }
  if (forced === '0') return { supported: false, reason: 'MOMENT_SIXEL=0 强制关闭' }

  const program = process.env.TERM_PROGRAM ?? ''
  const term = process.env.TERM ?? ''

  // 这些终端**确定不支持**。
  if (program === 'vscode') {
    return { supported: false, reason: 'VS Code 内置终端不支持 Sixel' }
  }
  if (program === 'Apple_Terminal') {
    return { supported: false, reason: 'macOS 终端不支持 Sixel' }
  }
  if (program.startsWith('iTerm')) {
    return { supported: false, reason: 'iTerm2 用自家内联图片协议' }
  }

  // 这些终端确定支持。
  if (process.env.WT_SESSION) {
    return { supported: true, reason: 'Windows Terminal 支持 Sixel' }
  }
  if (program === 'WezTerm') return { supported: true, reason: 'WezTerm 支持 Sixel' }
  if (program === 'mintty') return { supported: true, reason: 'mintty 支持 Sixel' }
  if (process.env.MLTERM_VERSION) return { supported: true, reason: 'mlterm 支持 Sixel' }
  if (process.env.KONSOLE_VERSION) return { supported: true, reason: 'Konsole 支持 Sixel' }
  if (term === 'xterm-kitty') return { supported: true, reason: 'kitty 支持 Sixel' }
  if (/sixel/i.test(term)) return { supported: true, reason: `TERM=${term} 声明支持` }
  if (/^foot/.test(term)) return { supported: true, reason: `TERM=${term} 支持 Sixel` }

  return { supported: false, reason: `无法确认 ${term || '当前终端'} 支持 Sixel` }
}
