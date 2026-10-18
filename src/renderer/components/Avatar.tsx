/**
 * 头像。
 *
 * 服务端 `iconPath` 可能是空串（库里就有账号没头像），所以必须有兜底。
 * 兜底不用彩色圆形色块 —— 那是最典型的模板味 —— 而是取名字首字，
 * 纸底 + 墨字 + 1px 描边，和整体排版同一种语气。
 */

import { useState } from 'react'
import './avatar.css'

interface AvatarProps {
  src: string
  name: string
  size?: number
}

/** 取名字里第一个「有内容」的字符：跳过 emoji 与标点，中文取首字。 */
function initialOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '·'
  for (const char of Array.from(trimmed)) {
    // 汉字与拉丁字母数字都留下，标点跳过。
    if (/[\p{Script=Han}\p{L}]/u.test(char)) return char.toUpperCase()
  }
  return trimmed[0]?.toUpperCase() ?? '·'
}

export default function Avatar({ src, name, size = 40 }: AvatarProps) {
  const [broken, setBroken] = useState(false)
  const showImage = Boolean(src) && !broken

  return (
    <span
      className="avatar"
      data-image={showImage}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          style={{ width: size, height: size }}
        />
      ) : (
        <span className="avatar__initial">{initialOf(name)}</span>
      )}
    </span>
  )
}
