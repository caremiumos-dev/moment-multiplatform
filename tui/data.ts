/**
 * TUI 的数据层。
 *
 * 不直接散着碰 SDK，而是把 `core/` 里已经封装好的东西聚成一个用起来顺手的外观。
 * TUI 和 Electron 共用同一套业务语义，不会出现「桌面端能删、终端里报错」的漂移。
 *
 * TUI 没有 IPC，所以这里直接持有凭据对象 —— 进程内和桌面端主进程一样，
 * 凭据只活在内存里；落盘加密由 `store.ts` 负责。
 */

import { MomentApiError } from '@caremiumos-dev/node-moment-sdk'
import type { AccountStatus, CommentView, FeedPage, MomentView, TopicView } from '../src/shared/types.js'
import type { Credential } from '../core/credential.js'
import { daysUntilExpiry } from '../core/credential.js'
import {
  FEED_PAGE_SIZE,
  createClient,
  fetchProfile,
  humanizeError,
  toCommentView,
  toMomentView,
} from '../core/moment.js'
import { loginWithPassword, probeBinding } from '../core/auth.js'
import { lookupOwnChipId } from '../core/admin-chip.js'

export interface Session {
  credential: Credential
  profile: { displayName: string; avatar: string }
}

let session: Session | null = null

export function currentSession(): Session | null {
  return session
}

export function setSession(next: Session | null): void {
  session = next
}

export function requireSession(): Session {
  if (!session) throw new MomentApiError('000003', 'not signed in')
  return session
}

/** 转成界面统一的账号状态，字段和桌面端一致。 */
export function statusOf(rememberable: boolean): AccountStatus {
  const s = session
  return {
    signedIn: s !== null,
    baseUrl: s?.credential.baseUrl ?? '',
    displayName: s?.profile.displayName ?? '',
    avatar: s?.profile.avatar ?? '',
    watchId: s?.credential.watchId ?? '',
    rememberable,
    mode: s?.credential.mode ?? 'password',
    expiresAt: s?.credential.mode === 'password' ? s.credential.expiresAt : 0,
  }
}

export function tokenDaysLeft(): number | null {
  return session ? daysUntilExpiry(session.credential) : null
}

// ── 登录 ──────────────────────────────────────────────────────────────────

export interface LoginOptions {
  mode: 'password' | 'chip'
  baseUrl: string
  username: string
  password: string
  watchId: string
  chipId: string
}

/** 密码登录成功、但账号绑定了设备又拿不到 chipId 时抛这个。 */
export class ChipRequiredError extends Error {
  constructor(
    readonly reason: 'bound-not-admin' | 'lookup-failed',
    message: string,
  ) {
    super(message)
    this.name = 'ChipRequiredError'
  }
}

/**
 * 登录。分支逻辑和桌面端保持一致：
 *
 * 1. 密码模式先换令牌；
 * 2. 填了 chipId 就带上直试；
 * 3. 没填就用空 chipId 探一次，通了说明账号没绑设备；
 * 4. 绑定过就尝试以管理员身份读自己的 chipId，读不到才要求手填。
 */
export async function login(options: LoginOptions): Promise<Session> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')

  if (options.mode === 'chip') {
    const watchId = options.watchId.trim()
    const chipId = options.chipId.trim()
    if (!watchId || !chipId) throw new Error('watchId 和 chipId 都要填')
    const credential: Credential = {
      mode: 'chip',
      baseUrl,
      watchId,
      chipId,
      authToken: '',
      expiresAt: 0,
    }
    await createClient(credential).listMoments({ size: 1 })
    return { credential, profile: await loadProfile(credential) }
  }

  const username = options.username.trim()
  const password = options.password
  if (!username || !password) throw new Error('用户名和密码都要填')

  const { credential, displayName } = await loginWithPassword({ baseUrl, username, password })
  const typedChip = options.chipId.trim()

  if (typedChip) {
    const withChip: Credential = { ...credential, chipId: typedChip }
    try {
      await createClient(withChip).listMoments({ size: 1 })
      return { credential: withChip, profile: await loadProfile(withChip, displayName) }
    } catch (error) {
      if (error instanceof MomentApiError && error.code === '000016') {
        throw new ChipRequiredError('bound-not-admin', '这个账号绑过设备，chipId 对不上')
      }
      throw error
    }
  }

  const probe = await probeBinding(credential)
  if (probe === 'unbound') {
    return { credential, profile: await loadProfile(credential, displayName) }
  }

  const looked = await lookupOwnChipId({
    baseUrl,
    watchId: credential.watchId,
    username,
    password,
  })
  if (!looked?.chipId) {
    throw new ChipRequiredError(
      'lookup-failed',
      '这个账号绑定了设备，需要 chipId。管理员账号能自动读取，读不到就得手动填。',
    )
  }

  const withLooked: Credential = { ...credential, chipId: looked.chipId }
  try {
    await createClient(withLooked).listMoments({ size: 1 })
    return { credential: withLooked, profile: await loadProfile(withLooked, displayName) }
  } catch (error) {
    if (error instanceof MomentApiError && error.code === '000016') {
      throw new ChipRequiredError('lookup-failed', '自动读到的 chipId 也没通过校验，请手动填')
    }
    throw error
  }
}

