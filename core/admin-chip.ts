/**
 * 管理员自助读取 chipId。
 *
 * 背景：客户端的 moment API 从不回传 chipId（`users.chip_id` 只在后台可见），
 * 但后台 `/dashboard` 是纯 HTML 表单，管理员会话下能列出所有账号的 chipId。
 *
 * 所以「密码登录 + 账号已绑过 chipId」的用户，如果同时是管理员，可以这样自救：
 * 用同一组用户名密码登录后台会话 → 抓 `/dashboard` 页面 → 解析出自己那行的 chipId。
 *
 * 这条路的取舍很明确：
 * - 只在「密码登录遇到 000016」时才尝试，不作为常规路径；
 * - 只认自己那一行（按 watchId 精确匹配），不碰别人的；
 * - 解析靠正则，后台改版会失效 —— 失败就退回「请手动填 chipId」，不猜；
 * - 用到的 CSRF token 从登录页现取，会话只活在这一次调用里。
 */

import type { Credential } from './credential.js'

/** 这条链路只用到 baseUrl / username / password / watchId，其余字段忽略。 */
type LookupCredential = Pick<Credential, 'baseUrl' | 'watchId'> & {
  username: string
  password: string
}

const TIMEOUT_MS = 12_000

interface Jar {
  get(name: string): string | undefined
  header(): string
  absorb(response: Response): void
}

function createJar(): Jar {
  const store = new Map<string, string>()
  return {
    get: (name) => store.get(name),
    header: () => [...store].map(([key, value]) => `${key}=${value}`).join('; '),
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';')
        if (!pair) continue
        const index = pair.indexOf('=')
        if (index === -1) continue
        store.set(pair.slice(0, index).trim(), pair.slice(index + 1))
      }
    },
  }
}

/** NaN 安全的比较：两个值都非空且相等才算命中。 */
function sameWatchId(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && a.trim() === b.trim()
}

/**
 * 把 dashboard 页面里的一行拆成单元格文本。
 * 后台表格列序固定为：ID / 头像 / 用户名 / watchId / 昵称 / chipId / …
 */
function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
    (match[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  )
}

/**
 * 从 chipId 单元格里取出真正的芯片号。
 *
 * 后台有三种呈现：
 * - 已绑定：直接是 chipId；
 * - 未绑定但有记录：`未绑定（最近 xxx）`；
 * - 从未见过：`未绑定` / `—`。
 */
function extractChipId(cell: string): string | null {
  const bound = cell.match(/未绑定（最近\s*([^）]+)）/)?.[1]
  if (bound) return bound.trim()
  if (cell === '未绑定' || cell === '—' || cell === '-') return null
  return cell || null
}

export interface AdminChipLookup {
  chipId: string
  /** chipId 是「最近用过但尚未绑定」的，界面上可以顺带说明。 */
  unbound: boolean
}

/**
 * 以管理员身份读完自己的 chipId。
 *
 * 返回 null 表示「拿不到」：不是管理员、后台结构变了、或者自己那行没有 chipId。
 * 调用方据此决定是让用户手动填，还是直接放行。
 */
export async function lookupOwnChipId(cred: LookupCredential): Promise<AdminChipLookup | null> {
  const root = cred.baseUrl.replace(/\/+$/, '')
  const jar = createJar()

  try {
    // ① 取登录页，拿 CSRF token 与会话 cookie。
    const loginPage = await fetch(`${root}/login`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    jar.absorb(loginPage)
    const html = await loginPage.text()
    const csrf = html.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1]
    if (!csrf) return null

    // ② 提交管理员登录。非管理员账号会停在登录页（200），管理员是 302 跳 dashboard。
    const form = new URLSearchParams({
      csrf_token: csrf,
      username: cred.username,
      password: cred.password,
    })
    const loginResponse = await fetch(`${root}/login`, {
      method: 'POST',
      body: form,
      headers: { cookie: jar.header() },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    jar.absorb(loginResponse)
    const redirected = loginResponse.status >= 300 && loginResponse.status < 400
    if (!redirected) return null

    // ③ 抓用户列表，按 watchId 找自己。
    const dashboard = await fetch(`${root}/dashboard`, {
      headers: { cookie: jar.header() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!dashboard.ok) return null
    const page = await dashboard.text()

    for (const row of page.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = cellsOf(row[1] ?? '')
      // 列序：ID(0) 头像(1) 用户名(2) watchId(3) 昵称(4) chipId(5)
      if (cells.length < 6) continue
      if (!sameWatchId(cells[3] ?? '', cred.watchId)) continue
      const cell = cells[5] ?? ''
      const chipId = extractChipId(cell)
      if (!chipId) return null
      return { chipId, unbound: cell.includes('未绑定') }
    }
    return null
  } catch {
    // 网络失败、超时、页面结构不符：都当作「拿不到」。
    return null
  }
}
