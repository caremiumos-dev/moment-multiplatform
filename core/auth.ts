/**
 * 用户名密码登录。
 *
 * 这条接口 SDK 没有封装：`POST /moment/auth/login`，body 是
 * `{ username, password }`，返回 `{ token, watchId, watchName, expiresAt }`。
 * token 是服务端签发的可撤销令牌（默认 30 天）。
 *
 * 关键点：SDK 只会往 `Base-Request-Param` 里塞 `watchId + chipId`，不会发 `authId` 头。
 * 好在服务端的鉴权顺序是「账号**未绑定** chipId 时，请求头里的 chipId 留空也放行」，
 * 所以密码登录后 `new MomentClient({ chipId: '' })` 就能正常调所有接口。
 * 若该账号在后台绑定了 chipId，服务端会返回 `000016`，这时只能走 chip 模式
 * （界面会把这条错误翻译成明确的提示）。
 *
 * 登录请求复用 SDK 的 `Transport`：信封拆解、超时、错误码都是现成的，
 * 没必要为一个接口重写一遍 HTTP 层。
 */

import {
  Transport,
  MomentApiError,
  ERROR_CODES,
  type TransportOptions,
} from '@caremiumos-dev/node-moment-sdk'
import type { Credential } from './credential.js'
import { createClient } from './moment.js'

interface LoginResponse {
  token: string
  watchId: string
  watchName?: string
  expiresAt?: number
}

export interface PasswordLoginResult {
  credential: Credential
  displayName: string
}

const TIMEOUT_MS = 20_000

/** 登录接口不需要身份，但 `Transport` 的构造签名要求这两个字段，给空串即可。 */
function anonymousTransport(baseUrl: string): Transport {
  const options: TransportOptions = {
    baseUrl,
    watchId: '',
    chipId: '',
    deviceId: 'moment-web',
    timeoutMs: TIMEOUT_MS,
  }
  return new Transport(options)
}

/** 用用户名密码换取令牌。 */
export async function loginWithPassword(input: {
  baseUrl: string
  username: string
  password: string
}): Promise<PasswordLoginResult> {
  const data = await anonymousTransport(input.baseUrl).post<LoginResponse>('/moment/auth/login', {
    username: input.username,
    password: input.password,
    deviceId: 'moment-web',
  })

  if (!data || typeof data.token !== 'string' || !data.token) {
    throw new MomentApiError(ERROR_CODES.invalidParam, '登录响应里没有令牌')
  }
  if (typeof data.watchId !== 'string' || !data.watchId) {
    throw new MomentApiError(ERROR_CODES.tokenExpired, '登录响应里没有 watchId')
  }

  return {
    credential: {
      mode: 'password',
      baseUrl: input.baseUrl,
      watchId: data.watchId,
      chipId: '',
      authToken: data.token,
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    },
    displayName: data.watchName || data.watchId,
  }
}

/**
 * 退出时撤销令牌。
 *
 * 服务端从 `authId` 头取令牌，而 SDK 的 `Transport` 没有开放自定义请求头，
 * 于是这里直接用原生 fetch —— 就一个请求，不值得为它去改造 SDK 的传输层。
 * 失败不影响本地退出：令牌本身也会到期。
 */
export async function revokeToken(baseUrl: string, token: string): Promise<void> {
  if (!token) return
  try {
    await fetch(`${baseUrl.replace(/\/+$/, '')}/moment/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authId: token },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    // 撤销失败不该阻断本地退出。
  }
}

/**
 * 判定密码模式下这个账号能不能用。
 *
 * 服务端规则（`app/api_common.py` 的 `authenticate`）：
 * - 账号**未绑定** chipId → 头里的 chipId 随便，留空也放行；
 * - 账号**已绑定** chipId → 头里的 chipId 必须等于库里的值，否则 `000016`。
 *
 * 所以这里用「空 chipId 打一次只读接口」来探测：通了说明没绑定，
 * 密码模式可以直接用；返回 000016 说明绑过了，需要 chipId。
 */
export type ProbeResult = 'unbound' | 'bindauth-required' | 'other-error'

export async function probeBinding(cred: Credential): Promise<ProbeResult> {
  try {
    await createClient(cred).listMoments({ size: 1 })
    return 'unbound'
  } catch (error) {
    if (error instanceof MomentApiError) {
      if (error.code === ERROR_CODES.authFailed) return 'bindauth-required'
      // 000003 说明令牌整体不可用，按「其他错误」往上抛，让上层统一处理。
      throw error
    }
    throw error
  }
}
