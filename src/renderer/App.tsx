/**
 * 应用外壳。
 *
 * 不引路由库：这个客户端只有「流 / 详情 / 设置」三种视图，一个状态就够了，
 * 引 react-router 反而要处理 hash 与刷新语义。
 *
 * 布局是刻意不对称的：左栏窄（导航），中栏定宽（阅读），右栏略宽（信息）。
 * 不是居中一张大卡片 —— 那种版式一眼就是模板。
 */

import { useCallback, useEffect, useState } from 'react'
import type { AccountStatus } from '@shared/types'
import { bridge, call } from './api'
import Avatar from './components/Avatar'
import Lightbox from './components/Lightbox'
import FeedPage from './pages/FeedPage'
import DetailPage from './pages/DetailPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import './app.css'

type View = { kind: 'feed' } | { kind: 'detail'; momentId: string } | { kind: 'settings' }

export default function App() {
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [view, setView] = useState<View>({ kind: 'feed' })
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)

  useEffect(() => {
    void call(bridge.accountStatus())
      .then(setStatus)
      .catch(() => {
        // 主进程没起来时也不该白屏，退回登录页让用户重试。
        setStatus({
          signedIn: false,
          baseUrl: '',
          displayName: '',
          avatar: '',
          watchId: '',
          rememberable: false,
          mode: 'password',
          expiresAt: 0,
        })
      })
  }, [])

  const openImage = useCallback((images: string[], index: number) => {
    setLightbox({ images, index })
  }, [])

  const signOut = useCallback(() => {
    void call(bridge.logout())
      .then(setStatus)
      .finally(() => setView({ kind: 'feed' }))
  }, [])

  /** 凭据失效：退回登录页，并保留上次的服务器地址。 */
  const authLost = useCallback(() => {
    setStatus((previous) =>
      previous
        ? { ...previous, signedIn: false, displayName: '', avatar: '', watchId: '' }
        : previous,
    )
    setView({ kind: 'feed' })
  }, [])

  // 首帧还不知道状态时给一块同色纸面，避免闪白。
  if (!status) {
    return <div className="boot" />
  }

  if (!status.signedIn) {
    return (
      <LoginPage
        onSignedIn={(next) => {
          setStatus(next)
          setView({ kind: 'feed' })
        }}
        defaultBaseUrl={status.baseUrl}
        rememberable={status.rememberable}
      />
    )
  }

  return (
    <div className="shell">
      <aside className="rail rail--left">
        <div className="rail__brand">
          <span className="rail__brand-name">好友圈</span>
          <span className="rail__brand-meta num">{shortHost(status.baseUrl)}</span>
        </div>

        <nav className="rail__nav">
          <button
            type="button"
            className="rail__link"
            data-on={view.kind === 'feed'}
            onClick={() => setView({ kind: 'feed' })}
          >
            动态
          </button>
          <button
            type="button"
            className="rail__link"
            data-on={view.kind === 'settings'}
            onClick={() => setView({ kind: 'settings' })}
          >
            账号与设置
          </button>
        </nav>

        <div className="rail__account">
          <Avatar src={status.avatar} name={status.displayName || status.watchId} size={28} />
          <div className="rail__account-text">
            <span className="rail__account-name">{status.displayName || status.watchId}</span>
            <button type="button" className="rail__signout" onClick={signOut}>
              退出
            </button>
          </div>
        </div>
      </aside>

      <main className="col">
        {view.kind === 'feed' ? (
          <FeedPage
            account={status}
            onOpenImage={openImage}
            onOpenDetail={(moment) => {
              setView({ kind: 'detail', momentId: moment.momentId })
            }}
            onAuthLost={authLost}
          />
        ) : null}

        {view.kind === 'detail' ? (
          <DetailPage
            key={view.momentId}
            momentId={view.momentId}
            onBack={() => setView({ kind: 'feed' })}
            onOpenImage={openImage}
            onAuthLost={authLost}
          />
        ) : null}

        {view.kind === 'settings' ? (
          <SettingsPage
            account={status}
            onSignedOut={authLost}
            onStatusChange={setStatus}
            onBack={() => setView({ kind: 'feed' })}
          />
        ) : null}
      </main>

      <aside className="rail rail--right">
        <RightRail account={status} />
      </aside>

      {lightbox ? (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ images: lightbox.images, index })}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}

/** 只显示 host:port，协议与路径在右栏看着碍眼。 */
function shortHost(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  } catch {
    return url
  }
}

/** 令牌到期只显示到日，精确到分钟没必要。 */
function shortDate(millis: number): string {
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 右栏：账号信息与服务状态。
 *
 * 不做「热门话题榜」这种要额外接口的东西 —— 服务端没这个数据，
 * 造一个假的榜单是最没意义的装饰。
 */
function RightRail({ account }: { account: AccountStatus }) {
  return (
    <div className="rr">
      <section className="rr__block">
        <h2 className="rr__title">当前账号</h2>
        <dl className="rr__dl">
          <dt>昵称</dt>
          <dd>{account.displayName || '—'}</dd>
          <dt>watchId</dt>
          <dd className="num rr__id" title={account.watchId}>
            {account.watchId}
          </dd>
          <dt>服务器</dt>
          <dd className="rr__host">{shortHost(account.baseUrl)}</dd>
          <dt>登录方式</dt>
          <dd>{account.mode === 'password' ? '用户名密码' : '设备凭据'}</dd>
          <dt>凭据</dt>
          <dd>{account.rememberable ? '已加密保存在本机' : '仅本次会话'}</dd>
          {account.mode === 'password' && account.expiresAt > 0 ? (
            <>
              <dt>令牌到期</dt>
              <dd className="num">{shortDate(account.expiresAt)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="rr__block">
        <h2 className="rr__title">关于</h2>
        <p className="rr__note">
          这个客户端直连你自己的好友圈服务端，用的是与手表端完全一致的数据。
          在这里发的动态，戴表的人会看到；手表上发的，这里也能刷到。
        </p>
      </section>

      <section className="rr__block">
        <h2 className="rr__title">键位</h2>
        <dl className="rr__keys">
          <dt>← →</dt>
          <dd>大图里翻页</dd>
          <dt>Esc</dt>
          <dd>关闭大图</dd>
        </dl>
      </section>
    </div>
  )
}
