/**
 * 主进程与渲染进程共用的契约。
 *
 * 这里刻意不 import SDK 的类型：渲染进程不该依赖一个 Node 包。
 * 视图模型只保留界面上真正要用的字段，顺手把话题颜色这类「手表专有」
 * 细节留在主进程里处理。
 */

export interface TopicView {
  name: string
  /** 服务端下发的颜色，形如 `#1E90FF`。可能是 `#FFFFFFCC` 这种手表深色底专用值。 */
  color?: string
  /** 0 = 官方话题，1 = 用户自建。 */
  knowledgeKind: 0 | 1
  jumpUrl?: string
}

export interface CommentView {
  commentId: string
  momentId: string
  authorWatchId: string
  authorName: string
  text: string
  createTime: number
  /** 回复时为被回复者；普通评论为 null。 */
  replyTo: { watchId: string; name: string } | null
  /** 动态作者的 watchId，用来判断「作者」标签与删除权限。 */
  momentAuthorWatchId: string
  /** 当前账号能否删这条：评论作者、动态作者。 */
  canDelete: boolean
}

export interface MomentView {
  momentId: string
  authorWatchId: string
  authorName: string
  authorAvatar: string
  /** 正文纯文本。纯视频动态（type=6）这里一定是空串。 */
  text: string
  images: string[]
  videos: string[]
  cover: string
  location: string
  createTime: number
  type: number
  topics: TopicView[]
  likeTotal: number
  /** 服务端给的是「还能点赞」：false 表示自己已经赞过。 */
  likedByMe: boolean
  commentsTotalCount: number
  /** 列表接口每页带回的评论，按时间正序。 */
  comments: CommentView[]
  isMine: boolean
}

export interface FeedPage {
  moments: MomentView[]
  /** 服务端总数（不分页前的条数）。 */
  total: number
  /** 下一页游标；null 表示到头了。 */
  nextEnd: number | null
}

export interface CommentPage {
  comments: CommentView[]
  totalCount: number
  pageNum: number
  pageSize: number
  totalPage: number
}

export interface TopicConfigView {
  maxTopicCount: number
  topicNameMaxLength: number
}

export interface TopicListResult {
  config: TopicConfigView
  topics: TopicView[]
}

/** 登录方式：凭据（watchId + chipId）或用户名密码。 */
export type AuthMode = 'chip' | 'password'

export interface AccountStatus {
  signedIn: boolean
  baseUrl: string
  /** 当前账号昵称；登录后才会填上。 */
  displayName: string
  /** 当前账号头像；空串表示没有。 */
  avatar: string
  /** 当前账号 watchId；用于「只看我的」。 */
  watchId: string
  /** safeStorage 可用时为 true。为 false 时只在本次会话内保存凭据。 */
  rememberable: boolean
  /** 当前登录方式。 */
  mode: AuthMode
  /** 密码模式下令牌过期时间（毫秒）；chip 模式为 0。 */
  expiresAt: number
}

/**
 * 登录入参。
 *
 * - `mode: 'chip'`：只需要 watchId + chipId。
 * - `mode: 'password'`：用户名密码必填；chipId 可选 ——
 *   账号没绑 chipId 时留空即可；绑了的话，管理员会自动从后台读到自己的，
 *   非管理员则会收到「必须手动填」的提示。
 */
export interface LoginInput {
  mode: AuthMode
  baseUrl: string
  /** 密码模式用。 */
  username: string
  password: string
  /** chip 模式的 watchId。密码模式下由服务端从令牌里给出，不需要填。 */
  watchId: string
  chipId: string
  remember: boolean
}

/** 密码登录时如果拿不到 chipId，用这个告诉界面为什么。 */
export type ChipRequiredReason = 'bound-not-admin' | 'lookup-failed'

export interface LoginErrorDetail {
  /** 需要用户手动补 chipId 时为 true。 */
  chipRequired: boolean
  reason?: ChipRequiredReason
  /** 服务端给出的 watchId（密码登录成功但缺少 chipId 时也有值）。 */
  watchId?: string
}

export interface PublishInput {
  content: string
  topics: string[]
  imagePaths: string[]
  videoPath: string | null
  coverPath: string | null
  location: string
}

export interface FeedQuery {
  end?: number
  size?: number
}

export interface VideoPickResult {
  videoPath: string
  /** 封面路径；抽帧失败且用户也没挑时是 null。 */
  coverPath: string | null
  /** 封面的 data URL，给发布前预览用。 */
  coverPreview: string
  /** 封面是不是从视频第一帧自动抽的。 */
  coverAuto: boolean
}

export interface CoverPickResult {
  coverPath: string
  coverPreview: string
  coverAuto: boolean
}

export type IpcOk<T> = { ok: true; data: T }
export type IpcErr = { ok: false; code: string; message: string; detail?: LoginErrorDetail }
export type IpcResult<T> = IpcOk<T> | IpcErr

/** preload 暴露到 `window.moment` 的方法表。 */
export interface MomentBridge {
  accountStatus(): Promise<IpcResult<AccountStatus>>
  login(input: LoginInput): Promise<IpcResult<AccountStatus>>
  logout(): Promise<IpcResult<AccountStatus>>

  feedList(query: FeedQuery): Promise<IpcResult<FeedPage>>
  momentGet(momentId: string): Promise<IpcResult<MomentView>>

  commentList(input: {
    momentId: string
    pageNum: number
    pageSize: number
  }): Promise<IpcResult<CommentPage>>
  commentCreate(input: {
    momentId: string
    momentAuthorWatchId: string
    text: string
    replyToWatchId?: string
  }): Promise<IpcResult<CommentView>>
  commentDelete(input: { commentId: string }): Promise<IpcResult<{ deleted: boolean }>>

  publish(input: PublishInput): Promise<IpcResult<MomentView>>
  momentDelete(input: { momentId: string }): Promise<IpcResult<{ deleted: boolean }>>
  momentLike(input: {
    momentId: string
    momentAuthorWatchId: string
    liked: boolean
  }): Promise<IpcResult<{ liked: boolean; likeTotal: number }>>

  topics(): Promise<IpcResult<TopicListResult>>

  pickImages(): Promise<IpcResult<string[]>>
  pickVideo(): Promise<IpcResult<VideoPickResult | null>>
  /** 换一张视频封面（替换掉自动抽的第一帧）。 */
  pickCover(currentPath: string | null): Promise<IpcResult<CoverPickResult | null>>
  /** 把本地图片缩成小预览（data URL），供发布前确认。 */
  previewImages(paths: string[]): Promise<IpcResult<{ path: string; dataUrl: string }[]>>
}
