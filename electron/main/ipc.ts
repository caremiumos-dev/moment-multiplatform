/**
 * IPC 处理函数。
 *
 * 约定：每个 handler 先把参数收窄成正确形状再碰 SDK —— 渲染进程即使被注入
 * 恶意脚本，也只能通过这里暴露的方法做合法调用。返回值统一是
 * `{ ok: true, data }` / `{ ok: false, code, message }`，渲染层只处理一种错误形状。
 */

import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import type {
  AccountStatus,
  ChipRequiredReason,
  CommentPage,
  CommentView,
  FeedPage,
  IpcResult,
  LoginInput,
  MomentView,
  PublishInput,
  TopicListResult,
} from '@shared/types'
import {
  canRemember,
  clearCredential,
  loadCredential,
  saveCredential,
  type AuthMode,
  type Credential,
} from './credentials'
import { loginWithPassword, probeBinding, revokeToken } from '../../core/auth.js'
import { lookupOwnChipId } from '../../core/admin-chip.js'
import { cleanupCover, extractVideoCover, readCoverAsDataUrl } from './cover'
import {
  FEED_PAGE_SIZE,
  MomentApiError,
  createClient,
  fetchProfile,
  humanizeError,
  toMomentView,
} from '../../core/moment.js'

/** 当前会话的凭据。chipId / authToken 只存在于这个对象里，绝不下发渲染进程。 */
let session: Credential | null = null
/** 当前账号显示信息，登录后填上，用于界面右上角。 */
let profile: { displayName: string; avatar: string } = { displayName: '', avatar: '' }

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail(error: unknown): IpcResult<never> {
  const { code, message } = humanizeError(error)
  // 服务端 desc 留在主进程日志里，界面只看到中文那句话。
  console.error('[moment]', code, error instanceof Error ? error.message : error)
  return { ok: false, code, message }
}

function requireSession(): Credential {
  if (!session) throw new MomentApiError('000003', 'not signed in')
  return session
}

function statusOf(): AccountStatus {
  return {
    signedIn: session !== null,
    baseUrl: session?.baseUrl ?? '',
    displayName: profile.displayName,
    avatar: profile.avatar,
    watchId: session?.watchId ?? '',
    rememberable: canRemember(),
    mode: session?.mode ?? 'password',
    // 密码登录的令牌会过期，界面上要能提前提醒。
    expiresAt: session?.mode === 'password' ? session.expiresAt : 0,
  }
}

function str(value: unknown, field: string, maxLength = 4096): string {
  if (typeof value !== 'string') throw new MomentApiError('000002', `${field} must be a string`)
  if (value.length > maxLength) throw new MomentApiError('000002', `${field} too long`)
  return value
}

function strList(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value)) throw new MomentApiError('000002', `${field} must be an array`)
  if (value.length > maxItems) throw new MomentApiError('000002', `${field} has too many items`)
  return value.map((item) => str(item, field, 4096))
}

/**
 * 拉当前账号的昵称与头像。
 *
 * 先问账号资料接口；失败时退一步：从 feed 里找自己最近发的那条动态，
 * 用它的 `watchName` / `iconPath` 兜底。两条路都不通才显示 watchId。
 */
async function refreshProfile(cred: Credential): Promise<void> {
  const client = createClient(cred)
  try {
    const info = await fetchProfile(client)
    if (info.displayName || info.avatar) {
      profile = {
        displayName: info.displayName || cred.watchId,
        avatar: info.avatar,
      }
      return
    }
  } catch {
    // 落到下面用 feed 兜底。
  }

  try {
    const feed = await client.listMoments({ size: 20 })
    const mine = feed.watchMoments.find((moment) => moment.watchId === cred.watchId)
    if (mine) {
      profile = {
        displayName: mine.watchName || mine.name || cred.watchId,
        avatar: mine.iconPath || '',
      }
      return
    }
  } catch {
    // 忽略：用 watchId 兜底。
  }

  profile = { displayName: cred.watchId, avatar: '' }
}

export async function restoreSession(): Promise<void> {
  const cred = await loadCredential()
  if (!cred) return
  // 密码模式的令牌可能已经在服务端被撤销，恢复时轻量探一次；
  // 真失败了就让用户重新登录，别让主界面一进来就是一屏错误。
  if (cred.mode === 'password') {
    try {
      await createClient(cred).listMoments({ size: 1 })
    } catch {
      await clearCredential()
      return
    }
  }
  session = cred
  await refreshProfile(cred)
}

