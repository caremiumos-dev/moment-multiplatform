/**
 * 动态流。
 *
 * 翻页靠 `end` 游标往回推时间。服务端是 `createTime <= end`，同一秒发的
 * 多条会重复返回，所以这里按 momentId 去重；如果一整页都没带来新内容、
 * 游标也没推进，就直接停住，避免死循环。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountStatus, MomentView } from '@shared/types'
import { bridge, call, errorText, MomentError } from '../api'
import Composer from '../components/Composer'
import MomentCard from '../components/MomentCard'
import { IconChevron } from '../components/icons'
import './feed.css'

interface FeedPageProps {
  account: AccountStatus
  onOpenImage: (images: string[], index: number) => void
  onOpenDetail: (moment: MomentView) => void
  onAuthLost: () => void
}

export default function FeedPage({ account, onOpenImage, onOpenDetail, onAuthLost }: FeedPageProps) {
  const [moments, setMoments] = useState<MomentView[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [liking, setLiking] = useState<string | null>(null)

  /** 已经出现过的 momentId，翻页去重用。 */
  const seen = useRef(new Set<string>())

  const load = useCallback(
    async (mode: 'reset' | 'more') => {
      if (mode === 'reset') {
        setLoading(true)
        setError('')
      } else {
        setLoadingMore(true)
      }

      try {
        const page = await call(bridge.feedList(mode === 'more' && cursor ? { end: cursor } : {}))
        setTotal(page.total)

        if (mode === 'reset') {
          seen.current = new Set(page.moments.map((moment) => moment.momentId))
          setMoments(page.moments)
        } else {
          const fresh = page.moments.filter((moment) => !seen.current.has(moment.momentId))
          fresh.forEach((moment) => seen.current.add(moment.momentId))
          setMoments((previous) => [...previous, ...fresh])
        }

        // 游标没推进（同秒太多）就认为到底了。
        const next = page.nextEnd
        if (next === null || (mode === 'more' && next === cursor)) {
          setCursor(null)
        } else {
          setCursor(next)
        }
      } catch (cause) {
        if (cause instanceof MomentError && cause.isAuthError) {
          onAuthLost()
          return
        }
        setError(errorText(cause))
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [cursor, onAuthLost],
  )

  useEffect(() => {
    void load('reset')
    // 只在挂载时拉第一页；后续翻页由按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 点赞：先改本地，失败再回滚 —— 点一下要立刻有反应。 */
  async function toggleLike(moment: MomentView) {
    if (liking) return
    const nextLiked = !moment.likedByMe
    setLiking(moment.momentId)
    setMoments((previous) =>
      previous.map((item) =>
        item.momentId === moment.momentId
          ? {
              ...item,
              likedByMe: nextLiked,
              likeTotal: Math.max(0, item.likeTotal + (nextLiked ? 1 : -1)),
            }
          : item,
      ),
    )
    try {
      const result = await call(
        bridge.momentLike({
          momentId: moment.momentId,
          momentAuthorWatchId: moment.authorWatchId,
          liked: nextLiked,
        }),
      )
      setMoments((previous) =>
        previous.map((item) =>
          item.momentId === moment.momentId
            ? { ...item, likedByMe: result.liked, likeTotal: result.likeTotal }
            : item,
        ),
      )
    } catch (cause) {
      // 回滚到点击前的状态。
      setMoments((previous) =>
        previous.map((item) =>
          item.momentId === moment.momentId
            ? { ...item, likedByMe: moment.likedByMe, likeTotal: moment.likeTotal }
            : item,
        ),
      )
      setError(errorText(cause))
    } finally {
      setLiking(null)
    }
  }

  async function deleteMoment(moment: MomentView) {
    try {
      await call(bridge.momentDelete({ momentId: moment.momentId }))
      seen.current.delete(moment.momentId)
      setMoments((previous) => previous.filter((item) => item.momentId !== moment.momentId))
      setTotal((previous) => Math.max(0, previous - 1))
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  async function deleteComment(commentId: string) {
    try {
      await call(bridge.commentDelete({ commentId }))
      setMoments((previous) =>
        previous.map((item) => ({
          ...item,
          comments: item.comments.filter((each) => each.commentId !== commentId),
          commentsTotalCount: Math.max(
            0,
            item.commentsTotalCount - (item.comments.some((each) => each.commentId === commentId) ? 1 : 0),
          ),
        })),
      )
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  const visible = onlyMine ? moments.filter((moment) => moment.isMine) : moments
  const mineCount = moments.filter((moment) => moment.isMine).length
  /**
   * 「全部」用的是服务端总数，而「我发的」只能数已加载的部分 ——
   * 服务端 `/moment/search` 会忽略 watchId，没有「按作者计数」的接口。
   * 还有更早的没加载时给数字加个 `+`，免得看起来像准确值。
   */
  const minePartial = cursor !== null

  return (
    <div className="feed">
      <header className="feed__head">
        <h1 className="feed__title">动态</h1>
        <div className="feed__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="feed__tab"
            data-on={!onlyMine}
            aria-selected={!onlyMine}
            onClick={() => setOnlyMine(false)}
          >
            全部
            <span className="num">{total}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="feed__tab"
            data-on={onlyMine}
            aria-selected={onlyMine}
            onClick={() => setOnlyMine(true)}
            title={minePartial ? '还有更早的动态没加载，这个数字只统计已加载的部分' : undefined}
          >
            我发的
            <span className="num">
              {mineCount}
              {minePartial ? '+' : ''}
            </span>
          </button>
        </div>
      </header>

      <Composer
        onPublished={(moment) => {
          // 我在哪儿就插到哪儿：按时间比较，插到第一条比它旧的动态前面。
          seen.current.add(moment.momentId)
          setMoments((previous) => {
            const index = previous.findIndex((item) => item.createTime < moment.createTime)
            if (index === -1) return [...previous, moment]
            return [...previous.slice(0, index), moment, ...previous.slice(index)]
          })
          setTotal((previous) => previous + 1)
        }}
      />

      {error ? (
        <div className="feed__error">
          <p>{error}</p>
          <button type="button" className="textbtn" onClick={() => void load('reset')}>
            重试
          </button>
          <button type="button" className="textbtn" onClick={() => setError('')}>
            知道了
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="feed__skeleton" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton">
              <span className="skeleton__avatar" />
              <span className="skeleton__line" style={{ width: `${48 - index * 8}%` }} />
              <span className="skeleton__line" style={{ width: `${86 - index * 6}%` }} />
            </div>
          ))}
          <p className="feed__loading-text">正在取动态…</p>
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <div className="feed__empty">
          <p className="feed__empty-title">{onlyMine ? '你还没发过动态' : '这里还很安静'}</p>
          <p className="feed__empty-sub">
            {onlyMine ? '切回「全部」看看大家，或者在上面写下第一条。' : '发第一条动态，它也会出现在手表的屏幕上。'}
          </p>
        </div>
      ) : null}

      <div className="feed__list">
        {visible.map((moment) => (
          <MomentCard
            key={moment.momentId}
            moment={moment}
            onOpenImage={onOpenImage}
            onLike={toggleLike}
            onDelete={deleteMoment}
            onReply={(target) => onOpenDetail(target)}
            onDeleteComment={(comment) => void deleteComment(comment.commentId)}
            onOpenDetail={onOpenDetail}
            liking={liking === moment.momentId}
          />
        ))}
      </div>

      {/* 「我发的」也允许继续加载：服务端不做作者过滤，只能多拉一些再在前端筛。 */}
      {!loading && cursor !== null ? (
        <div className="feed__more">
          <button
            type="button"
            className="textbtn"
            onClick={() => void load('more')}
            disabled={loadingMore}
          >
            {loadingMore ? '正在取…' : '继续往下看'}
            {!loadingMore ? <IconChevron size={13} /> : null}
          </button>
        </div>
      ) : null}

      {!loading && cursor === null && visible.length > 0 ? (
        <p className="feed__end num">已经到底了 · {account.displayName || account.watchId}</p>
      ) : null}
    </div>
  )
}
