/**
 * TUI 主题。
 *
 * 设计语言沿用 doge-code 那一套：
 *
 * - **语义化色键**，不在组件里写死颜色。组件只写 `color="accent"`，
 *   具体值由这里的表决定，换主题只改一处。
 * - **暗色为主、亮色可选**。终端背景多半是深的，默认按 dark 出。
 * - **RGB 直给**，不依赖用户终端里改过的 ANSI 16 色（那些值千奇百怪，
 *   同一份设计在别人机器上会花掉）。只有 `*-ansi` 主题才退回 16 色。
 * - **成对的 shimmer 色**：doge-code 每个主色都配一个更亮的版本做呼吸感。
 *   这里只保留真正会被动画用到的那几个，不为凑数而加。
 *
 * 和网页版的暖纸质风不一样 —— 那是给浅底纸面用的，终端里照搬会变成一片糊。
 * 这里保留的是一致的「克制」：不堆颜色，强调色只有砖红一支。
 */

export type Theme = {
  /** 主强调色。链接、选中项、竖线标记。 */
  accent: string
  /** accent 的高亮版，用于选中行/焦点态。 */
  accentBright: string

  /** 正文。 */
  text: string
  /** 次要正文：摘要、说明。 */
  textMuted: string
  /** 更弱：时间戳、计数、键位提示。 */
  textFaint: string

  /** 分隔线、边框。 */
  rule: string
  /** 更明显一点的分隔线，用于区块边界。 */
  ruleStrong: string

  /** 成功 / 错误 / 警告。 */
  success: string
  error: string
  warning: string

  /** 引用块（他人的评论、回复）底色区分的标题色。 */
  quote: string

  /** 输入框光标与占位符。 */
  cursor: string
  placeholder: string
}

export type ThemeName = 'dark' | 'light'

/**
 * 暗色主题。
 *
 * 取值参考了 doge-code 的 dark 主题取向：底子留给终端，前景用中性白，
 * 强调色压低饱和度（砖红 `#C4643C` 而不是纯红），避免在终端里刺眼。
 */
const dark: Theme = {
  accent: 'rgb(198,98,64)',
  accentBright: 'rgb(228,132,96)',

  text: 'rgb(230,228,224)',
  textMuted: 'rgb(150,147,142)',
  textFaint: 'rgb(104,101,97)',

  rule: 'rgb(64,62,59)',
  ruleStrong: 'rgb(92,89,85)',

  success: 'rgb(120,178,124)',
  error: 'rgb(226,110,110)',
  warning: 'rgb(214,170,84)',

  quote: 'rgb(126,158,196)',

  cursor: 'rgb(198,98,64)',
  placeholder: 'rgb(92,89,85)',
}

/**
 * 亮色主题。
 *
 * 文字压到近黑，分隔线用中灰，强调色比暗色版再深一档 ——
 * 同一个砖红放在白底上会显得发飘，得压住。
 */
const light: Theme = {
  accent: 'rgb(168,66,36)',
  accentBright: 'rgb(196,88,54)',

  text: 'rgb(28,27,25)',
  textMuted: 'rgb(92,89,85)',
  textFaint: 'rgb(138,134,128)',

  rule: 'rgb(206,202,196)',
  ruleStrong: 'rgb(168,164,158)',

  success: 'rgb(52,122,66)',
  error: 'rgb(171,43,63)',
  warning: 'rgb(150,108,30)',

  quote: 'rgb(52,96,148)',

  cursor: 'rgb(168,66,36)',
  placeholder: 'rgb(168,164,158)',
}

const THEMES: Record<ThemeName, Theme> = { dark, light }

export function getTheme(name: ThemeName): Theme {
  return THEMES[name] ?? dark
}

/**
 * 解析主题名。
 *
 * `auto` 时按 `COLORFGBG` 猜终端底色 —— 这不是标准变量，
 * 但 xterm 系和不少终端会写它，猜错了也只是配色不合口味，不影响可用性。
 */
export function resolveThemeName(setting: 'auto' | ThemeName): ThemeName {
  if (setting !== 'auto') return setting
  const fgbg = process.env.COLORFGBG
  if (fgbg) {
    const parts = fgbg.split(';')
    const bg = Number(parts[parts.length - 1])
    // 0-6、8 是深色，7、9-15 是浅色。
    if (Number.isFinite(bg)) return bg === 7 || bg >= 9 ? 'light' : 'dark'
  }
  return 'dark'
}
