/**
 * 账号与设置。
 *
 * 只做两件真事：核对当前连的是哪台服务器、以及把这台机器上的凭据清掉。
 * 不做「外观主题切换」之类的开关 —— 这个客户端只有一种样子。
 */

import { useState } from 'react'
import type { AccountStatus } from '@shared/types'
import { bridge, call, errorText } from '../api'
import Avatar from '../components/Avatar'
import { IconBack } from '../components/icons'
import './settings.css'

interface SettingsPageProps {
  account: AccountStatus
  onBack: () => void
  onSignedOut: () => void
  onStatusChange: (status: AccountStatus) => void
}

export default function SettingsPage({ account, onBack, onSignedOut, onStatusChange }: SettingsPageProps) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  async function signOut(wipe: boolean) {
    try {
      if (wipe) {
        const next = await call(bridge.logout())
        onStatusChange(next)
        onSignedOut()
        return
      }
      onSignedOut()
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  return (
    <div className="settings">
      <button type="button" className="detail__back" onClick={onBack}>
        <IconBack size={15} />
        <span>返回动态</span>
      </button>

      <h1 className="settings__title">账号与设置</h1>

      <section className="settings__block">
        <div className="settings__who">
          <Avatar src={account.avatar} name={account.displayName || account.watchId} size={48} />
          <div className="settings__who-text">
            <p className="settings__name">{account.displayName || '未命名账号'}</p>
            <p className="num settings__watchid" title={account.watchId}>
              {account.watchId}
            </p>
          </div>
        </div>
      </section>

      <section className="settings__block">
        <h2 className="settings__h2">连接</h2>
        <dl className="settings__dl">
          <dt>服务器</dt>
          <dd className="num">{account.baseUrl}</dd>
          <dt>登录方式</dt>
          <dd>{account.mode === 'password' ? '用户名密码' : '设备凭据（watchId + chipId）'}</dd>
          <dt>凭据存放</dt>
          <dd>{account.rememberable ? '系统密钥加密，保存在本机用户目录' : '仅内存，关闭窗口即失效'}</dd>
          {account.mode === 'password' && account.expiresAt > 0 ? (
            <>
              <dt>令牌到期</dt>
              <dd>{new Date(account.expiresAt).toLocaleString('zh-CN')}</dd>
            </>
          ) : null}
          <dt>协议</dt>
          <dd>身份放在请求头 Base-Request-Param 里（watchId + chipId）</dd>
        </dl>
        <p className="settings__note">
          chipId 只在本机主进程里参与请求，页面层拿不到它。换账号就是在这里退出后换一份凭据。
        </p>
      </section>

      {error ? <p className="settings__error">{error}</p> : null}

      <section className="settings__block">
        <h2 className="settings__h2">退出</h2>
        {confirming ? (
          <div className="settings__confirm">
            <p>退出后会删掉本机保存的这份凭据，下次要用需要重新填 watchId 和 chipId。</p>
            <div className="settings__confirm-row">
              <button type="button" className="textbtn" onClick={() => setConfirming(false)}>
                再想想
              </button>
              <button type="button" className="btn" data-variant="danger" onClick={() => void signOut(true)}>
                退出并清除本机凭据
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" data-variant="ghost" onClick={() => setConfirming(true)}>
            退出账号
          </button>
        )}
      </section>
    </div>
  )
}
