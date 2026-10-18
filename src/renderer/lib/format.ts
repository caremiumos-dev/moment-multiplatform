/**
 * 时间格式化。
 *
 * 不用「3 分钟前」这类相对时间：一条动态被反复刷新时它会跳，
 * 而且读者真正关心的是「哪天几点」。
 */

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * `10月16日 12:04`；跨年的带年份 `2024年10月16日`。
 * 今天与昨天额外标注，但依然保留具体时间。
 */
export function formatTime(millis: number, nowDate: Date = new Date()): string {
  if (!millis || !Number.isFinite(millis)) return ''
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return ''

  const sameYear = date.getFullYear() === nowDate.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`

  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - startOfThat) / 86_400_000)

  if (dayDiff === 0) return `今天 ${time}`
  if (dayDiff === 1) return `昨天 ${time}`
  return sameYear ? `${month}月${day}日 ${time}` : `${date.getFullYear()}年${month}月${day}日`
}

/** 完整的年月日时分，用在详情页与悬停提示。 */
export function formatFullTime(millis: number): string {
  if (!millis) return ''
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
