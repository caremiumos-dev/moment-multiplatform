/**
 * TUI 主程序。
 *
 * ## 布局结构（改之前务必读完）
 *
 * 屏幕分成两块：
 *
 * ```
 * ┌──────────────────────────┐
 * │ <Static> 区              │  一次成型的动态/详情 + 图片
 * │   （只追加，不重绘）       │  图片就写在这里，所以不会被擦掉
 * ├──────────────────────────┤
 * │ 普通区                   │  光标位置、按键提示、输入行
 * │   （每帧重绘）            │  这里绝不放图片
 * └──────────────────────────┘
 * ```
 *
 * 图片必须走 Static（原因见 inline-image.tsx 的注释）。Static 区只追加不回滚，
 * 所以列表按**页**组织：换页时整页替换，而不是逐条滚动。
 *
 * ## 键位
 *
 * 列表：↑↓ 选条 · enter 详情 · l 点赞 · i 看图 · v 视频 · n/N 翻页 · r 刷新
 * 详情：o 看大图 · v 播视频 · c 评论 · tab 选评论 · x 删评论 · esc 返回
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import type { CommentView, MomentView } from '../src/shared/types.js'
import { getTheme, resolveThemeName, type ThemeName } from './theme.js'
import { ThemeProvider } from './theme-context.js'
import { Byline, KeyBar, Pane, StatusMark } from './ui/primitives.js'
import { MomentBlock, MomentDetail } from './ui/feed.js'
import { PIXELS_PER_COLUMN, THUMB_COLUMNS, paintBelow } from './ui/inline-image.js'
import { useImages } from './ui/use-images.js'
import type { Capability } from './media/capability.js'

export interface BootContext {
  capability: Capability
  /** 配色偏好；`auto` 时按终端底色猜。 */
  theme: 'auto' | ThemeName
  version: string
}

export async function startTui(context: BootContext): Promise<void> {
  const theme = getTheme(resolveThemeName(context.theme))
  const app = render(
    <ThemeProvider theme={theme}>
      <MomentApp {...context} />
    </ThemeProvider>,
    { exitOnCtrlC: false },
  )
  await app.waitUntilExit()
}

// ── 顶层：恢复会话 / 登录 / 主界面 ────────────────────────────────────────

function MomentApp(context: BootContext): React.ReactElement {
  const { exit } = useApp()
  const [signedIn, setSignedIn] = useState(false)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const data = await import('./data.js')
        const { loadCredential } = await import('./store.js')
        const credential = await loadCredential()
        if (!credential) return
        const session = await data.login({
          mode: credential.mode,
          baseUrl: credential.baseUrl,
          username: '',
          password: '',
          watchId: credential.watchId,
          chipId: credential.chipId,
        })
        data.setSession(session)
        setSignedIn(true)
      } catch {
        // 恢复失败就当没登录过。
      } finally {
        setRestoring(false)
      }
    })()
  }, [])

  if (restoring) {
    return (
      <Box paddingX={2} paddingTop={1}>
        <StatusMark kind="pending" />
        <Text color="gray"> 正在恢复会话…</Text>
      </Box>
    )
  }

  if (!signedIn) {
    return <LoginScreen onSignedIn={() => setSignedIn(true)} onQuit={exit} version={context.version} />
  }

  return <Shell {...context} onLogout={() => setSignedIn(false)} onQuit={exit} />
}

// ── 登录 ──────────────────────────────────────────────────────────────────

const LOGIN_FIELDS = {
  password: ['baseUrl', 'username', 'password', 'chipId'] as const,
  chip: ['baseUrl', 'watchId', 'chipId'] as const,
}

type LoginField = 'baseUrl' | 'username' | 'password' | 'watchId' | 'chipId'