/** 需要用户手动补 chipId 时抛这个，由登录 handler 翻译成带 detail 的失败。 */
class ChipRequiredError extends Error {
  constructor(
    readonly reason: ChipRequiredReason,
    readonly watchId: string,
  ) {
    super('chipId required')
    this.name = 'ChipRequiredError'
  }
}

/** 带 detail 的失败响应：界面据此展开 chipId 输入框。 */
function chipRequired(reason: ChipRequiredReason, watchId: string): IpcResult<never> {
  const message =
    reason === 'bound-not-admin'
      ? '这个账号已经绑定过设备，需要通过 chipId 校验。请填写该设备的 chipId 后重试。'
      : '这个账号已经绑定过设备，但自动读取 chipId 失败了。请手动填写 chipId 后重试。'
  return { ok: false, code: 'CHIP_REQUIRED', message, detail: { chipRequired: true, reason, watchId } }
}

/** 凭据模式：watchId + chipId 直接打接口验证。 */
async function loginWithChip(input: { baseUrl: string; input: LoginInput }): Promise<Credential> {
  const watchId = str(input.input.watchId, 'watchId', 200).trim()
  const chipId = str(input.input.chipId, 'chipId', 500).trim()
  if (!watchId || !chipId) {
    throw new MomentApiError('000002', 'watchId and chipId are required')
  }
  const cred: Credential = {
    mode: 'chip',
    baseUrl: input.baseUrl,
    watchId,
    chipId,
    authToken: '',
    expiresAt: 0,
  }
  // 先真正打一次接口：凭据错了就在这一步失败，不会把错凭据存下来。
  await createClient(cred).listMoments({ size: 1 })
  return cred
}

/**
 * 密码模式的分支判断，这是整个登录里最绕的一段，按顺序是：
 *
 * 1. 用户名密码换令牌 —— 错了就直接报错，连 watchId 都拿不到；
 * 2. 用户自己填了 chipId → 直接带上试一次，通了就完事；
 * 3. 没填 → 用空 chipId 探一次：
 *    - 通了：账号没绑设备，密码模式开箱即用；
 *    - 000016：绑过了，必须给 chipId。这时候再尝试以管理员身份
 *      从后台读出自己的 chipId（服务端 API 不回传 chipId，只有后台页面有）；
 *      读到了就带上重试，读不到就要求用户手动填。
 */
