/**
 * 凭据存储（平台无关部分）。
 *
 * 这里只管「怎么序列化、怎么判断过期」，**不负责加密**。
 * 加密由各宿主自己提供：
 * - Electron 用 `safeStorage`（DPAPI / Keychain）；
 * - TUI 用 AES-256-GCM，密钥由机器标识派生（见 `tui/secret-store.ts`）。
 *
 * 之所以拆成两层：Electron 的 `safeStorage` 在 Node 里根本不存在，
 * 但 TUI 和桌面端要读写同一种数据结构。把「形状」放在这里，
 * 「怎么保密」交给宿主，两边就不会各写一套格式。
 */

import type { AuthMode } from '../src/shared/types.js'

export type { AuthMode }

export interface Credential {
  mode: AuthMode
  baseUrl: string
  watchId: string
  /** chip 模式下的设备芯片号；密码模式下为空串。 */
  chipId: string
  /** 密码模式下换到的令牌；chip 模式下为空串。 */
  authToken: string
  /** 令牌过期时间（毫秒）；chip 模式或未知时为 0。 */
  expiresAt: number
}

/** 落盘格式 v2。v1 是旧版 Electron 的 chip-only 格式。 */
export interface StoredV2 {
  v: 2
  mode: AuthMode
  baseUrl: string
  watchId: string
  expiresAt: number
  payload: string
  encrypted: boolean
}

export interface StoredV1 {
  v: 1
  encrypted: boolean
  baseUrl: string
  watchId: string
  payload: string
}

export type StoredCredential = StoredV2 | StoredV1

/**
 * 密码模式下要持久化的秘密。
 *
 * **这里是曾经把「记住登录」弄坏的地方，改之前务必读完。**
 *
 * 一开始密码模式只存了 `authToken`，chipId 没存。看着没问题 —— 登录当场
 * 是用带 chipId 的凭据打的接口，能进主界面。但下次启动从磁盘恢复时，
 * `fromStored` 只能把 chipId 还原成空串，于是：
 *
 * - 账号**没绑**设备：空 chipId 也能过，看起来一切正常；
 * - 账号**绑了**设备：服务端直接 000016，`restoreSession` 判定令牌失效 →
 *   `clearCredential()` → 用户每次开机都要重新登录一遍。
 *
 * 所以密码模式必须存**两样**：令牌（用于退出时撤销）和设备 chipId（鉴权必需）。
 * 两者都属于敏感信息，一起塞进同一个加密载荷里，格式是 JSON。
 */
export function secretOf(cred: Credential): string {
  if (cred.mode === 'chip') return cred.chipId
  return JSON.stringify({ token: cred.authToken, chipId: cred.chipId })
}

/**
 * 解析密码模式的载荷。
 *
 * 兼容旧格式：早期版本存的是**裸令牌字符串**，不是 JSON。
 * 那种记录里没有 chipId，绑定过设备的账号依然恢复不了，
 * 但至少未绑定的账号能继续用，不必强制所有人重新登录。
 */
function parsePasswordSecret(secret: string): { token: string; chipId: string } {
  if (!secret) return { token: '', chipId: '' }
  if (secret.startsWith('{')) {
    try {
      const parsed = JSON.parse(secret) as { token?: unknown; chipId?: unknown }
      return {
        token: typeof parsed.token === 'string' ? parsed.token : '',
        chipId: typeof parsed.chipId === 'string' ? parsed.chipId : '',
      }
    } catch {
      // 坏掉的 JSON 当空处理，走下面兜底。
    }
  }
  return { token: secret, chipId: '' }
}

/** 打包成落盘格式。`payload` 由宿主决定加密后怎么塞。 */
export function toStored(cred: Credential, payload: string, encrypted: boolean): StoredV2 {
  return {
    v: 2,
    mode: cred.mode,
    baseUrl: cred.baseUrl,
    watchId: cred.watchId,
    expiresAt: cred.expiresAt,
    payload,
    encrypted,
  }
}

/**
 * 从落盘格式还原。
 *
 * 密码模式的令牌过期就返回 null —— 拿一个必定 401 的令牌去刷新一屏错误
 * 比直接让用户重新登录更糟。
 */
export function fromStored(stored: StoredCredential, secret: string): Credential | null {
  if (!stored || !stored.baseUrl || !stored.watchId) return null

  // v1：只有 chip 模式，字段平铺。
  if (stored.v === 1) {
    if (!secret) return null
    return {
      mode: 'chip',
      baseUrl: stored.baseUrl,
      watchId: stored.watchId,
      chipId: secret,
      authToken: '',
      expiresAt: 0,
    }
  }

  if (stored.mode === 'password') {
    const { token, chipId } = parsePasswordSecret(secret)
    // 令牌过期就别恢复了：拿一个必定 401 的令牌去刷一屏错误，
    // 比直接让用户重新登录更糟。
    if (stored.expiresAt > 0 && stored.expiresAt < Date.now()) return null
    // 既没令牌也没 chipId，说明这条记录没有可用的鉴权信息。
    if (!token && !chipId) return null
    return {
      mode: 'password',
      baseUrl: stored.baseUrl,
      watchId: stored.watchId,
      chipId,
      authToken: token,
      expiresAt: stored.expiresAt || 0,
    }
  }

  if (!secret) return null
  return {
    mode: 'chip',
    baseUrl: stored.baseUrl,
    watchId: stored.watchId,
    chipId: secret,
    authToken: '',
    expiresAt: 0,
  }
}

/** 令牌到期还剩几天；chip 模式或无到期时间返回 null。 */
export function daysUntilExpiry(cred: Credential): number | null {
  if (!cred.expiresAt) return null
  const ms = cred.expiresAt - Date.now()
  if (ms <= 0) return 0
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}
