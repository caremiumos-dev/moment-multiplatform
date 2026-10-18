/**
 * 登录页。
 *
 * 两种方式，用顶部两个页签切换：
 *
 * - **用户名密码**（默认）：服务端的 `/moment/auth/login` 换令牌。chipId 可选 ——
 *   账号没绑设备时留空即可；绑了的话，管理员会自动从后台读出自己的 chipId，
 *   非管理员则会收到明确的提示要求手填。
 * - **设备凭据**：直接填 watchId + chipId，走 SDK 原生鉴权。
 *
 * chipId 等同密码这件事要在界面上说清楚，但不能吓人：写在下面那行小字里。
 */

import { useState } from 'react'
import type { AccountStatus, AuthMode, LoginInput } from '@shared/types'
import { bridge, call, errorText, MomentError } from '../api'
import './login.css'

interface LoginPageProps {
  onSignedIn: (status: AccountStatus) => void
  defaultBaseUrl: string
  rememberable: boolean
}

export default function LoginPage({ onSignedIn, defaultBaseUrl, rememberable }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>('password')
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl || 'http://127.0.0.1:8000')

  // 密码模式
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // 凭据模式
  const [watchId, setWatchId] = useState('')

  // chipId 两种模式都可能用到：密码模式下它是「可选，必要时自动填上」。
  const [chipId, setChipId] = useState('')
  /** 密码模式下被服务端要求补 chipId 时，把输入框亮出来并聚焦。 */
  const [chipRequired, setChipRequired] = useState(false)
  const [chipHint, setChipHint] = useState('')

  const [remember, setRemember] = useState(rememberable)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('')

  const ready =
    Boolean(baseUrl.trim()) &&
    (mode === 'password'
      ? Boolean(username.trim()) && Boolean(password)
      : Boolean(watchId.trim()) && Boolean(chipId.trim()))

  function switchMode(next: AuthMode) {
    if (next === mode) return
    setMode(next)
    setError('')
    setPhase('')
    setChipRequired(false)
    setChipHint('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return

    setBusy(true)
    setError('')
    setChipHint('')
    setPhase(mode === 'password' && !chipId ? '正在登录，必要时会读取设备信息…' : '')

    const input: LoginInput = {
      mode,
      baseUrl: baseUrl.trim(),
      username: username.trim(),
      password,
      watchId: watchId.trim(),
      chipId: chipId.trim(),
      remember: remember && rememberable,
    }

    try {
      const status = await call(bridge.login(input))
      onSignedIn(status)
    } catch (cause) {
      if (cause instanceof MomentError) {
        // 密码登录成功、但账号绑过设备且拿不到 chipId：展开输入框让用户补。
        if (cause.code === 'CHIP_REQUIRED') {
          setChipRequired(true)
          setError(cause.message)
          return
        }
        if (cause.code === '000016') {
          setError(
            mode === 'chip'
              ? 'chipId 和这个 watchId 对不上。账号若已在服务端绑定设备，只有那块手表的 chipId 能用。'
              : 'chipId 校验失败，确认一下填的是这台设备绑定的芯片号。',
          )
          setChipRequired(true)
          return
        }
      }
      setError(errorText(cause))
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  const showChipInput = mode === 'chip' || chipRequired || chipId.trim() !== ''

  return (
    <div className="login">
      <div className="login__panel">
        <header className="login__head">
          <h1 className="login__title">好友圈</h1>
          <p className="login__sub">登录到你的好友圈服务端</p>
        </header>

        <div className="login__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="login__tab"
            data-on={mode === 'password'}
            aria-selected={mode === 'password'}
            onClick={() => switchMode('password')}
          >
            用户名密码
          </button>
          <button
            type="button"
            role="tab"
            className="login__tab"
            data-on={mode === 'chip'}
            aria-selected={mode === 'chip'}
            onClick={() => switchMode('chip')}
          >
            设备凭据
          </button>
        </div>

        <form className="login__form" onSubmit={submit}>
          <label className="field">
            <span className="label">服务器地址</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://127.0.0.1:8000"
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          {mode === 'password' ? (
            <>
              <label className="field">
                <span className="label">用户名</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="服务端后台里创建的用户名"
                  spellCheck={false}
                  autoComplete="username"
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="label">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="账号密码"
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span className="label">watchId</span>
              <input
                value={watchId}
                onChange={(event) => setWatchId(event.target.value)}
                placeholder="账号的 watchId，32 位十六进制"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
            </label>
          )}

          {showChipInput ? (
            <label className="field" data-emphasis={chipRequired ? 'true' : undefined}>
              <span className="label">
                chipId
                {mode === 'password' ? <span className="field__optional">（可选）</span> : null}
              </span>
              <input
                value={chipId}
                onChange={(event) => setChipId(event.target.value)}
                placeholder={
                  chipRequired ? '这个账号绑过设备，请填 chipId' : '账号没绑设备可以留空'
                }
                spellCheck={false}
                autoComplete="off"
                autoFocus={chipRequired}
              />
            </label>
          ) : (
            /* 密码模式下默认收起 chipId：绝大多数账号根本用不到，摆出来只会让人犹豫。 */
            <button
              type="button"
              className="login__revealchip"
              onClick={() => setChipRequired(true)}
            >
              账号绑定过设备？填 chipId
            </button>
          )}

          <label className="login__remember" data-disabled={!rememberable}>
            <input
              type="checkbox"
              checked={remember && rememberable}
              disabled={!rememberable}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>
              {rememberable
                ? '记住这台设备（用系统密钥加密保存在本机）'
                : '系统不提供加密存储，本次凭据只保留到关闭窗口'}
            </span>
          </label>

          {error ? <p className="login__error">{error}</p> : null}
          {chipHint ? <p className="login__hint">{chipHint}</p> : null}

          <button type="submit" className="btn login__submit" disabled={!ready || busy}>
            {busy ? phase || '正在登录…' : '进入好友圈'}
          </button>
        </form>

        <footer className="login__foot">
          {mode === 'password' ? (
            <>
              <p>
                用户名密码走的是服务端的登录接口，换来一个 30 天有效的令牌；
                退出时会顺手把它撤销。
              </p>
              <p>账号绑定了设备时，需要 chipId 才能通过校验，管理员会自动帮你读取。</p>
            </>
          ) : (
            <>
              <p>
                watchId 与 chipId 都在服务端后台的账号详情里。chipId 是设备芯片号，
                等同于这个账号的密码。
              </p>
              <p>它只在本机主进程里使用，不会出现在网页层，也不会写进任何明文文件。</p>
            </>
          )}
        </footer>
      </div>

      <aside className="login__aside">
        <p className="login__quote">
          动态、图片、视频、点赞、评论都在这里，
          <br />
          和手腕上那块小屏幕看到的是同一份数据。
        </p>
        <ul className="login__list">
          <li>读：按时间倒序的完整动态流，可只看自己发的</li>
          <li>写：文字 / 最多九张图 / 视频，可挂话题与位置</li>
          <li>互动：点赞、评论、回复，作者可删动态与评论</li>
        </ul>
      </aside>
    </div>
  )
}
