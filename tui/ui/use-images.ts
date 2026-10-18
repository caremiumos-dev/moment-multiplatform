/**
 * 图片预取与缓存。
 *
 * 列表里每条动态都可能带图，同步加载会卡住渲染。所以这里做成：
 * 先用一个 hook 拿到「当前需要显示的图片任务」，异步编码，编码好再渲染。
 *
 * 缓存按 URL 存编码后的**终端字节**，不是原始图片 —— 同一张图在不同宽度下
 * 编码结果不同，所以缓存键是 `URL + 宽度`。
 */

import { useEffect, useRef, useState } from 'react'
import type { Capability } from '../media/capability.js'
import { renderImage, type RenderedImage } from '../media/images.js'

/** 编码结果缓存。进程生命周期内有效，够用了。 */
const cache = new Map<string, RenderedImage>()
/** 正在进行中的任务，避免同一个 URL 并发编码两次。 */
const inflight = new Map<string, Promise<RenderedImage>>()

function cacheKey(url: string, width: number): string {
  return `${width}|${url}`
}

/** 取一张图的终端字节（带缓存与去重）。 */
export async function getRenderedImage(
  url: string,
  capability: Capability,
  width: number,
): Promise<RenderedImage> {
  const key = cacheKey(url, width)
  const hit = cache.get(key)
  if (hit) return hit

  const running = inflight.get(key)
  if (running) return running

  const task = renderImage(url, capability, width)
    .then((result) => {
      cache.set(key, result)
      return result
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, task)
  return task
}

export interface LoadedImage {
  key: string
  data: string
  rows: number
}

/**
 * 监听一组 URL，逐个编码。
 *
 * 返回「已就绪的图片」，未就绪的用 null 占位（界面显示「加载中」）。
 * 之所以用 Ref 存 cache，是为了避免把整个 Map 塞进 state 导致无谓重渲染。
 */
export function useImages(
  urls: Array<string | null>,
  capability: Capability,
  width: number,
): Map<string, LoadedImage | null> {
  const [state, setState] = useState<Map<string, LoadedImage | null>>(() => new Map())
  const seen = useRef(new Set<string>())

  // 把 urls 拼成稳定字符串当依赖，避免每次渲染都触发 effect。
  const signature = urls.map((u) => u ?? '').join('§')

  useEffect(() => {
    if (capability.protocol === 'none') return

    let cancelled = false

    void (async () => {
      for (const url of urls) {
        if (!url || !/^https?:\/\//.test(url)) continue
        const key = cacheKey(url, width)
        if (seen.current.has(key)) continue
        seen.current.add(key)

        setState((prev) => new Map(prev).set(url, null))

        try {
          const rendered = await getRenderedImage(url, capability, width)
          if (cancelled) return
          setState((prev) =>
            new Map(prev).set(url, { key, data: rendered.data, rows: rendered.rows }),
          )
        } catch {
          if (cancelled) return
          // 失败就不显示图，界面自己会退化成文字。
          setState((prev) => new Map(prev).set(url, null))
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, capability.protocol, width])

  return state
}
