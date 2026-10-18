/**
 * 动态详情。
 *
 * 服务端没有「按 id 查一条」，SDK 只能从头翻页扫描，所以这里会明确告诉
 * 用户「正在翻找」，而不是让人对着空白页猜。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommentView, MomentView } from '@shared/types'
import { bridge, call, errorText, MomentError } from '../api'
import Avatar from '../components/Avatar'
import CommentList from '../components/CommentList'
import ImageGrid from '../components/ImageGrid'
import VideoPlayer from '../components/VideoPlayer'
import TopicList from '../components/TopicList'
import { IconBack, IconClose, IconComment, IconLike, IconPin } from '../components/icons'
import { formatFullTime } from '../lib/format'
import './detail.css'

interface DetailPageProps {
  momentId: string
  onBack: () => void
  onOpenImage: (images: string[], index: number) => void
  onAuthLost: () => void
}

const PAGE_SIZE = 20

export default function DetailPage({
  momentId,
  onBack,
  onOpenImage,
  onAuthLost,
}: DetailPageProps) {
  const [moment, setMoment] = useState<MomentView | null>(null)
  const [comments, setComments] = useState<CommentView[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPage, setTotalPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<CommentView | null>(null)
  const [sending, setSending] = useState(false)
  const [liking, setLiking] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof MomentError && cause.isAuthError) {
        onAuthLost()
        return
      }
      setError(errorText(cause))
    },
    [onAuthLost],
  )

  /** 只加载这一条和第一页评论。 */
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')

    void (async () => {
      try {
        const found = await call(bridge.momentGet(momentId))
        if (!alive) return
        setMoment(found)
        setTotalCount(found.commentsTotalCount)
        // 列表接口已经带了最新一页评论，够用时就不再打一次评论接口。
        if (found.comments.length >= found.commentsTotalCount || found.comments.length >= PAGE_SIZE) {
          setComments(found.comments)
          setTotalPage(Math.max(1, Math.ceil(found.commentsTotalCount / PAGE_SIZE)))
        } else {
          const result = await call(
            bridge.commentList({ momentId, pageNum: 1, pageSize: PAGE_SIZE }),
          )
          if (!alive) return
          setComments(result.comments)
          setTotalCount(result.totalCount)
          setTotalPage(result.totalPage)
        }
      } catch (cause) {
        if (alive) handleError(cause)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [momentId, handleError])

  async function loadMoreComments() {
    const next = page + 1
    try {
      const result = await call(bridge.commentList({ momentId, pageNum: next, pageSize: PAGE_SIZE }))
      setPage(next)
      setTotalCount(result.totalCount)
      setTotalPage(result.totalPage)
      setComments((previous) => {
        const ids = new Set(previous.map((comment) => comment.commentId))
        return [...previous, ...result.comments.filter((comment) => !ids.has(comment.commentId))]
      })
    } catch (cause) {
      handleError(cause)
    }
  }

  async function toggleLike() {
    if (!moment || liking) return
    const nextLiked = !moment.likedByMe
    setLiking(true)
    setMoment({
      ...moment,
      likedByMe: nextLiked,
      likeTotal: Math.max(0, moment.likeTotal + (nextLiked ? 1 : -1)),
    })
    try {
      const result = await call(
        bridge.momentLike({
          momentId: moment.momentId,
          momentAuthorWatchId: moment.authorWatchId,
          liked: nextLiked,
        }),
      )
      setMoment((previous) =>
        previous ? { ...previous, likedByMe: result.liked, likeTotal: result.likeTotal } : previous,
      )
    } catch (cause) {
      setMoment((previous) =>
        previous ? { ...previous, likedByMe: moment.likedByMe, likeTotal: moment.likeTotal } : previous,
      )
      handleError(cause)
    } finally {
      setLiking(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || !moment || sending) return
    setSending(true)
    try {
      const created = await call(
        bridge.commentCreate({
          momentId: moment.momentId,
          momentAuthorWatchId: moment.authorWatchId,
          text,
          ...(replyTo ? { replyToWatchId: replyTo.authorWatchId } : {}),
        }),
      )
      setComments((previous) => [...previous, created])
      setTotalCount((previous) => previous + 1)
      setDraft('')
      setReplyTo(null)
    } catch (cause) {
      handleError(cause)
    } finally {
      setSending(false)
    }
  }

  async function removeComment(comment: CommentView) {
    try {
      await call(bridge.commentDelete({ commentId: comment.commentId }))
      setComments((previous) => previous.filter((each) => each.commentId !== comment.commentId))
      setTotalCount((previous) => Math.max(0, previous - 1))
    } catch (cause) {
      handleError(cause)
    }
  }

  function startReply(comment: CommentView) {
    setReplyTo(comment)
    inputRef.current?.focus()
  }

  if (loading) {
    return (
      <div className="detail">
        <BackBar onBack={onBack} />
        <p className="detail__loading">正在翻找这条动态…</p>
        <p className="detail__loading-sub">
          服务端不支持按 id 直接取，只能从最新一条往前扫，动态多的时候会慢一点。
        </p>
      </div>
    )
  }

  if (!moment) {
    return (
      <div className="detail">
        <BackBar onBack={onBack} />
        <div className="detail__empty">
          <p className="detail__empty-title">看不到这条动态</p>
          <p className="detail__empty-sub">{error || '它可能已经被作者删除。'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="detail">
      <BackBar onBack={onBack} />

      {error ? (
        <div className="detail__error">
          <p>{error}</p>
          <button type="button" className="textbtn" onClick={() => setError('')}>
            知道了
          </button>
        </div>
      ) : null}

      <article className="detail__moment">
        <header className="detail__head">
          <Avatar src={moment.authorAvatar} name={moment.authorName} size={40} />
          <div className="detail__who">
            <span className="detail__author">{moment.authorName}</span>
            <span className="num">{formatFullTime(moment.createTime)}</span>
          </div>
          {moment.location ? (
            <span className="detail__place">
              <IconPin size={12} />
              {moment.location}
            </span>
          ) : null}
        </header>

        {moment.text.trim() ? <p className="detail__text read">{moment.text}</p> : null}

        {moment.images.length > 0 && moment.videos.length === 0 ? (
          <div className="detail__media">
            <ImageGrid images={moment.images} onOpen={(index) => onOpenImage(moment.images, index)} />
          </div>
        ) : null}

        {moment.videos.length > 0 ? (
          <div className="detail__media">
            <VideoPlayer src={moment.videos[0] ?? ''} cover={moment.cover || moment.images[0] || ''} />
          </div>
        ) : null}

        {moment.topics.length > 0 ? (
          <div className="detail__topics">
            <TopicList topics={moment.topics} />
          </div>
        ) : null}

        <footer className="detail__actions">
          <button
            type="button"
            className="moment__action"
            data-on={moment.likedByMe}
            onClick={toggleLike}
            disabled={liking}
            aria-pressed={moment.likedByMe}
          >
            <IconLike size={15} {...(moment.likedByMe ? { fill: 'currentColor', strokeWidth: 1.2 } : {})} />
            <span>{moment.likedByMe ? '已赞' : '点赞'}</span>
            {moment.likeTotal > 0 ? <span className="moment__count num">{moment.likeTotal}</span> : null}
          </button>
          <span className="moment__action" style={{ cursor: 'default' }}>
            <IconComment size={15} />
            <span>评论</span>
            {totalCount > 0 ? <span className="moment__count num">{totalCount}</span> : null}
          </span>
        </footer>
      </article>

      <section className="detail__comments">
        <div className="detail__comments-head">
          <span className="label">评论</span>
          <span className="num">{totalCount}</span>
        </div>

        {comments.length === 0 ? (
          <p className="detail__nocomments">还没有人说话。第一句留给你。</p>
        ) : (
          <CommentList comments={comments} onReply={startReply} onDelete={(c) => void removeComment(c)} />
        )}

        {page < totalPage ? (
          <button type="button" className="detail__morecomments textbtn" onClick={() => void loadMoreComments()}>
            还有 {totalCount - comments.length} 条
          </button>
        ) : null}
      </section>

      <form
        className="cform detail__form"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {replyTo ? (
          <div className="cform__reply">
            <span>
              回复 <span className="comment__name">{replyTo.authorName}</span>
            </span>
            <button
              type="button"
              className="textbtn"
              onClick={() => setReplyTo(null)}
              aria-label="取消回复"
            >
              <IconClose size={12} />
            </button>
          </div>
        ) : null}
        <div className="cform__row">
          <input
            ref={inputRef}
            className="cform__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={replyTo ? `回复 ${replyTo.authorName}` : '写条评论'}
            maxLength={500}
            disabled={sending}
          />
          <button type="submit" className="btn" disabled={!draft.trim() || sending}>
            {sending ? '发送中' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="detail__back" onClick={onBack}>
      <IconBack size={15} />
      <span>返回</span>
    </button>
  )
}
