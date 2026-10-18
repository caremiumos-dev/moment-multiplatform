/**
 * 在 ink 界面里内联显示图片。
 *
 * ## 最终方案：ink 只管上面，图片全写在下面
 *
 * 探针实测（关键证据）：
 *
 * ```
 * "行1 n=0\n行2\n行3\n"                                  ← ink 渲染 3 行
 * "\n\n[图片区]\n"                                        ← 图片写在 ink 区域之外
 * "\x1b[2K\x1b[1A...\x1b[G行1 n=1\n行2\n行3\n"           ← ink 重绘：只擦自己的 3 行
 * "\x1b[2K\x1b[1A...\x1b[G行1 n=2\n行2\n行3\n"
 * ```
 *
 * ink 用 `eraseLines(lastOutputHeight)` 清屏，**只清自己产出过的行数**。
 * 所以只要把图片写在 ink 主区**下方**（ink 不知道这些行的存在），
 * 图片就永远不会被后续重绘擦掉。
 *
 * ## 走过的弯路（别再重复）
 *
 * 1. 把图放进普通渲染树 —— 每帧被擦，图片闪一下就没。
 * 2. 算偏移 + `cursorUp` 回填 —— 偏移永远差几行，因为那块区域本身每帧要被清。
 * 3. `<Static>` 分区 —— Static 的语义是「只输出一次」，滚动时 items 变化会
 *    不断**追加**副本，屏幕上堆出一长串重复内容。
 *
 * 现在这条最简单：列表区固定高度，图片在它下面一屏里画。
 */

/** 每列大约 8 像素宽。 */
export const PIXELS_PER_COLUMN = 8

/** 像素高度 → 字符行数。 */
export function rowsFor(pixelHeight: number): number {
  return Math.max(1, Math.ceil(pixelHeight / 16))
}

/** 列表缩略图宽度（字符列）。 */
export const THUMB_COLUMNS = 24

/**
 * 在 ink 区域下方绘制图片。
 *
 * 前提：ink 已写完这一帧（调用方在 `setTimeout(0)` 里调），光标停在输出块末尾。
 *
 * `clearRows` 是上次画过的总行数（含标题行）。重画时先退回到那块区域的起点、
 * 从那里清到屏幕底（`\x1b[J`），再画新内容 —— 这样既不会残留旧图，
 * 也不会因为「多清了几行」而在下方留一坨空行。
 *
 * 注意顺序：必须先上移再清屏。反过来清的是光标下方，什么也清不到，
 * 旧图会留在上面（踩过）。
 */
export function paintBelow(data: string, clearRows = 0, label?: string): void {
  const stdout = process.stdout
  if (clearRows > 0) {
    stdout.write('\x1b[' + clearRows + 'A')
    stdout.write('\r')
    stdout.write('\x1b[J')
  }
  if (label) stdout.write(label + '\n')
  stdout.write(data)
  stdout.write('\x1b[0m')
  // 把光标移到图片下方的新行开头，让下一次 ink 重绘从干净的位置开始。
  stdout.write('\r\n')
}