function LoginScreen({
  onSignedIn,
  onQuit,
  version,
}: {
  onSignedIn: () => void
  onQuit: () => void
  version: string
}): React.ReactElement {
  const [mode, setMode] = useState<'password' | 'chip'>('password')
  const [values, setValues] = useState<Record<LoginField, string>>({
    baseUrl: 'http://127.0.0.1:8000',
    username: '',
    password: '',
    watchId: '',
    chipId: '',
  })
  const [field, setField] = useState<LoginField>('username')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fields = LOGIN_FIELDS[mode]
  const index = fields.indexOf(field as never)

  const labels: Record<LoginField, string> = {
    baseUrl: '服务器',
    username: '用户名',
    password: '密码',
    watchId: 'watchId',
    chipId: mode === 'password' ? 'chipId（可选）' : 'chipId',
  }

  const submit = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await import('./data.js')
      const store = await import('./store.js')
      const session = await data.login({
        mode,
        baseUrl: values.baseUrl,
        username: values.username,
        password: values.password,
        watchId: values.watchId,
        chipId: values.chipId,
      })
      data.setSession(session)
      await store.saveCredential(session.credential, true).catch(() => false)
      onSignedIn()
    } catch (cause) {
      const data = await import('./data.js')
      if (cause instanceof data.ChipRequiredError) {
        setError(cause.message)
        setNotice('这个账号绑定了 chipId，请填写后重试')
        setField('chipId')
      } else {
        setError(data.humanizeError(cause).message)
      }
    } finally {
      setBusy(false)
    }
  }, [mode, values, onSignedIn])

  useInput((input, key) => {
    if (busy) return
    if (key.ctrl && input === 'c') {
      onQuit()
      return
    }
    if (input === '/chip') {
      setMode('chip')
      setField('watchId')
      setError('')
      return
    }
    if (input === '/password') {
      setMode('password')
      setField('username')
      setError('')
      return
    }
    if (key.tab || key.downArrow) {
      setField(fields[(index + 1) % fields.length] as LoginField)
      return
    }
    if (key.upArrow) {
      setField(fields[(index - 1 + fields.length) % fields.length] as LoginField)
      return
    }
    if (key.backspace || key.delete) {
      setValues((v) => ({ ...v, [field]: v[field].slice(0, -1) }))
      return
    }
    if (key.return) {
      if (index < fields.length - 1) {
        setField(fields[index + 1] as LoginField)
        return
      }
      void submit()
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setValues((v) => ({ ...v, [field]: v[field] + input }))
    }
  })

  return (
    <Box flexDirection="column">
      <Box paddingX={2} paddingTop={1}>
        <Text bold color="white">
          好友圈
        </Text>
        <Text color="gray"> · 终端版 {version}</Text>
      </Box>

      <Pane>
        <Box marginBottom={1}>
          <Byline>
            <Text color={mode === 'password' ? 'cyan' : 'gray'} bold={mode === 'password'}>
              用户名密码
            </Text>
            <Text color={mode === 'chip' ? 'cyan' : 'gray'} bold={mode === 'chip'}>
              设备凭据
            </Text>
          </Byline>
        </Box>

        {fields.map((key) => {
          const focused = field === key
          const raw = values[key]
          const shown = key === 'password' ? '•'.repeat(raw.length) : raw
          return (
            <Box key={key}>
              <Box width={18}>
                <Text color={focused ? 'cyan' : 'gray'}>{focused ? '› ' : '  '}</Text>
                <Text color={focused ? 'white' : 'gray'}>{labels[key]}</Text>
              </Box>
              <Text color={focused ? 'white' : 'gray'}>{shown}</Text>
              {focused ? <Text color="cyan">▏</Text> : null}
            </Box>
          )
        })}

        {busy ? (
          <Box marginTop={1}>
            <StatusMark kind="pending" />
            <Text color="gray"> 正在登录…</Text>
          </Box>
        ) : null}
        {notice ? (
          <Box marginTop={1}>
            <Text color="yellow">{notice}</Text>
          </Box>
        ) : null}
        {error ? (
          <Box marginTop={1}>
            <StatusMark kind="error" />
            <Text color="red"> {error}</Text>
          </Box>
        ) : null}
      </Pane>

      <Box paddingX={2} marginTop={1}>
        <KeyBar
          hints={[
            { key: 'tab', action: '切换字段' },
            { key: 'enter', action: '登录' },
            { key: '/chip', action: '设备凭据' },
            { key: '/password', action: '用户名密码' },
            { key: 'ctrl+c', action: '退出' },
          ]}
        />
      </Box>
    </Box>
  )
}

