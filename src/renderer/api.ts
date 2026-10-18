/**
 * 渲染层对 `window.moment` 的薄封装。
 *
 * 只做两件事：把 `{ ok:false }` 统一抛成 `MomentError`，以及把
 * 调用结果原样返回。业务错误文案已经在主进程翻译成中文了。
 */

import type { IpcResult } from '@shared/types'

export class MomentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MomentError'
    this.code = code
  }

  /** 凭据问题：界面该把用户送回登录页。 */
  get isAuthError(): boolean {
    return this.code === '000003' || this.code === '000004' || this.code === '000007' || this.code === '000016'
  }
}

export async function call<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new MomentError(result.code, result.message)
  return result.data
}

/** 把任意异常转成可展示的一句话。 */
export function errorText(error: unknown): string {
  if (error instanceof MomentError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '出了点问题，稍后再试。'
}

export const bridge = window.moment
