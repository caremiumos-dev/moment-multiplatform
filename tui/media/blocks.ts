/**
 * 色块降级渲染。
 *
 * 终端连 Sixel 都没有时的最后一档：用「上下半块」字符 `▀`（U+2580）拼像素。
 * 一个字符格能同时表达两个颜色 —— 上半块用前景色、下半块用背景色，
 * 等于把纵向分辨率翻倍。这是 ffmpeg 向终端出预览图那类工具的老办法，
 * 也是 `chafa` / `catimg` 的默认模式。
 *
 * 优点：任何 UTF-8 终端都能显示，包括 Windows 老控制台。
 * 缺点：横向分辨率被字符宽度锁死（中文终端里一个格子通常只有 8-10 像素宽），
 * 所以能得到的最好效果也就相当于几十×几十的像素图 —— 认得出构图，认不出脸。
 *
 * 因此这里的定位是「有总比没有强」，不是主方案。
 */

/** 每格用两个半块字符表示的像素对。 */
const UPPER_HALF = '\u2580' // ▀

export interface BlockImage {
  /** 多行字符串，每行就是一个终端行，含 ANSI 真彩色转义。 */
  lines: string[]
  /** 占用的字符列数。 */
  columns: number
  /** 占用的终端行数。 */
  rows: number
}

/**
 * 把 RGBA 转成色块字符。
 *
 * @param rgba 紧密排列的 RGBA 像素
 * @param pixelWidth / pixelHeight 源图尺寸
 * @param maxColumns 终端可用列数，超了会按比例缩小
 */
export function encodeBlocks(
  rgba: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  maxColumns: number,
): BlockImage {
  if (rgba.length !== pixelWidth * pixelHeight * 4) {
    throw new Error(
      `色块输入尺寸不符：${pixelWidth}x${pixelHeight} 需要 ${pixelWidth * pixelHeight * 4} 字节，实际 ${rgba.length}`,
    )
  }

  // 每个字符格消耗 1 像素宽、2 像素高，所以列数 = 宽，行数 = 高/2。
  // 同时要守住列数上限，等比缩小。
  const targetColumns = Math.max(1, Math.min(pixelWidth, maxColumns))
  const scaleX = pixelWidth / targetColumns
  // 纵向按 2 倍算，保证缩小后仍能整除成整数对。
  const targetRows = Math.max(1, Math.round(pixelHeight / 2 / scaleX))
  const pixelRows = targetRows * 2

  const lines: string[] = []
  for (let row = 0; row < pixelRows; row += 2) {
    let line = ''
    for (let column = 0; column < targetColumns; column++) {
      const x = Math.min(pixelWidth - 1, Math.floor(column * scaleX))
      const topY = Math.min(pixelHeight - 1, Math.floor((row * pixelHeight) / pixelRows))
      const bottomY = Math.min(pixelHeight - 1, Math.floor(((row + 1) * pixelHeight) / pixelRows))

      const top = sample(rgba, pixelWidth, x, topY)
      const bottom = sample(rgba, pixelWidth, x, bottomY)

      // 前景 = 上半个像素，背景 = 下半个像素。
      line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bottom[0]};${bottom[1]};${bottom[2]}m${UPPER_HALF}`
    }
    // 行末重置，避免颜色渗到后面的 UI 元素上。
    lines.push(`${line}\x1b[0m`)
  }

  return { lines, columns: targetColumns, rows: targetRows }
}

function sample(rgba: Uint8Array, width: number, x: number, y: number): [number, number, number] {
  const index = (y * width + x) * 4
  return [rgba[index] ?? 0, rgba[index + 1] ?? 0, rgba[index + 2] ?? 0]
}

/**
 * 判断终端是否能至少显示真彩色。
 *
 * 色块模式全靠 ANSI 24 位色撑着，如果终端只支持 16 色，输出会变成一团
 * 无法分辨的近似色 —— 还不如直接不显示。`COLORTERM` 是真彩色的事实标准。
 */
export function supportsTrueColor(): boolean {
  const colorTerm = process.env.COLORTERM ?? ''
  if (/truecolor|24bit/i.test(colorTerm)) return true
  // Windows Terminal / mintty / Konsole 都会设 COLORTERM，缺少时保守认为不是。
  return false
}