// ── 主界面 ────────────────────────────────────────────────────────────────

type Mode = 'browse' | 'detail' | 'comment' | 'command'


function Shell({
  capability,
  onLogout,
  onQuit,
}: BootContext & { onLogout: () => void; onQuit: () => void }): React.ReactElement {
  const [feed, setFeed] = useState<MomentView[]>([])
  const [cursor, setCursor] = useState(0)
  const [mode, setMode] = useState<Mode>('browse')
  const [detailMoment, setDetailMoment] = useState<MomentView | null>(null)
  const [comments, setComments] = useState<CommentView[]>([])
  const [commentCursor, setCommentCursor] = useState(-1)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [input, setInput] = useState('')

  const imagesEnabled = capability.protocol !== 'none'


  const selected = feed[cursor]

  /**
   * 视口：一次渲染多少条动态。
   *
   * ink 每帧整屏重绘，内容一旦超过终端高度就会触发全屏 clear 模式，
   * 光标位置也跟着乱。所以按可用行数裁剪，只渲染窗口内的条目。
   * 每条动态固定占 4 行（作者 / 正文 / 元信息 / 间距）。
   */
  const ROWS_PER_MOMENT = 4
    const terminalRows = (process.stdout as unknown as { rows?: number }).rows ?? 24
  // 标题 2 + 分隔线 1 + 页码 1 + 状态 1 + 键提示 1 + 余量 3。
  const reservedRows = 9
  const listHeight = Math.max(4, terminalRows - reservedRows)

  /**
   * 一条动态占多少行。
   *
   * 缩略图**不算在内** —— 它画在 ink 管理范围之外，不占 ink 的行。
   * 之前把 THUMB_ROWS 加进来，导致列表预算被压掉十几行、
   * 图片下方留出一大片空白（用户反馈过）。
   */
  const heightOf = (moment: MomentView | undefined): number => {
    if (!moment) return ROWS_PER_MOMENT
    return ROWS_PER_MOMENT
  }

  // 从光标往上找起点，再往下填到塞满为止 —— 保证光标永远在窗口内。
  let windowStart = 0
  if (feed.length > 0) {
    let used = 0
    for (let i = Math.min(cursor, feed.length - 1); i >= 0; i--) {
      const h = heightOf(feed[i])
      if (used + h > listHeight) {
        windowStart = i + 1
        break
      }
      used += h
      windowStart = i
    }
  }
  let usedHeight = 0
  const windowEnd = (() => {
    for (let i = windowStart; i < feed.length; i++) {
      const h = heightOf(feed[i])
      if (usedHeight + h > listHeight) return i
      usedHeight += h
    }
    return feed.length
  })()

  // 窗口跟着光标走：光标永远留在可视区内。
  const visibleMoments = feed.slice(windowStart, windowEnd)



  /** 详情页的所有图片。 */
  const detailUrls =
    mode === 'detail' && detailMoment
      ? detailMoment.videos.length > 0
        ? [detailMoment.cover].filter(Boolean)
        : detailMoment.images
      : []
  const detailImages = useImages(
    detailUrls,
    capability,
    Math.min(1600, ((process.stdout as unknown as { columns?: number }).columns ?? 80) - 6) *
      PIXELS_PER_COLUMN,
  )

  /** 选中项缩略图（列表只给选中的那条显示图，保住列表密度）。 */
  const selectedThumbUrl = selected
    ? selected.videos.length > 0
      ? selected.cover || null
      : (selected.images[0] ?? null)
    : null
  const selectedThumbs = useImages([selectedThumbUrl], capability, THUMB_COLUMNS * PIXELS_PER_COLUMN)
  const selectedThumb = selectedThumbUrl ? (selectedThumbs.get(selectedThumbUrl) ?? null) : null

  /** 上一次在下方画了多少行，用于重画前清理。 */
  const paintedRows = useRef(0)

  /**
   * 在 ink 区域下方绘制选中项的缩略图。
   *
   * 关键：用 setTimeout(0) 等 ink 把这一帧写完，此时光标停在输出块末尾，
   * 直接往后写就是「ink 管不到的地方」，后续重绘 eraseLines 擦不到它。
   */
  useEffect(() => {
    if (!imagesEnabled || mode === 'detail') return
    const timer = setTimeout(() => {
      paintBelow(selectedThumb ? selectedThumb.data : '', paintedRows.current, selectedThumb ? '  ── 预览 ──' : undefined)
      paintedRows.current = selectedThumb ? selectedThumb.rows + 1 : 0
    }, 0)
    return () => clearTimeout(timer)
  }, [imagesEnabled, selectedThumb?.key, mode])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await import('./data.js')
      const page = await data.listFeed()
      setFeed(page.moments)
      setCursor((c) => Math.min(c, Math.max(0, page.moments.length - 1)))
    } catch (cause) {
      const data = await import('./data.js')
      setError(data.humanizeError(cause).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openDetail = useCallback(async (moment: MomentView) => {
    setMode('detail')
    setDetailMoment(moment)
    setComments([])
    setCommentCursor(-1)
    try {
      const data = await import('./data.js')
      setComments(await data.listComments(moment.momentId, moment.authorWatchId))
    } catch {
      setComments([])
    }
  }, [])


  /** 在终端里独占显示一张大图，按任意键返回。 */
  const showBigImage = useCallback(
    async (url: string | undefined) => {
      if (!url) {
        setError('这条动态没有图片')
        return
      }
      try {
        const { renderImage } = await import('./media/images.js')
        const width = Math.min(
          1600,
          ((process.stdout as unknown as { columns?: number }).columns ?? 80) * 8,
        )
        const image = await renderImage(url, capability, width)
        process.stdout.write('\x1b[2J\x1b[H')
        process.stdout.write(image.data)
        process.stdout.write('\x1b[0m\n\n按任意键返回')
        await new Promise<void>((resolve) => {
          process.stdin.once('data', () => resolve())
        })
        process.stdout.write('\x1b[2J\x1b[H')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [capability],
  )

  /**
   * 播放选中动态里的视频。
   *
   * 播放期间完全绕开 ink：清屏 → 自己画帧和进度条 → 播完恢复。
   * 这样帧率不会被 ink 的整树 diff 拖慢（一帧 40KB，交出去就是灾难）。
   */
  const playSelectedVideo = useCallback(async () => {
    const target = mode === 'detail' && detailMoment ? detailMoment : selected
    const url = target?.videos[0]
    if (!url) {
      setError('这条动态没有视频')
      return
    }
    if (!imagesEnabled) {
      setError(`当前终端画不出视频画面（${capability.reason}）`)
      return
    }
    try {
      const { fetchImage } = await import('./media/images.js')
      const file = await fetchImage(url)
      const { playInTerminal, formatTime, progressBar } = await import('./media/player.js')
      process.stdout.write('\x1b[2J\x1b[H')
      const stdout = process.stdout
      const player = await playInTerminal({
        path: file,
        width: Math.min(1280, ((process.stdout as unknown as { columns?: number }).columns ?? 80) * 8),
        fps: 15,
        audio: true,
        onStatus: (status) => {
          stdout.write(
            '\r' + formatTime(status.timeMs) + ' / ' + formatTime(status.durationMs) +
              '  ' + progressBar(status.timeMs, status.durationMs) + '  （空格暂停 / q 退出）',
          )
        },
      })
      // 播完或者用户按键提前结束。
      await new Promise<void>((resolve) => {
        const done = (): void => resolve()
        process.stdin.once('data', done)
        setTimeout(() => {
          process.stdin.off('data', done)
          resolve()
        }, 600_000)
      })
      await player.stop()
      process.stdout.write('\x1b[2J\x1b[H')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [capability, detailMoment, imagesEnabled, mode, selected])

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') {
      onQuit()
      return
    }

    // ── 输入态 ──
    if (mode === 'comment' || mode === 'command') {
      if (key.escape) {
        setMode('browse')
        setInput('')
        return
      }
      if (key.backspace || key.delete) {
        setInput((t) => t.slice(0, -1))
        return
      }
      if (key.return) {
        const text = input.trim()
        const target = mode
        setInput('')
        setMode(target === 'comment' ? 'detail' : 'browse')
        if (!text || !detailMoment) return
        void (async () => {
          const data = await import('./data.js')
          try {
            if (target === 'comment') {
              await data.postComment(detailMoment, text)
              setStatus('评论已发布')
              setComments(await data.listComments(detailMoment.momentId, detailMoment.authorWatchId))
              await refresh()
            }
          } catch (cause) {
            setError(data.humanizeError(cause).message)
          }
        })()
        return
      }
      if (ch && !key.ctrl && !key.meta) setInput((t) => t + ch)
      return
    }

    // ── 详情页 ──
    if (mode === 'detail' && detailMoment) {
      if (key.escape || ch === 'q') {
        setMode('browse')
        setDetailMoment(null)
        setCommentCursor(-1)
        return
      }
      if (key.tab) {
        setCommentCursor((c) => (c >= 0 ? -1 : comments.length > 0 ? 0 : -1))
        return
      }
      if (key.upArrow && commentCursor >= 0) {
        setCommentCursor((c) => Math.max(0, c - 1))
        return
      }
      if (key.downArrow && commentCursor >= 0) {
        setCommentCursor((c) => Math.min(comments.length - 1, c + 1))
        return
      }
      if (ch === 'c') {
        setMode('comment')
        setInput('')
        return
      }
      if (ch === 'v') {
        void playSelectedVideo()
        return
      }
      if (ch === 'i' || ch === 'o') {
        const url =
          detailMoment.videos.length > 0 ? detailMoment.cover : detailMoment.images[0]
        void showBigImage(url)
        return
      }
      if (ch === 'l') {
        void (async () => {
          const data = await import('./data.js')
          try {
            const liked = await data.toggleLike(detailMoment)
            setStatus(liked ? '已点赞' : '已取消点赞')
            await refresh()
          } catch (cause) {
            setError(data.humanizeError(cause).message)
          }
        })()
        return
      }
      if (ch === 'x' && commentCursor >= 0) {
        const target = comments[commentCursor]
        if (!target) return
        if (!target.canDelete) {
          setError('只能删自己的评论，或自己动态下的评论')
          return
        }
        void (async () => {
          const data = await import('./data.js')
          try {
            await data.removeComment(target.commentId)
            setStatus('评论已删除')
            setCommentCursor((c) => Math.max(-1, c - 1))
            setComments(
              await data.listComments(detailMoment.momentId, detailMoment.authorWatchId),
            )
            await refresh()
          } catch (cause) {
            setError(data.humanizeError(cause).message)
          }
        })()
        return
      }
      return
    }

    // ── 列表页 ──
    if (ch === 'q') {
      onQuit()
      return
    }
    if (ch === 'Q') {
      void (async () => {
        const { clearCredential } = await import('./store.js')
        const data = await import('./data.js')
        await clearCredential()
        data.setSession(null)
        onLogout()
      })()
      return
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(Math.max(0, feed.length - 1), c + 1))
      return
    }
    // n / p 一次跳一屏，方便快速浏览；Shift+N 往回跳。
    if (ch === 'n' || ch === 'p') {
      setCursor((c) => Math.min(Math.max(0, feed.length - 1), c + Math.max(1, visibleMoments.length)))
      return
    }
    if (ch === 'N') {
      setCursor((c) => Math.max(0, c - Math.max(1, visibleMoments.length)))
      return
    }
    if (key.return && selected) {
      void openDetail(selected)
      return
    }
    if (ch === 'r') {
      setStatus('')
      void refresh()
      return
    }
    if (ch === 'l' && selected) {
      void (async () => {
        const data = await import('./data.js')
        try {
          const liked = await data.toggleLike(selected)
          setStatus(liked ? '已点赞' : '已取消点赞')
          await refresh()
        } catch (cause) {
          setError(data.humanizeError(cause).message)
        }
      })()
      return
    }
    if (ch === 'v') {
      void playSelectedVideo()
      return
    }
    if (ch === 'i' && selected) {
      void showBigImage(selected.videos.length > 0 ? selected.cover : selected.images[0])
      return
    }
    if (ch === '/') {
      setMode('command')
      setStatus('')
      return
    }
    if (ch === 'd' && selected) {
      void (async () => {
        const data = await import('./data.js')
        try {
          await data.removeMoment(selected.momentId)
          setStatus('已删除')
          await refresh()
        } catch (cause) {
          setError(data.humanizeError(cause).message)
        }
      })()
      return
    }
  })

  // ── 渲染 ──

  const header = (
    <Box paddingX={2} paddingTop={1} justifyContent="space-between">
      <Box>
        <Text bold color="white">
          好友圈
        </Text>
        <Text color="gray"> · 终端版</Text>
      </Box>
      <Byline>
        <Text color="gray">{feed.length} 条</Text>
        <Text color={capability.protocol === 'none' ? 'yellow' : 'gray'}>
          {capability.protocol === 'sixel'
            ? 'Sixel'
            : capability.protocol === 'iterm'
              ? 'iTerm2'
              : capability.protocol === 'blocks'
                ? '色块'
                : '无图'}
        </Text>
      </Byline>
    </Box>
  )

  const footer = (
    <>
      {mode === 'comment' || mode === 'command' ? (
        <Box paddingX={2}>
          <Text color="cyan">{mode === 'comment' ? '评论 › ' : '/ '}</Text>
          <Text color="white">{input}</Text>
          <Text color="cyan">▏</Text>
          <Text color="gray">  enter 提交 · esc 取消</Text>
        </Box>
      ) : null}
      {error ? (
        <Box paddingX={2}>
          <StatusMark kind="error" />
          <Text color="red"> {error}</Text>
        </Box>
      ) : null}
      {status ? (
        <Box paddingX={2}>
          <StatusMark kind="success" />
          <Text color="gray"> {status}</Text>
        </Box>
      ) : null}
      <Box paddingX={2} marginBottom={1}>
        <KeyBar
          hints={
            mode === 'detail'
              ? [
                  { key: 'esc', action: '返回' },
                  { key: 'i', action: '看大图' },
                  { key: 'v', action: '播视频' },
                  { key: 'c', action: '评论' },
                  { key: 'tab', action: '选评论' },
                  { key: 'x', action: '删评论' },
                  { key: 'l', action: '点赞' },
                ]
              : [
                  { key: '↑↓', action: '选择' },
                  { key: 'enter', action: '详情' },
                  { key: 'l', action: '点赞' },
                  { key: 'i', action: '看图' },
                  { key: 'v', action: '视频' },
                  { key: 'n/N', action: '翻页' },
                  { key: 'r', action: '刷新' },
                  { key: 'q', action: '退出' },
                ]
          }
        />
      </Box>
    </>
  )

  return (
    <Box flexDirection="column">
      {header}

      {loading ? (
        <Box paddingX={2}>
          <StatusMark kind="pending" />
          <Text color="gray"> 正在读取动态…</Text>
        </Box>
      ) : null}

      {/* 内容区：普通渲染树。图片不放在这里（会被 ink 重绘擦掉），
          它画在 ink 区域下方，见 previewPanel。 */}
      <Box flexDirection="column" paddingX={2}>
        {mode === 'detail' && detailMoment ? (
          <MomentDetail
            moment={detailMoment}
            comments={comments}
            images={detailImages}
            imagesEnabled={imagesEnabled}
          />
        ) : (
          visibleMoments.map((moment, offset) => (
            <MomentBlock
              key={moment.momentId}
              moment={moment}
              index={windowStart + offset + 1}
              selected={windowStart + offset === cursor}
            />
          ))
        )}
      </Box>

      {/* 普通区：光标和提示，每帧重绘，这里不放图片。 */}
      {mode !== 'detail' ? (
        <Box paddingX={2} flexDirection="column">
          <Text color="gray">
            {visibleMoments.length > 0 ? windowStart + 1 + '–' + (windowStart + visibleMoments.length) : '0'} / {feed.length}
            {selected ? `　▎ ${cursor + 1}. ${selected.authorName}` : ''}
          </Text>
        </Box>
      ) : null}

      {footer}


    </Box>
  )
}

