/**
 * SDK 封装层。
 *
 * 所有与好友圈服务端的通信都在主进程里发生：
 * - SDK 依赖 `node:crypto` / `node:fs`，只有主进程能跑；
 * - 服务端没有任何 CORS 头，浏览器渲染进程跨源直连会被拦；
 * - chipId 留在主进程，渲染进程拿不到。
 */

import {
  MomentClient,
  MomentApiError,
  type Moment,
  type MomentComment,
} from '@caremiumos-dev/node-moment-sdk'
import type { CommentView, MomentView, TopicView } from '../src/shared/types.js'
import type { Credential } from './credential.js'

const SDK_DEVICE_ID = 'moment-web'

/** 服务端分页上限 200；一次拉满能少几个来回。 */
export const FEED_PAGE_SIZE = 20

/**
 * 建 SDK 客户端。
 *
 * 两种登录方式共用同一个客户端，chipId 的来源不同但落点一样：
 * - chip 模式：用户填的设备芯片号；
 * - 密码模式：账号未绑定时留空即可通过鉴权；已绑定则要在登录时
 *   从后台读到（或用户自己填），否则服务端返回 000016。
 */
export function createClient(cred: Credential): MomentClient {
  return new MomentClient({
    baseUrl: cred.baseUrl,
    watchId: cred.watchId,
    chipId: cred.chipId,
    deviceId: SDK_DEVICE_ID,
    timeoutMs: 20_000,
  })
}

/**
 * SDK 的 `transport` 是 private 字段，类型层面拿不到；但运行时它就在实例上，
 * 而 `Transport.post` 已经帮我们处理了鉴权头、超时与错误信封。
 * 这里单独描述它要用的那一小块，而不是 `as any`。
 */
interface RawTransport {
  transport: {
    post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>
  }
}

/**
 * 把 SDK 异常翻译成给用户看的一句话。
 *
 * 服务端 desc 多为英文（`device does not match this account`），
 * 直接甩给用户既看不懂也没意义，所以按错误码给中文，原始 desc 留给调用方打日志。
 */
export function humanizeError(error: unknown): { code: string; message: string } {
  if (error instanceof MomentApiError) {
    switch (error.code) {
      case '000002':
        return { code: error.code, message: '服务端拒绝了这次请求：参数不合法，或你没有权限操作它。' }
      case '000003':
        return { code: error.code, message: '账号不存在，或凭据不匹配。请检查 watchId 与 chipId。' }
      case '000004':
        return { code: error.code, message: '这个账号已被停用。' }
      case '000005':
        return { code: error.code, message: '这条内容已经不在了，可能刚被作者删掉。' }
      case '000006':
        return { code: error.code, message: '没有权限做这件事。' }
      case '000007':
        return { code: error.code, message: '账号已被封禁，所有操作都被拒绝。' }
      case '000016':
        return { code: error.code, message: 'chipId 与这个账号不匹配（或账号已绑定到别的设备）。' }
      case 'NETWORK':
        return { code: 'NETWORK', message: '连不上服务器，检查一下服务端地址和服务是否在运行。' }
      case 'TIMEOUT':
        return { code: 'TIMEOUT', message: '服务器响应超时，稍后再试。' }
      default:
        if (error.code.startsWith('HTTP_')) {
          return { code: error.code, message: `服务器返回了 ${error.code.slice(5)}，可能不是好友圈服务端。` }
        }
        return { code: error.code, message: error.desc || '请求失败。' }
    }
  }
  if (error instanceof Error && error.message) {
    return { code: 'UNKNOWN', message: error.message }
  }
  return { code: 'UNKNOWN', message: '发生了未知错误。' }
}

/** 话题颜色是否能在浅色纸面上用。手表的 `#FFFFFFCC` 这类半透明白一律不可用。 */
export function isUsableOnLight(color: string | undefined): boolean {
  if (!color) return false
  const hex = color.trim()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.test(hex)) return false
  let body = hex.slice(1)
  if (body.length === 3) body = body.split('').map((c) => c + c).join('')
  const alpha = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1
  if (alpha < 0.5) return false
  const r = parseInt(body.slice(0, 2), 16)
  const g = parseInt(body.slice(2, 4), 16)
  const b = parseInt(body.slice(4, 6), 16)
  // 相对亮度（sRGB 近似），小于 0.55 才在米白纸面上看得清。
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance < 0.55
}

function toTopicView(topic: { topicName: string; color?: string; jumpUrl?: string; topicType?: number }): TopicView {
  const color = isUsableOnLight(topic.color) ? topic.color : undefined
  return {
    name: topic.topicName,
    ...(color ? { color } : {}),
    knowledgeKind: topic.topicType === 0 ? 0 : 1,
    ...(topic.jumpUrl ? { jumpUrl: topic.jumpUrl } : {}),
  }
}

export function toCommentView(
  comment: MomentComment,
  currentWatchId: string,
  momentAuthorWatchId: string,
): CommentView {
  return {
    commentId: comment.commentId,
    momentId: comment.momentId,
    authorWatchId: comment.watchId,
    authorName: comment.watchName || '未命名',
    text: comment.comment,
    createTime: comment.createTime,
    replyTo:
      comment.type === 2 && comment.replyWatchId
        ? { watchId: comment.replyWatchId, name: comment.replyWatchName || comment.replyName || '某人' }
        : null,
    momentAuthorWatchId,
    canDelete: comment.watchId === currentWatchId || momentAuthorWatchId === currentWatchId,
  }
}

/** 一条 SDK 动态 → 视图模型。 */
export function toMomentView(
  client: MomentClient,
  moment: Moment,
  currentWatchId: string,
): MomentView {
  const body = client.parseBody(moment)
  const authorWatchId = moment.watchId
  return {
    momentId: moment.momentId,
    authorWatchId,
    authorName: moment.watchName || moment.name || '未命名',
    authorAvatar: moment.iconPath || '',
    text: body.text ?? '',
    images: body.images ?? [],
    videos: body.videos ?? [],
    cover: body.cover ?? '',
    location: moment.location ?? '',
    createTime: moment.createTime,
    type: moment.type,
    topics: (moment.topicList ?? []).map(toTopicView),
    likeTotal: moment.likeTotal ?? 0,
    // enableLike 是「还能点赞」：false 才代表自己已经赞过。
    likedByMe: moment.enableLike === false,
    commentsTotalCount: moment.commentsTotalCount ?? 0,
    comments: (moment.comments ?? [])
      .slice()
      // 服务端返回的评论是新到旧，界面上按时间正序读起来更顺。
      .sort((a, b) => a.createTime - b.createTime)
      .map((comment) => toCommentView(comment, currentWatchId, authorWatchId)),
    isMine: authorWatchId === currentWatchId,
  }
}

/**
 * 当前账号的昵称与头像。
 *
 * 不能靠「在 feed 里找自己发的那条动态」来猜：一个人可能从没发过动态，
 * 也可能最近一条被删了，那时昵称就退化成一串 watchId。
 * `/smartwatch/geniusAccount/watchGetInfo` 是专门拿账号资料的接口，直接问它。
 * SDK 没包这个接口，但传输层（鉴权头、超时、错误码）可以直接复用。
 */
export async function fetchProfile(client: MomentClient): Promise<{ displayName: string; avatar: string }> {
  const transport = (client as unknown as RawTransport).transport
  const info = await transport.post<{
    watchName?: string
    name?: string
    icon?: string
  }>('/smartwatch/geniusAccount/watchGetInfo', {})
  return {
    displayName: info?.watchName || info?.name || '',
    avatar: info?.icon || '',
  }
}

export { MomentApiError }
