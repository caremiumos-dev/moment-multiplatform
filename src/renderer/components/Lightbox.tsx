/**
 * 灯箱：全屏看大图。
 *
 * 不用模糊背景（backdrop-filter 会掉帧且是模板味重灾区），用一层纯墨色半透。
 * 支持左右方向键、Esc 关闭，点击两侧区域切换。
 */

import { useEffect } from 'react'
import { IconBack, IconClose } from './icons'
import './lightbox.css'

interface LightboxProps {
  images: string[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

export default function Lightbox({ images, index, onIndex, onClose }: LightboxProps) {
  const total = images.length
  const current = images[index] ?? ''

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && total > 1) onIndex((index + 1) % total)
      if (event.key === 'ArrowLeft' && total > 1) onIndex((index - 1 + total) % total)
    }
    window.addEventListener('keydown', onKey)
    // 灯箱打开时锁住背后页面的滚动。
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [index, total, onClose, onIndex])

  if (!current) return null

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看图片">
      <button type="button" className="lightbox__scrim" onClick={onClose} aria-label="关闭" />

      <img className="lightbox__img" src={current} alt="" draggable={false} />

      <div className="lightbox__bar">
        <span className="lightbox__count num">
          {index + 1} / {total}
        </span>
        <button type="button" className="lightbox__btn" onClick={onClose} aria-label="关闭">
          <IconClose size={18} />
        </button>
      </div>

      {total > 1 ? (
        <>
          <button
            type="button"
            className="lightbox__nav"
            data-side="left"
            onClick={() => onIndex((index - 1 + total) % total)}
            aria-label="上一张"
          >
            <IconBack size={22} />
          </button>
          <button
            type="button"
            className="lightbox__nav"
            data-side="right"
            onClick={() => onIndex((index + 1) % total)}
            aria-label="下一张"
          >
            <IconBack size={22} />
          </button>
        </>
      ) : null}
    </div>
  )
}
