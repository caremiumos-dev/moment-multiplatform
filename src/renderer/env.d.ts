/// <reference types="vite/client" />

import type { MomentBridge } from '@shared/types'

declare global {
  interface Window {
    /** preload 通过 contextBridge 注入，主进程是唯一的数据来源。 */
    moment: MomentBridge
  }
}

export {}
