/**
 * 设计系统小组件。
 *
 * 这几个是从 doge-code 的 `design-system/` 移植过来的同名组件，
 * 移植的是**语义**而不是代码：
 *
 * - `Divider`：一条横线，可带居中标题。doge-code 用它分隔 REPL 输出区块，
 *   我们用它分隔动态卡片与页脚。
 * - `Byline`：用中点 `·` 连接若干元信息。`观鲸 · 3 分钟前 · 5 赞`。
 * - `Pane`：顶部一根强调色横线 + 左侧缩进的内容块。所有全屏面板都用它。
 * - `KeyHint`：`enter 发布` 这样的键位提示，键名加粗、动作用弱色。
 *
 * 它们的共同点是**只用排版表达层级**：靠缩进、横线、明度差，
 * 不靠背景块和边框堆叠。终端里塞太多框线只会让人眼花。
 */

import React, { Children, Fragment, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme-context.js'
import type { Theme } from '../theme.js'

// ── 横线 ──────────────────────────────────────────────────────────────────

interface DividerProps {
  /** 线宽（字符数）。不传则占满。 */
  width?: number
  color?: keyof Theme
  /** 嵌在线中间的标题。 */
  title?: string
}

export function Divider({ width, color = 'rule', title }: DividerProps): React.ReactElement {
  const theme = useTheme()

  if (title) {
    // 标题两侧留一个空格，像铅字排版里的「章节横线」。
    const span = width ?? 48
    const titleWidth = displayWidth(title) + 2
    const side = Math.max(0, span - titleWidth)
    const left = Math.floor(side / 2)
    const right = side - left
    return (
      <Text color={theme[color]}>
        {'─'.repeat(left)}
        <Text color={theme.textMuted}> {title} </Text>
        {'─'.repeat(right)}
      </Text>
    )
  }

  return (
    <Text color={theme[color]}>{'─'.repeat(width ?? 48)}</Text>
  )
}

/** 自动铺满当前宽度的横线。 */
export function WideDivider({
  color = 'rule',
}: {
  color?: keyof Theme
}): React.ReactElement {
  const theme = useTheme()
  const width = useColumns()
  return <Text color={theme[color]}>{'─'.repeat(Math.max(0, width))}</Text>
}

// ── 中点连接 ──────────────────────────────────────────────────────────────

interface BylineProps {
  children: ReactNode
}

/**
 * 用 ` · ` 连接若干段元信息，自动跳过空值。
 *
 * 直接 `<Text>a · b</Text>` 也能写，但一旦有条件是空的就会留下孤零零的中点，
 * 这个组件负责收拾那种情况。
 */
export function Byline({ children }: BylineProps): React.ReactElement | null {
  const items = Children.toArray(children).filter((child) => Boolean(child))
  if (items.length === 0) return null
  return (
    <>
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? <Text color="gray"> · </Text> : null}
          {child}
        </Fragment>
      ))}
    </>
  )
}

export function bylineItems(children: Array<ReactNode>): Array<ReactNode> {
  return children.filter(Boolean)
}

// ── 面板 ──────────────────────────────────────────────────────────────────

interface PaneProps {
  children: ReactNode
  /** 顶部横线的颜色，默认强调色。 */
  color?: keyof Theme
  /** 顶部横线上方的留白行数。 */
  gap?: number
}

/**
 * 全屏面板：上方留白 → 一根横线 → 左缩进的内容。
 *
 * doge-code 里所有 slash 命令面板都是这个形状，终端里读起来有明确的
 * 「这里开始是新内容」感，比画方框轻。
 */
export function Pane({ children, color = 'accent', gap = 1 }: PaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingTop={gap}>
      <WideDivider color={color} />
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        {children}
      </Box>
    </Box>
  )
}

// ── 状态标记 ──────────────────────────────────────────────────────────────

export type StatusKind = 'success' | 'error' | 'warning' | 'info' | 'pending'

const STATUS: Record<StatusKind, { mark: string; color: keyof Theme }> = {
  success: { mark: '✓', color: 'success' },
  error: { mark: '✗', color: 'error' },
  warning: { mark: '!', color: 'warning' },
  info: { mark: '·', color: 'accent' },
  pending: { mark: '○', color: 'textFaint' },
}

/**
 * 状态前缀。
 *
 * 刻意不用 emoji：终端里 emoji 宽度不稳（有的算 1 列有的算 2 列），
 * 一行里混进一个就会把后面的对齐全带歪。这里全是单宽字符。
 */
export function StatusMark({ kind }: { kind: StatusKind }): React.ReactElement {
  const theme = useTheme()
  const { mark, color } = STATUS[kind]
  return <Text color={theme[color]}>{mark}</Text>
}

// ── 键位提示 ──────────────────────────────────────────────────────────────

export function KeyHint({
  shortcut,
  action,
}: {
  shortcut: string
  action: string
}): React.ReactElement {
  const theme = useTheme()
  return (
    <Text color={theme.textFaint}>
      <Text color={theme.textMuted} bold>
        {shortcut}
      </Text>{' '}
      {action}
    </Text>
  )
}

/** 一排键位提示，用 ` · ` 分隔。 */
export function KeyBar({ hints }: { hints: Array<{ key: string; action: string }> }): React.ReactElement {
  const theme = useTheme()
  return (
    <Text color={theme.textFaint}>
      {hints.map((hint, index) => (
        <Fragment key={hint.key}>
          {index > 0 ? '  ·  ' : ''}
          <Text color={theme.textMuted}>{hint.key}</Text> {hint.action}
        </Fragment>
      ))}
    </Text>
  )
}

// ── 工具 ──────────────────────────────────────────────────────────────────

/**
 * 估算显示宽度。
 *
 * 终端里中文占两列，`String.length` 会把中文当成 1，对齐全歪。
 * 这里用近似区间判断，不追求覆盖所有 Unicode 区块 ——
 * 真要精确就得引 `get-east-asian-width`，而它对我们的用途来说太重。
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += isWide(code) ? 2 : 1
  }
  return width
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // 谚文字母
    (code >= 0x2e80 && code <= 0x303e) || // 部首、标点
    (code >= 0x3041 && code <= 0x33ff) || // 假名、注音
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // 基本汉字
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || // 全角
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) // emoji
  )
}

/** 按显示宽度截断，超出补省略号。 */
export function truncate(text: string, max: number): string {
  if (displayWidth(text) <= max) return text
  let out = ''
  let width = 0
  for (const char of text) {
    const w = isWide(char.codePointAt(0) ?? 0) ? 2 : 1
    if (width + w > max - 1) break
    out += char
    width += w
  }
  return `${out}…`
}

/** 取终端列数，渲染时动态跟上窗口尺寸变化。 */
export function useColumns(): number {
  const [columns, setColumns] = React.useState(() => process.stdout.columns ?? 80)
  React.useEffect(() => {
    const onResize = (): void => setColumns(process.stdout.columns ?? 80)
    process.stdout.on('resize', onResize)
    return () => {
      process.stdout.off('resize', onResize)
    }
  }, [])
  return columns
}
