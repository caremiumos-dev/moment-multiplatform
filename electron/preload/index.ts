/**
 * preload：唯一一座桥。
 *
 * 这里只做转发，不做任何判断 —— 校验全在主进程的 handler 里，
 * 因为渲染进程的输入永远不可信。暴露的方法名刻意收窄，不提供
 * 任意 channel 的 invoke 能力。
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { MomentBridge } from '@shared/types'

const bridge: MomentBridge = {
  accountStatus: () => ipcRenderer.invoke('account:status'),
  login: (input) => ipcRenderer.invoke('account:login', input),
  logout: () => ipcRenderer.invoke('account:logout'),

  feedList: (query) => ipcRenderer.invoke('feed:list', query),
  momentGet: (momentId) => ipcRenderer.invoke('moment:get', momentId),

  commentList: (input) => ipcRenderer.invoke('comment:list', input),
  commentCreate: (input) => ipcRenderer.invoke('comment:create', input),
  commentDelete: (input) => ipcRenderer.invoke('comment:delete', input),

  publish: (input) => ipcRenderer.invoke('publish', input),
  momentDelete: (input) => ipcRenderer.invoke('moment:delete', input),
  momentLike: (input) => ipcRenderer.invoke('moment:like', input),

  topics: () => ipcRenderer.invoke('topics:list'),

  pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
  pickVideo: () => ipcRenderer.invoke('dialog:pickVideo'),
  pickCover: (currentPath) => ipcRenderer.invoke('dialog:pickCover', currentPath),
  previewImages: (paths) => ipcRenderer.invoke('file:preview', paths),
}

contextBridge.exposeInMainWorld('moment', bridge)
