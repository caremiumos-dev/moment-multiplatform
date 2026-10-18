/**
 * 时间格式化。
 *
 * 终端里空间有限，时间一律用相对说法：`3 分钟前`、`昨天`、`10-18`。
 * 超过一周就直接给日期 —— 「8 天前」这种读起来还要掰手指换算。
 */

export function formatRelative(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (!Number.isFinite(diff)) return ''
  if (diff < 0) return '刚刚'

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  const currentYear = new Date().getFullYear()
  return date.getFullYear() === currentYear
    ? `${month}-${dayOfMonth}`
    : `${date.getFullYear()}-${month}-${dayOfMonth}`
}

/** 把毫秒格式化成 `m:ss`，给视频进度用。 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
