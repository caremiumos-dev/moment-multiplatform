/**
 * TUI 的凭据加密存储。
 *
 * 桌面端有 Electron 的 `safeStorage`（DPAPI / Keychain）可用，TUI 没有。
 * 但「把 chipId 明文写进文件」是绝对不能接受的 —— chipId 等于账号密码。
 *
 * 所以这里自己加密：AES-256-GCM，密钥由**机器指纹**派生。
 *
 * 关于这个方案的安全边界，必须说清楚，不能装作它和 DPAPI 一样强：
 *
 * - 它能挡住「文件被别人拷走」这类场景 —— 换台机器密钥就不同，解不开。
 * - 它**挡不住**「在本机上以同一用户身份运行的程序」—— 那些程序能读到同样的
 *   机器指纹，也能算出同样密钥。真正的系统级保护需要 OS 密钥环，Node 里没有
 *   跨平台的等价物。
 * - 所以密钥文件权限设成 0600，并在界面上如实告诉用户「加密保存，但同级程序可解」。
 *
 * 机器指纹取自 `os.hostname()` + `os.userInfo().username` + 平台信息，
 * 再加上一个随机盐（存在单独文件里，让同一台机器上的不同用户也解不开别人的）。
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname, platform, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import {
  fromStored,
  secretOf,
  toStored,
  type Credential,
  type StoredCredential,
} from '../core/credential.js'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 16

/** 配置目录：Windows 用 %APPDATA%，类 Unix 用 ~/.config。 */
export function configDir(): string {
  const override = process.env.MOMENT_CONFIG_DIR
  if (override) return override
  const base =
    process.env.APPDATA ??
    (process.env.XDG_CONFIG_HOME || join(homedir(), '.config'))
  return join(base, 'moment-tui')
}

function accountFile(): string {
  return join(configDir(), 'account.json')
}

function saltFile(): string {
  return join(configDir(), 'machine.salt')
}

/**
 * 取（必要时创建）本机的随机盐。
 *
 * 盐的作用是让「同样的机器指纹」在不同安装上派生出不同密钥，
 * 也保证即使有人知道我们的派生算法，也不能预先算好表。
 */
async function ensureSalt(): Promise<Buffer> {
  const path = saltFile()
  try {
    const existing = await readFile(path)
    if (existing.length === SALT_LENGTH) return existing
  } catch {
    // 不存在，下面创建。
  }
  const salt = randomBytes(SALT_LENGTH)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, salt, { mode: 0o600 })
  return salt
}

/** 机器指纹。故意不含任何可变信息（时间、进程），否则重启后就解不开了。 */
function machineFingerprint(): string {
  let username = ''
  try {
    username = userInfo().username
  } catch {
    // 某些环境下拿不到，退化为空。
  }
  return [hostname(), username, platform(), process.env.USERDOMAIN ?? ''].join('|')
}

async function deriveKey(): Promise<Buffer> {
  const salt = await ensureSalt()
  // scrypt 比 pbkdf2 更抗 GPU 爆破；N=16384 在这个用途下足够快（约 50ms）。
  return scryptSync(machineFingerprint(), salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 })
}

/** 加密成 `iv.authTag.ciphertext` 三段 base64。 */
async function encrypt(plain: string): Promise<string> {
  const key = await deriveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, encrypted].map((part) => part.toString('base64')).join('.')
}

async function decrypt(packed: string): Promise<string> {
  const [ivPart, tagPart, dataPart] = packed.split('.')
  if (!ivPart || !tagPart || !dataPart) throw new Error('密文格式不对')
  const key = await deriveKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64')),
    decipher.final(),
  ])
  return plain.toString('utf8')
}

/**
 * 保存凭据。
 *
 * @param remember false 时删掉磁盘上的旧记录，只保留内存中的会话。
 */
export async function saveCredential(cred: Credential, remember: boolean): Promise<boolean> {
  const path = accountFile()
  if (!remember) {
    await rm(path, { force: true })
    return false
  }

  const secret = secretOf(cred)
  const payload = secret ? await encrypt(secret) : ''
  const stored = toStored(cred, payload, true)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
  return true
}

/** 读回凭据；解不开或已过期都当作没登录过。 */
export async function loadCredential(): Promise<Credential | null> {
  let raw: string
  try {
    raw = await readFile(accountFile(), 'utf8')
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
    const secret = parsed.encrypted ? await decrypt(parsed.payload) : parsed.payload
    return fromStored(parsed, secret)
  } catch {
    // 换了机器或用户，密钥不同 —— 属于正常情况，静默当作没有凭据。
    return null
  }
}

export async function clearCredential(): Promise<void> {
  await rm(accountFile(), { force: true })
}

/** 供界面显示的存储位置说明。 */
export function storageLocation(): string {
  return accountFile()
}
