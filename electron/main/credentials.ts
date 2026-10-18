/**
 * 凭据存储 —— Electron 版。
 *
 * 数据的形状、过期判断、v1/v2 兼容都在 `core/credential.ts` 里，
 * 这里只负责 Electron 特有的一件事：**用系统密钥加密**。
 *
 * Windows 上是 DPAPI（绑定当前用户账户），macOS 上是 Keychain。
 * 拿不到加密能力时不落盘，凭据只活在内存里 —— 宁可不记住，也不写明文。
 */

import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  fromStored,
  secretOf,
  toStored,
  type Credential,
  type StoredCredential,
} from '../../core/credential.js'

export type { AuthMode, Credential } from '../../core/credential.js'

const FILE_NAME = 'account.json'

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** safeStorage 是否可用。不可用时不允许落盘明文。 */
export function canRemember(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 读回上次保存的凭据；解不开或已过期都当作没登录。 */
export async function loadCredential(): Promise<Credential | null> {
  let raw: string
  try {
    raw = await readFile(filePath(), 'utf8')
  } catch {
    return null
  }

  let parsed: StoredCredential
  try {
    parsed = JSON.parse(raw) as StoredCredential
  } catch {
    return null
  }
  if (!parsed?.payload) return null

  try {
    const secret = parsed.encrypted
      ? safeStorage.decryptString(Buffer.from(parsed.payload, 'base64'))
      : parsed.payload
    return fromStored(parsed, secret)
  } catch {
    // 换了 Windows 账户或系统重置了密钥，密文解不开属于正常情况。
    return null
  }
}

/**
 * 保存凭据。`remember` 为 false 或系统不支持加密时删掉磁盘上的旧记录，
 * 凭据只活在内存里。
 */
export async function saveCredential(cred: Credential, remember: boolean): Promise<boolean> {
  const path = filePath()
  if (!remember || !canRemember()) {
    await rm(path, { force: true })
    return false
  }

  const secret = secretOf(cred)
  // 没有可保存的秘密（比如 chip 模式 chipId 为空）就不要写文件：
  // `loadCredential` 遇到空 payload 会当作没登录，写进去也只是留个死记录。
  if (!secret) {
    await rm(path, { force: true })
    return false
  }
  const stored = toStored(cred, safeStorage.encryptString(secret).toString('base64'), true)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
  return true
}

export async function clearCredential(): Promise<void> {
  await rm(filePath(), { force: true })
}