async function loginWithPasswordFlow(input: {
  baseUrl: string
  input: LoginInput
}): Promise<Credential> {
  const username = str(input.input.username, 'username', 200).trim()
  const password = str(input.input.password, 'password', 500)
  if (!username || !password) {
    throw new MomentApiError('000002', 'username and password are required')
  }

  const { credential, displayName } = await loginWithPassword({
    baseUrl: input.baseUrl,
    username,
    password,
  })
  profile = { displayName, avatar: '' }

  const typedChipId = str(input.input.chipId ?? '', 'chipId', 500).trim()

  // ② 用户主动填了 chipId：直接带上试。
  if (typedChipId) {
    const withChip: Credential = { ...credential, chipId: typedChipId }
    try {
      await createClient(withChip).listMoments({ size: 1 })
      return withChip
    } catch (error) {
      if (error instanceof MomentApiError && error.code === '000016') {
        throw new ChipRequiredError('bound-not-admin', credential.watchId)
      }
      throw error
    }
  }

  // ③ 没填：先用空 chipId 探一下绑定状态。
  const probe = await probeBinding(credential)
  if (probe === 'unbound') return credential

  // 绑定过了：管理员可以从后台读到自己的 chipId。
  const looked = await lookupOwnChipId({
    baseUrl: input.baseUrl,
    watchId: credential.watchId,
    username,
    password,
  })
  if (!looked?.chipId) {
    throw new ChipRequiredError('lookup-failed', credential.watchId)
  }

  const withLooked: Credential = { ...credential, chipId: looked.chipId }
  try {
    await createClient(withLooked).listMoments({ size: 1 })
    return withLooked
  } catch (error) {
    if (error instanceof MomentApiError && error.code === '000016') {
      throw new ChipRequiredError('lookup-failed', credential.watchId)
    }
    throw error
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /**
   * 打开系统文件对话框。
   *
   * `dialog.showOpenDialog(win, options)` 与 `dialog.showOpenDialog(options)`
   * 是两种签名，窗口还没建好时传 `undefined` 会被当成 options 解析而报错，
   * 所以这里按有无窗口分开调用。
   */
  const openDialog = (options: Electron.OpenDialogOptions) => {
    const window = getWindow()
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
  }

  // ── 账号 ────────────────────────────────────────────────────────────────

  ipcMain.handle('account:status', async () => ok(statusOf()))

  ipcMain.handle('account:login', async (_event, raw: unknown) => {
    try {
      const input = raw as LoginInput
      if (!input || typeof input !== 'object') throw new MomentApiError('000002', 'bad input')

      const baseUrl = str(input.baseUrl, 'baseUrl', 500).trim().replace(/\/+$/, '')
      if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
        throw new MomentApiError('000002', 'baseUrl must start with http:// or https://')
      }
      const mode: AuthMode = input.mode === 'chip' ? 'chip' : 'password'
      const remember = Boolean(input.remember)

      const cred =
        mode === 'chip'
          ? await loginWithChip({ baseUrl, input })
          : await loginWithPasswordFlow({ baseUrl, input })

      session = cred
      await saveCredential(cred, remember)
      await refreshProfile(cred)
      return ok(statusOf())
    } catch (error) {
      if (error instanceof ChipRequiredError) {
        return chipRequired(error.reason, error.watchId)
      }
      return fail(error)
    }
  })

  ipcMain.handle('account:logout', async () => {
    const previous = session
    session = null
    profile = { displayName: '', avatar: '' }
    await clearCredential()
    // 密码模式的令牌是可撤销的，退出时顺手作废，别让它躺在服务端 30 天。
    if (previous?.mode === 'password' && previous.authToken) {
      await revokeToken(previous.baseUrl, previous.authToken)
    }
    return ok(statusOf())
  })

  // ── 动态流 ──────────────────────────────────────────────────────────────

  ipcMain.handle('feed:list', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const query = (raw ?? {}) as { end?: unknown; size?: unknown }
      const end = typeof query.end === 'number' && query.end > 0 ? query.end : 0
      const size =
        typeof query.size === 'number' && query.size > 0 && query.size <= 200
          ? query.size
          : FEED_PAGE_SIZE

      const client = createClient(creds)
      const feed = await client.listMoments({
        size,
        ...(end > 0 ? { end } : {}),
        commentPageSize: 20,
      })
      const moments = feed.watchMoments
        .filter((moment) => moment.watchId)
        .map((moment) => toMomentView(client, moment, creds.watchId))

      // 服务端按 createTime <= end 过滤，同秒多条会重复；用 momentId 去重，
      // 游标也取最后一条的时间戳，让调用方自己排重。
      const nextEnd =
        moments.length === size
          ? (moments[moments.length - 1]?.createTime ?? null)
          : null

      return ok<FeedPage>({ moments, total: feed.total, nextEnd })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('moment:get', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const momentId = str(raw, 'momentId', 200)
      const client = createClient(creds)
      // 服务端没有「按 id 查」，SDK 只能翻页扫描，会慢一点。
      const moment = await client.findMoment(momentId)
      return ok<MomentView>(toMomentView(client, moment, creds.watchId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('moment:delete', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const payload = raw as { momentId?: unknown }
      await createClient(creds).deleteMoment(str(payload?.momentId, 'momentId', 200))
      return ok({ deleted: true })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('moment:like', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const payload = raw as { momentId?: unknown; momentAuthorWatchId?: unknown; liked?: unknown }
      const momentId = str(payload?.momentId, 'momentId', 200)
      const momentWatchId = str(payload?.momentAuthorWatchId, 'momentAuthorWatchId', 200)
      const liked = Boolean(payload?.liked)
      const client = createClient(creds)
      // 带上 momentWatchId：不带的话 SDK 会为了查作者翻遍整个 feed。
      if (liked) {
        await client.likeMoment(momentId, { momentWatchId })
      } else {
        await client.unlikeMoment(momentId, { momentWatchId })
      }
      // 点赞总数没有单独接口，重查这一条最省事。
      const moment = await client.findMoment(momentId)
      return ok({ liked, likeTotal: moment.likeTotal })
    } catch (error) {
      return fail(error)
    }
  })

  // ── 评论 ────────────────────────────────────────────────────────────────

  ipcMain.handle('comment:list', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const payload = raw as { momentId?: unknown; pageNum?: unknown; pageSize?: unknown }
      const momentId = str(payload?.momentId, 'momentId', 200)
      const pageNum = typeof payload?.pageNum === 'number' && payload.pageNum > 0 ? payload.pageNum : 1
      const pageSize =
        typeof payload?.pageSize === 'number' && payload.pageSize > 0 && payload.pageSize <= 100
          ? payload.pageSize
          : 20
      const client = createClient(creds)
      const [result, moment] = await Promise.all([
        client.getComments(momentId, { pageNum, pageSize }),
        // 评论视图要判断删除权限，得知道动态作者是谁。
        client.findMoment(momentId),
      ])
      const comments: CommentView[] = result.comments
        .slice()
        .sort((a, b) => a.createTime - b.createTime)
        .map((comment) => ({
          commentId: comment.commentId,
          momentId: comment.momentId,
          authorWatchId: comment.watchId,
          authorName: comment.watchName || '未命名',
          text: comment.comment,
          createTime: comment.createTime,
          replyTo:
            comment.type === 2 && comment.replyWatchId
              ? {
                  watchId: comment.replyWatchId,
                  name: comment.replyWatchName || comment.replyName || '某人',
                }
              : null,
          momentAuthorWatchId: moment.watchId,
          canDelete:
            comment.watchId === creds.watchId || moment.watchId === creds.watchId,
        }))
      return ok<CommentPage>({
        comments,
        totalCount: result.totalCount,
        pageNum: result.pageNum,
        pageSize: result.pageSize,
        totalPage: Math.max(1, Math.ceil(result.totalCount / pageSize)),
      })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('comment:create', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const payload = raw as {
        momentId?: unknown
        momentAuthorWatchId?: unknown
        text?: unknown
        replyToWatchId?: unknown
      }
      const momentId = str(payload?.momentId, 'momentId', 200)
      const momentAuthorWatchId = str(payload?.momentAuthorWatchId, 'momentAuthorWatchId', 200)
      const text = str(payload?.text, 'text', 1000).trim()
      if (!text) throw new MomentApiError('000002', 'comment is empty')
      const replyToWatchId =
        typeof payload?.replyToWatchId === 'string' && payload.replyToWatchId
          ? payload.replyToWatchId
          : undefined

      const result = await createClient(creds).commentMoment(momentId, text, {
        momentWatchId: momentAuthorWatchId,
        ...(replyToWatchId ? { replyToWatchId } : {}),
      })
      const comment = result.comment
      return ok<CommentView>({
        commentId: comment.commentId,
        momentId: comment.momentId,
        authorWatchId: comment.watchId,
        authorName: comment.watchName || profile.displayName || '我',
        text: comment.comment,
        createTime: comment.createTime,
        replyTo:
          comment.type === 2 && comment.replyWatchId
            ? {
                watchId: comment.replyWatchId,
                name: comment.replyWatchName || comment.replyName || '某人',
              }
            : null,
        momentAuthorWatchId,
        canDelete: true,
      })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('comment:delete', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const payload = raw as { commentId?: unknown }
      await createClient(creds).deleteComment(str(payload?.commentId, 'commentId', 200))
      return ok({ deleted: true })
    } catch (error) {
      return fail(error)
    }
  })

  // ── 发布 ────────────────────────────────────────────────────────────────

  ipcMain.handle('publish', async (_event, raw: unknown) => {
    try {
      const creds = requireSession()
      const input = raw as PublishInput
      if (!input || typeof input !== 'object') throw new MomentApiError('000002', 'bad input')

      const content = str(input.content ?? '', 'content', 2000)
      const topics = strList(input.topics ?? [], 'topics', 10)
      const imagePaths = strList(input.imagePaths ?? [], 'imagePaths', 9)
      const videoPath = input.videoPath ? str(input.videoPath, 'videoPath', 4096) : null
      const coverPath = input.coverPath ? str(input.coverPath, 'coverPath', 4096) : null
      const location = str(input.location ?? '', 'location', 100)

      if (videoPath && imagePaths.length > 0) {
        // SDK 也会拦，这里提前拦是为了给出人话提示。
        throw new MomentApiError('000002', 'video and images are mutually exclusive')
      }
      if (!content.trim() && imagePaths.length === 0 && !videoPath) {
        throw new MomentApiError('000002', 'nothing to publish')
      }

      const client = createClient(creds)
      try {
        const result = await client.publishMoment({
          content,
          topics,
          ...(imagePaths.length > 0 ? { imagePaths } : {}),
          ...(videoPath ? { videoPath } : {}),
          ...(videoPath && coverPath ? { coverPath } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
        })
        return ok<MomentView>(toMomentView(client, result.moment, creds.watchId))
      } finally {
        // 自动抽出来的封面只是上传用的中转文件，发完就删，不管成功与否。
        if (coverPath?.includes('moment-web-covers')) await cleanupCover(coverPath)
      }
    } catch (error) {
      return fail(error)
    }
  })

  // ── 话题 ────────────────────────────────────────────────────────────────

  ipcMain.handle('topics:list', async () => {
    try {
      const creds = requireSession()
      const recommendation = await createClient(creds).getTopics()
      return ok<TopicListResult>({
        config: {
          maxTopicCount: recommendation.config?.maxTopicCount || 2,
          topicNameMaxLength: recommendation.config?.topicNameMaxLength || 12,
        },
        topics: (recommendation.topicList ?? []).map((topic) => ({
          name: topic.topicName,
          // 颜色只用来判断官方/自建话题的样式，不做文字色 —— 服务端默认的
          // `#FFFFFFCC` 在纸面上看不见，具体怎么渲染交给前端的 isUsableOnLight。
          knowledgeKind: topic.topicType === 0 ? 0 : 1,
          ...(topic.jumpUrl ? { jumpUrl: topic.jumpUrl } : {}),
        })),
      })
    } catch (error) {
      return fail(error)
    }
  })

  // ── 文件选择 ────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:pickImages', async () => {
    try {
      const result = await openDialog({
        title: '选择图片',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
      })
      return ok(result.canceled ? [] : result.filePaths)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('dialog:pickVideo', async () => {
    try {
      const result = await openDialog({
        title: '选择视频',
        properties: ['openFile'],
        filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm'] }],
      })
      const videoPath = result.canceled ? undefined : result.filePaths[0]
      console.log('[pickVideo] 选择结果:', videoPath ?? '(取消)')
      if (!videoPath) return ok(null)

      // 默认拿视频第一帧当封面：没有封面时手表端列表会退化成黑块。
      // 抽帧失败（编码不被支持等）不阻断发布，也不再弹一次文件框打断用户 ——
      // 返回空封面，发布器里会显示「未设置」，需要的话用户自己点「换封面」。
      console.log('[pickVideo] 开始抽帧…')
      const startedAt = Date.now()
      const coverPath = await extractVideoCover(videoPath).catch((error: unknown) => {
        console.warn('[pickVideo] 抽帧失败：', error instanceof Error ? error.message : error)
        return null
      })
      console.log(
        '[pickVideo] 抽帧结束',
        Date.now() - startedAt + 'ms',
        coverPath ? '有封面' : '无封面',
      )

      return ok({
        videoPath,
        coverPath,
        coverPreview: coverPath ? await readCoverAsDataUrl(coverPath).catch(() => '') : '',
        // 标记封面是不是自动抽的，界面上要能说清楚「这是第一帧」。
        coverAuto: Boolean(coverPath),
      })
    } catch (error) {
      return fail(error)
    }
  })

  /** 换一张封面：手动挑图，替换掉自动抽出来的第一帧。 */
  ipcMain.handle('dialog:pickCover', async (_event, raw: unknown) => {
    try {
      const current = typeof raw === 'string' && raw ? raw : null
      const result = await openDialog({
        title: '选择视频封面',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      })
      const picked = result.canceled ? undefined : result.filePaths[0]
      if (!picked) return ok(null)

      // 换掉旧封面时顺手删掉自动抽出来的临时文件，别在临时目录里堆。
      if (current?.includes('moment-web-covers')) await cleanupCover(current)

      return ok({
        coverPath: picked,
        coverPreview: await readCoverAsDataUrl(picked).catch(() => ''),
        coverAuto: false,
      })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('file:preview', async (_event, raw: unknown) => {
    try {
      const paths = strList(raw, 'paths', 12)
      // 先缩到 320 像素再转 data URL：原图可能是几 MB 的手机照片，
      // 整个塞进 IPC 又塞进 DOM 会明显卡顿。
      const previews = paths.map((path) => {
        const image = nativeImage.createFromPath(path)
        const scaled = image.isEmpty()
          ? image
          : image.getSize().width > 320
            ? image.resize({ width: 320, quality: 'good' })
            : image
        return { path, dataUrl: scaled.isEmpty() ? '' : scaled.toDataURL() }
      })
      return ok(previews)
    } catch (error) {
      return fail(error)
    }
  })
}
