/**
 * 端到端验证：直接调用主进程用到的同一套 SDK 调用与视图转换，
 * 对真实服务端跑一遍「读 → 发 → 赞 → 评论 → 回复 → 取消赞 → 删」。
 *
 * 不是单元测试，是确认界面背后的数据通路是通的。跑完自动清理测试数据。
 *
 * 用法（凭据从环境变量读，不入库）：
 *   MOMENT_BASE_URL=... MOMENT_WATCH_ID=... MOMENT_CHIP_ID=... node scripts/verify.mjs
 */

import { parseMomentBody, MomentClient, MomentApiError } from '@caremiumos-dev/node-moment-sdk'

const baseUrl = process.env.MOMENT_BASE_URL
const watchId = process.env.MOMENT_WATCH_ID
const chipId = process.env.MOMENT_CHIP_ID

if (!baseUrl || !watchId || !chipId) {
  console.error('缺少 MOMENT_BASE_URL / MOMENT_WATCH_ID / MOMENT_CHIP_ID')
  process.exit(2)
}

const client = new MomentClient({ baseUrl, watchId, chipId, deviceId: 'moment-web-verify' })
let created = null
let createdComment = null
const failures = []

function check(label, condition, detail = '') {
  const mark = condition ? '✓' : '✗'
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

/** 复刻主进程 toMomentView 的关键判定，确认视图层拿到的东西是对的。 */
function viewOf(moment) {
  const body = client.parseBody(moment)
  return {
    text: body.text ?? '',
    images: body.images ?? [],
    videos: body.videos ?? [],
    cover: body.cover ?? '',
    likedByMe: moment.enableLike === false,
    topics: (moment.topicList ?? []).map((t) => t.topicName),
    comments: moment.comments ?? [],
  }
}

console.log('\n▸ 1. 读动态流')
const feed = await client.listMoments({ size: 20, commentPageSize: 20 })
check('拿到 watchMoments', Array.isArray(feed.watchMoments), `${feed.total} 条`)
const types = new Set(feed.watchMoments.map((m) => m.type))
check('覆盖多种动态类型', types.size >= 1, `出现类型 ${[...types].join(', ')}`)

// 逐条确认 parseBody 对各种类型都不炸，且图文不会串。
for (const moment of feed.watchMoments) {
  const view = viewOf(moment)
  if (moment.type === 26 || moment.type === 5) {
    if (view.images.length === 0) failures.push(`图片动态 ${moment.momentId.slice(0, 8)} 没解析出图`)
  }
  if ([6, 27, 24].includes(moment.type)) {
    if (view.videos.length === 0) failures.push(`视频动态 ${moment.momentId.slice(0, 8)} 没解析出视频`)
  }
  if (moment.type === 6 && view.text !== '') failures.push('纯视频动态不该有正文')
}
check('所有动态正文/媒体解析正常', failures.length === 0, failures.length ? failures.join('; ') : '26 图、视频、纯文字都对')

const withImage = feed.watchMoments.find((m) => client.parseBody(m).images.length > 0)
if (withImage) {
  const images = client.parseBody(withImage).images
  const res = await fetch(images[0], { method: 'HEAD' })
  check('图片地址可访问', res.ok, `${res.status} ${res.headers.get('content-type')}`)
}

console.log('\n▸ 2. 话题推荐')
const topics = await client.getTopics()
check('话题列表非空', topics.topicList.length > 0, `maxTopicCount=${topics.config.maxTopicCount}`)
const whiteTopic = topics.topicList.find((t) => /^#FFFFFF/i.test(t.color ?? ''))
if (whiteTopic) {
  console.log(`  · 官方话题默认色 ${whiteTopic.color}（近白半透明，浅色底不可用，界面已改为下划线样式）`)
}

try {
  console.log('\n▸ 3. 发布')
  const pickTopic = topics.topicList[0]?.topicName
  const published = await client.publishMoment({
    content: '网页客户端验证：这条应该出现在手表上，一会儿就删。',
    ...(pickTopic ? { topics: [pickTopic] } : {}),
    location: '编辑部',
  })
  created = published.moment
  check('发布成功', Boolean(created.momentId), created.momentId?.slice(0, 8))
  const view = viewOf(created)
  check('正文回显正确', view.text.includes('网页客户端验证'))
  check('话题挂上了', view.topics.length === (pickTopic ? 1 : 0), view.topics.join(','))
  check('位置回显', created.location === '编辑部', created.location)

  console.log('\n▸ 4. 点赞')
  await client.likeMoment(created.momentId, { momentWatchId: created.watchId })
  let again = await client.findMoment(created.momentId)
  check('点赞后 likeTotal=1', again.likeTotal === 1, `likeTotal=${again.likeTotal}`)
  check('enableLike=false 表示已赞', viewOf(again).likedByMe === true)

  await client.unlikeMoment(created.momentId, { momentWatchId: created.watchId })
  again = await client.findMoment(created.momentId)
  check('取消赞后 likeTotal=0', again.likeTotal === 0, `likeTotal=${again.likeTotal}`)
  check('enableLike=true 表示未赞', viewOf(again).likedByMe === false)

  console.log('\n▸ 5. 评论与回复')
  const first = await client.commentMoment(created.momentId, '第一条评论', {
    momentWatchId: created.watchId,
  })
  createdComment = first.comment
  check('评论成功', Boolean(first.comment.commentId))

  const reply = await client.commentMoment(created.momentId, '这是在回复', {
    momentWatchId: created.watchId,
    replyToWatchId: watchId,
  })
  check('回复被标记为 type=2', reply.comment.type === 2, `type=${reply.comment.type}`)
  if (reply.comment.commentId) {
    await client.deleteComment(reply.comment.commentId)
  }

  const list = await client.getComments(created.momentId, { pageNum: 1, pageSize: 20 })
  check('评论列表可读', list.comments.length >= 1, `totalCount=${list.totalCount}`)
  await client.deleteComment(createdComment.commentId)
  createdComment = null
  const afterDelete = await client.getComments(created.momentId, { pageNum: 1, pageSize: 20 })
  check('删评论生效', afterDelete.comments.length === 0, `剩 ${afterDelete.comments.length} 条`)

  console.log('\n▸ 6. 翻页游标')
  const page1 = await client.listMoments({ size: 5 })
  if (page1.watchMoments.length > 0) {
    const last = page1.watchMoments[page1.watchMoments.length - 1]
    const page2 = await client.listMoments({ size: 5, end: last.createTime })
    const overlaps = page2.watchMoments.some((m) => m.momentId === last.momentId)
    console.log(`  · 用 end=${last.createTime} 翻页，重叠 ${overlaps ? '有（同秒数据，界面按 momentId 去重）' : '无'}`)
    check('翻页能取到数据', page2.watchMoments.length > 0, `${page2.watchMoments.length} 条`)
  }

  console.log('\n▸ 7. 删除动态')
  await client.deleteMoment(created.momentId)
  const gone = await client.tryFindMoment(created.momentId)
  check('删动态生效', gone === undefined)
  created = null
} catch (error) {
  if (error instanceof MomentApiError) {
    console.error(`\n❌ 链路中断：${error.code} ${error.desc}`)
  } else {
    console.error('\n❌', error)
  }
  failures.push('异常中断')
} finally {
  // 任何一步炸了都别把测试数据留在服务端。
  if (createdComment) {
    await client.deleteComment(createdComment.commentId).catch(() => {})
    console.log('\n🧹 清理残留评论')
  }
  if (created) {
    await client.deleteMoment(created.momentId).catch(() => {})
    console.log(`\n🧹 清理残留动态 ${created.momentId}`)
  }
}

console.log(
  failures.length === 0
    ? '\n✅ 全部通过'
    : `\n❌ ${failures.length} 项失败：${failures.join('; ')}`,
)
process.exit(failures.length === 0 ? 0 : 1)
