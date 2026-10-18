/**
 * 动态列表与详情。
 *
 * ## 为什么是「翻页」而不是「滚动」
 *
 * 图片要走 ink 的 `<Static>` 区（否则每帧重绘就被擦掉，见 inline-image.tsx）。
 * 而 Static 区的内容是**只追加、不回滚**的 —— 逐条滚动会把整页内容反复追加，
 * 屏幕上堆出一长串历史。
 *
 * 所以列表按「一页」组织：一屏内的动态一次成型写进 Static，
 * 用户翻页时整页替换。这也更符合 doge-code / 腕表端那种「一屏一张卡片」的气质。
 *
 * 设计语言沿用 doge-code：不画框，靠缩进和一根竖线区分层级，
 * 元信息用中点连接。
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { CommentView, MomentView } from '../../src/shared/types.js'
import { Byline, Divider, StatusMark, truncate, useColumns } from './primitives.js'
import { formatRelative } from './time.js'
import { THUMB_COLUMNS } from './inline-image.js'
import type { LoadedImage } from './use-images.js'

/** 一条动态在静态区里的完整渲染（含缩略图）。 */
export function MomentBlock({
  moment,
  index,
  selected = false,
}: {
  moment: MomentView
  index: number
  thumbnail?: LoadedImage | null
  /** 是否是当前选中项。选中项左侧有一根竖线，文字提亮。 */
  selected?: boolean
}): React.ReactElement {
  const columns = useColumns()
  const text = moment.text.replace(/\s+/g, ' ').trim()
  const hasMedia = moment.images.length > 0 || moment.videos.length > 0

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {/* 选中项用左侧竖线标记，比反色块轻得多。 */}
        <Box width={2}>
          <Text color="cyan">{selected ? '▎' : ''}</Text>
        </Box>
        <Text color="gray">{String(index).padStart(2)}</Text>
        <Text> </Text>
        <Text bold color={selected ? 'white' : 'gray'}>
          {truncate(moment.authorName, 16)}
        </Text>
        <Text color="gray"> · {formatRelative(moment.createTime)}</Text>
        {moment.videos.length > 0 ? <Text color="cyan"> · 视频</Text> : null}
        {moment.images.length > 1 ? <Text color="cyan"> · {moment.images.length} 图</Text> : null}
      </Box>

      <Box paddingLeft={5} flexDirection="column">
        <Text color={selected ? 'white' : 'gray'}>
          {truncate(text || '（无正文）', columns - 6)}
        </Text>

        {hasMedia ? (
          <Box marginTop={0} flexDirection="column">
            <Text color="gray">
              {moment.videos.length > 0 ? '[视频]' : '[图片]'}
            </Text>
          </Box>
        ) : null}

        <Box>
          <Text color="gray">
            {moment.likedByMe ? '♥' : '♡'} {moment.likeTotal}
            {moment.commentsTotalCount > 0 ? `  ${moment.commentsTotalCount} 评论` : ''}
          </Text>
          {moment.topics.length > 0 ? (
            <Text color="cyan">
              {'  '}
              {moment.topics
                .slice(0, 2)
                .map((t) => `#${t.name}`)
                .join(' ')}
            </Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  )
}

/** 详情页：正文 + 全部图片 + 评论（静态区一次成型）。 */
export function MomentDetail({
  moment,
  comments,
  images,
  imagesEnabled,
}: {
  moment: MomentView
  comments: CommentView[]
  images: Map<string, LoadedImage | null>
  imagesEnabled: boolean
}): React.ReactElement {
  const columns = useColumns()
  const media = moment.videos.length > 0 ? [moment.cover].filter(Boolean) : moment.images

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">▎</Text>
        <Text bold color="white">
          {' '}
          {moment.authorName}
        </Text>
        <Text color="gray"> · {formatRelative(moment.createTime)}</Text>
      </Box>

      <Box paddingLeft={3} marginTop={1} flexDirection="column">
        {moment.text ? (
          <Text color="white">{moment.text}</Text>
        ) : (
          <Text color="gray">（无正文）</Text>
        )}
      </Box>

      {media.length > 0 ? (
        <Box paddingLeft={3} marginTop={1} flexDirection="column">
          {media.map((url) => {
            if (!imagesEnabled) {
              return (
                <Text key={url} color="gray">
                  [图片]
                </Text>
              )
            }
            const image = images.get(url)
            if (!image) {
              return (
                <Text key={url} color="gray">
                  （图片加载中…）
                </Text>
              )
            }
            return <Text key={url} color="gray">（图片见下方预览）</Text>
          })}
        </Box>
      ) : null}

      {moment.topics.length > 0 ? (
        <Box paddingLeft={3} marginTop={1}>
          <Text color="cyan">{moment.topics.map((t) => `#${t.name}`).join('  ')}</Text>
        </Box>
      ) : null}

      <Box paddingLeft={3} marginTop={1}>
        <Byline>
          <Text color="gray">
            {moment.likedByMe ? '♥' : '♡'} {moment.likeTotal}
          </Text>
          <Text color="gray">{moment.commentsTotalCount} 条评论</Text>
          {moment.location ? <Text color="gray">{moment.location}</Text> : null}
        </Byline>
      </Box>

      <Box paddingLeft={3} marginTop={1}>
        <Divider width={Math.min(columns - 6, 56)} />
      </Box>

      <Box paddingLeft={3} flexDirection="column" marginTop={1}>
        {comments.length === 0 ? (
          <Text color="gray">还没有评论</Text>
        ) : (
          comments.map((comment) => (
            <Box key={comment.commentId} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color="white">{truncate(comment.authorName, 14)}</Text>
                {comment.replyTo ? (
                  <Text color="gray">
                    {' '}
                    回复 <Text color="cyan">{truncate(comment.replyTo.name, 12)}</Text>
                  </Text>
                ) : null}
                <Text color="gray"> · {formatRelative(comment.createTime)}</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color="gray">{truncate(comment.text, columns - 8)}</Text>
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}

export { THUMB_COLUMNS, StatusMark }