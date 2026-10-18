/**
 * 一条动态。
 *
 * 布局仿编辑部的「条目」而不是社交卡片：
 * 左侧一竖排（头像 + 连接线），右侧正文栏。条目之间用 1px 细线分隔，
 * 没有卡片底板、没有圆角阴影 —— 让内容本身构成节奏。
 */

import { useState } from 'react'
import type { CommentView, MomentView } from '@shared/types'
import { IconComment, IconLike, IconPin } from './icons'
import Avatar from './Avatar'
import ImageGrid from './ImageGrid'
import VideoPlayer from './VideoPlayer'
import TopicList from './TopicList'
import CommentList from './CommentList'
import { formatFullTime, formatTime } from '../lib/format'
import './moment-card.css'

interface MomentCardProps {
  moment: MomentView
  onOpenImage: (images: string[], index: number) => void
  onLike: (moment: MomentView) => void
  onDelete: (moment: MomentView) => void
  onReply: (moment: MomentView, comment: CommentView) => void
  onDeleteComment: (comment: CommentView) => void
  onOpenDetail: (moment: MomentView) => void
  /** 正在点赞中，禁用按钮防连点。 */
  liking?: boolean
  /** 详情页里显示全部评论，列表里只显示前几条。 */
  expanded?: boolean
}

/** 列表里最多先露几条评论，剩下的给「查看全部」。 */
const COMMENT_PREVIEW = 3

export default function MomentCard({
  moment,
  onOpenImage,
  onLike,
  onDelete,
  onReply,
  onDeleteComment,
  onOpenDetail,
  liking = false,
  expanded = false,
}: MomentCardProps) {
  const [confirming, setConfirming] = useState(false)

  const previewComments = expanded
    ? moment.comments
    : moment.comments.slice(-COMMENT_PREVIEW)
  const hiddenCount = moment.commentsTotalCount - previewComments.length
  const hasVideo = moment.videos.length > 0

  return (
    <article className="moment">
      <div className="moment__gutter">
        <Avatar src={moment.authorAvatar} name={moment.authorName} size={36} />
      </div>

      <div className="moment__main">
        <header className="moment__head">
          <span className="moment__author">{moment.authorName}</span>
          {moment.isMine ? <span className="moment__badge">我</span> : null}
          <time className="moment__time num" dateTime={new Date(moment.createTime).toISOString()} title={formatFullTime(moment.createTime)}>
            {formatTime(moment.createTime)}
          </time>
          {moment.location ? (
            <span className="moment__place">
              <IconPin size={12} />
              {moment.location}
            </span>
          ) : null}

          <span className="moment__spacer" />

          {moment.isMine ? (
            confirming ? (
              <span className="moment__confirm">
                <button type="button" className="textbtn" onClick={() => setConfirming(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="textbtn"
                  data-tone="accent"
                  onClick={() => {
                    setConfirming(false)
                    onDelete(moment)
                  }}
                >
                  确认删除
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="moment__more"
                onClick={() => setConfirming(true)}
                title="删除这条动态"
              >
                删除
              </button>
            )
          ) : null}
        </header>

        {/* 纯视频动态（type=6）的正文压根不入库，别渲染空心段落。 */}
        {moment.text.trim() ? <p className="moment__text read">{moment.text}</p> : null}

        {moment.images.length > 0 && !hasVideo ? (
          <div className="moment__media">
            <ImageGrid images={moment.images} onOpen={(index) => onOpenImage(moment.images, index)} />
          </div>
        ) : null}

        {hasVideo ? (
          <div className="moment__media">
            <VideoPlayer src={moment.videos[0] ?? ''} cover={moment.cover || moment.images[0] || ''} />
          </div>
        ) : null}

        {moment.topics.length > 0 ? (
          <div className="moment__topics">
            <TopicList topics={moment.topics} />
          </div>
        ) : null}

        <footer className="moment__foot">
          <button
            type="button"
            className="moment__action"
            data-on={moment.likedByMe}
            onClick={() => onLike(moment)}
            disabled={liking}
            aria-pressed={moment.likedByMe}
          >
            <IconLike
              size={15}
              {...(moment.likedByMe ? { fill: 'currentColor', strokeWidth: 1.2 } : {})}
            />
            <span>{moment.likedByMe ? '已赞' : '点赞'}</span>
            {moment.likeTotal > 0 ? (
              <span className="moment__count num">{moment.likeTotal}</span>
            ) : null}
          </button>

          <button
            type="button"
            className="moment__action"
            onClick={() =>
              expanded ? onReply(moment, moment.comments[moment.comments.length - 1] as CommentView) : onOpenDetail(moment)
            }
          >
            <IconComment size={15} />
            <span>评论</span>
            {moment.commentsTotalCount > 0 ? (
              <span className="moment__count num">{moment.commentsTotalCount}</span>
            ) : null}
          </button>
        </footer>

        {moment.comments.length > 0 ? (
          <div className="moment__comments">
            {hiddenCount > 0 && !expanded ? (
              <button type="button" className="moment__allcomments" onClick={() => onOpenDetail(moment)}>
                查看全部 {moment.commentsTotalCount} 条评论
              </button>
            ) : null}
            <CommentList comments={previewComments} onReply={(c) => onReply(moment, c)} onDelete={onDeleteComment} />
          </div>
        ) : null}
      </div>
    </article>
  )
}