/** 拉昵称与头像，失败就用 watchId 顶上。 */
async function loadProfile(
  credential: Credential,
  fallbackName?: string,
): Promise<{ displayName: string; avatar: string }> {
  const client = createClient(credential)
  try {
    const info = await fetchProfile(client)
    if (info.displayName || info.avatar) {
      return {
        displayName: info.displayName || fallbackName || credential.watchId,
        avatar: info.avatar,
      }
    }
  } catch {
    // 落到下面用 feed 兜底。
  }
  try {
    const feed = await client.listMoments({ size: 20 })
    const mine = (feed.watchMoments ?? []).find((m) => m.watchId === credential.watchId)
    if (mine) {
      return {
        displayName: mine.watchName || fallbackName || credential.watchId,
        avatar: mine.iconPath || '',
      }
    }
  } catch {
    // 忽略。
  }
  return { displayName: fallbackName || credential.watchId, avatar: '' }
}

// ── 读 ────────────────────────────────────────────────────────────────────

export async function listFeed(end?: number, size = FEED_PAGE_SIZE): Promise<FeedPage> {
  const { credential } = requireSession()
  const client = createClient(credential)
  const feed = await client.listMoments({
    size,
    ...(end && end > 0 ? { end } : {}),
    commentPageSize: 20,
  })

  // 注意返回字段是 `watchMoments`，不是 `list` —— SDK 的 types 里写得很清楚。
  const raw = feed.watchMoments ?? []
  const moments = raw
    .filter((m) => m.watchId)
    .map((m) => toMomentView(client, m, credential.watchId))

  // nextEnd 用本页最早一条的时间：服务端按时间倒序，下一页接着往下取。
  const earliest = moments.length > 0 ? moments[moments.length - 1]!.createTime : 0
  return {
    moments,
    total: feed.total ?? moments.length,
    nextEnd: raw.length >= size && earliest > 0 ? earliest : null,
  }
}

export async function listComments(momentId: string, authorWatchId: string): Promise<CommentView[]> {
  const { credential } = requireSession()
  const client = createClient(credential)
  const result = await client.getComments(momentId, { pageNum: 1, pageSize: 100 })
  const list = (result as { comments?: unknown[] }).comments ?? []
  return list.map((c) =>
    toCommentView(c as Parameters<typeof toCommentView>[0], credential.watchId, authorWatchId),
  )
}

export async function listTopics(): Promise<TopicView[]> {
  const { credential } = requireSession()
  const client = createClient(credential)
  const result = await client.getTopics()
  return (result.topicList ?? []).map((t) => ({
    name: t.topicName,
    color: t.color,
    // 服务端 topicType 是数字，0 官方 / 1 用户；缺省当官方。
    knowledgeKind: (t.topicType === 1 ? 1 : 0) as 0 | 1,
    jumpUrl: t.jumpUrl,
  }))
}

// ── 写 ────────────────────────────────────────────────────────────────────

export async function toggleLike(moment: MomentView): Promise<boolean> {
  const { credential } = requireSession()
  const client = createClient(credential)
  // SDK 的 enableLike 是「还能点赞」，false 表示已经点过，所以用它取反判断。
  if (moment.likedByMe) {
    await client.unlikeMoment(moment.momentId, { momentWatchId: moment.authorWatchId })
    return false
  }
  await client.likeMoment(moment.momentId, { momentWatchId: moment.authorWatchId })
  return true
}

export async function postComment(
  moment: MomentView,
  text: string,
  replyToWatchId?: string,
): Promise<void> {
  const { credential } = requireSession()
  const client = createClient(credential)
  await client.commentMoment(moment.momentId, text, {
    momentWatchId: moment.authorWatchId,
    ...(replyToWatchId ? { replyToWatchId } : {}),
  })
}

/** 删一条评论。服务端会按「评论作者 / 动态作者」判权限，不用在前端再拦一道。 */
export async function removeComment(commentId: string): Promise<void> {
  const { credential } = requireSession()
  await createClient(credential).deleteComment(commentId)
}

export async function removeMoment(momentId: string): Promise<void> {
  const { credential } = requireSession()
  await createClient(credential).deleteMoment(momentId)
}

export interface PublishOptions {
  content: string
  topics?: string[]
  imagePaths?: string[]
  videoPath?: string
  coverPath?: string
  location?: string
}

export async function publish(options: PublishOptions): Promise<string> {
  const { credential } = requireSession()
  const client = createClient(credential)
  const result = await client.publishMoment({
    content: options.content,
    topics: options.topics,
    imagePaths: options.imagePaths,
    videoPath: options.videoPath,
    coverPath: options.coverPath,
    location: options.location,
  })
  return result.moment.momentId
}

export { humanizeError, createClient }
export type { AccountStatus, CommentView, FeedPage, MomentView, TopicView }
