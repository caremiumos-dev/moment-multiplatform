/**
 * 评论列表。
 *
 * 服务端的回复是「扁平 + 带 replyWatchId」，不是嵌套树，所以这里也不装成树。
 * 一条回复渲染成 `甲 回复 乙：内容`，和手表端看到的一致。
 */

import type { CommentView } from '@shared/types'
import { formatTime } from '../lib/format'
import './comments.css'

interface CommentListProps {
  comments: CommentView[]
  /** 点击某条评论的「回复」。 */
  onReply: (comment: CommentView) => void
  /** 删除；没有权限时不传。 */
  onDelete: (comment: CommentView) => void
}

export default function CommentList({ comments, onReply, onDelete }: CommentListProps) {
  if (comments.length === 0) return null

  return (
    <ul className="comments">
      {comments.map((comment) => (
        <li key={comment.commentId} className="comment">
          <p className="comment__text">
            <button type="button" className="comment__name" onClick={() => onReply(comment)}>
              {comment.authorName}
            </button>
            {comment.replyTo ? (
              <>
                <span className="comment__verb">回复</span>
                <span className="comment__name comment__name--quiet">{comment.replyTo.name}</span>
              </>
            ) : null}
            <span className="comment__colon">：</span>
            <span className="comment__body">{comment.text}</span>
          </p>

          <div className="comment__meta">
            <span className="num">{formatTime(comment.createTime)}</span>
            <button type="button" className="comment__act" onClick={() => onReply(comment)}>
              回复
            </button>
            {comment.canDelete ? (
              <button
                type="button"
                className="comment__act"
                data-tone="danger"
                onClick={() => onDelete(comment)}
              >
                删除
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
