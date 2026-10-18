/**
 * 话题选择器。
 *
 * 上限来自服务端 `config.maxTopicCount`（默认 2），不是硬编码 —— 后台改了
 * 这里就跟着变。选中的话题显示在下方的输入框里，可以直接改文字，
 * 匹配不到推荐话题的会作为用户自建话题提交。
 */

import { useEffect, useMemo, useState } from 'react'
import type { TopicListResult, TopicView } from '@shared/types'
import { call, bridge, errorText } from '../api'
import './composer.css'

interface TopicPickerProps {
  selected: string[]
  onChange: (topics: string[]) => void
}

export default function TopicPicker({ selected, onChange }: TopicPickerProps) {
  const [data, setData] = useState<TopicListResult | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let alive = true
    call(bridge.topics())
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((cause) => {
        if (alive) setError(errorText(cause))
      })
    return () => {
      alive = false
    }
  }, [])

  const max = data?.config.maxTopicCount ?? 2
  const maxLength = data?.config.topicNameMaxLength ?? 12

  /** 推荐列表里最常用的几个：官方优先，再按服务端排序。 */
  const suggestions = useMemo(() => {
    const list = data?.topics ?? []
    return list.slice(0, 14)
  }, [data])

  const atLimit = selected.length >= max

  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((item) => item !== name))
      return
    }
    if (atLimit) return
    onChange([...selected, name])
  }

  function addDraft() {
    const name = draft.replace(/[（）()#]/g, '').trim().slice(0, maxLength)
    if (!name) return
    if (selected.includes(name) || atLimit) {
      setDraft('')
      return
    }
    onChange([...selected, name])
    setDraft('')
  }

  return (
    <div className="picker">
      <div className="picker__head">
        <span className="label">话题</span>
        <span className="num">
          {selected.length} / {max}
        </span>
      </div>

      {error ? <p className="picker__error">{error}</p> : null}

      {suggestions.length > 0 ? (
        <div className="picker__chips">
          {suggestions.map((topic: TopicView) => {
            const on = selected.includes(topic.name)
            return (
              <button
                key={topic.name}
                type="button"
                className="picker__chip"
                data-on={on}
                disabled={!on && atLimit}
                onClick={() => toggle(topic.name)}
              >
                {topic.name}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="picker__input">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addDraft()
            }
          }}
          placeholder={atLimit ? `最多 ${max} 个话题` : '输入自定义话题后回车'}
          maxLength={maxLength}
          disabled={atLimit}
        />
        <button type="button" className="textbtn" onClick={addDraft} disabled={atLimit || !draft.trim()}>
          添加
        </button>
      </div>
    </div>
  )
}
