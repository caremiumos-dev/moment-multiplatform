/**
 * 图片网格。
 *
 * 按张数换布局：1 张保持原始比例不裁切，2/3/4 张走紧凑拼贴，
 * 超过 4 张显示 2x2 并在最后一格盖「+N」。间距 3px、圆角 2px，
 * 让图片自己说话，不给它加边框或阴影。
 */

import './image-grid.css'

interface ImageGridProps {
  images: string[]
  onOpen: (index: number) => void
}

export default function ImageGrid({ images, onOpen }: ImageGridProps) {
  if (images.length === 0) return null

  const count = images.length
  const layout = count === 1 ? 'one' : count === 2 ? 'two' : count === 3 ? 'three' : 'four'
  const visible = count > 4 ? images.slice(0, 4) : images
  const overflow = count - 4

  return (
    <div className="imggrid" data-layout={layout}>
      {visible.map((src, index) => (
        <button
          key={`${src}-${index}`}
          type="button"
          className="imggrid__cell"
          onClick={() => onOpen(index)}
          aria-label={`查看第 ${index + 1} 张图片`}
        >
          <img src={src} alt="" loading="lazy" draggable={false} />
          {index === 3 && overflow > 0 ? (
            <span className="imggrid__more num">+{overflow}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
