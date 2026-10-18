/**
 * 话题标签。
 *
 * 手表端的话题是「（话题名）」，颜色由后台配。但默认配色是 `#FFFFFFCC`
 * —— 近全透明白，那是给黑色表盘设计的，直接搬到米白纸面上等于隐形。
 * 所以：主进程已经把不可用的颜色剔掉了（见 `isUsableOnLight`），
 * 剩下的颜色只用来决定标签的「墨色深浅」，底色永远是纸色。
 */

import type { TopicView } from '@shared/types'
import './topics.css'

interface TopicListProps {
  topics: TopicView[]
  onPick?: (name: string) => void
}

export default function TopicList({ topics, onPick }: TopicListProps) {
  if (topics.length === 0) return null

  return (
    <ul className="topics">
      {topics.map((topic) => {
        const content = (
          <>
            <span className="topics__hash">#</span>
            {topic.name}
          </>
        )
        return (
          <li key={topic.name} className="topics__item">
            {onPick ? (
              <button
                type="button"
                className="topics__tag"
                data-official={topic.knowledgeKind === 0}
                onClick={() => onPick(topic.name)}
              >
                {content}
              </button>
            ) : (
              <span className="topics__tag" data-official={topic.knowledgeKind === 0}>
                {content}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
