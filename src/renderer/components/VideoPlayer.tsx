/**
 * 视频播放。
 *
 * 列表里只画封面 —— 一条视频几 MB，feed 里预载会拖垮滚动。
 * 点封面才挂 `src`，并交给浏览器原生控件，不自己造播放器 UI。
 */

import { useState } from 'react'
import { IconVideo } from './icons'
import './video-player.css'

interface VideoPlayerProps {
  src: string
  cover: string
}

export default function VideoPlayer({ src, cover }: VideoPlayerProps) {
  const [playing, setPlaying] = useState(false)

  if (playing) {
    return (
      <video className="video" src={src} poster={cover || undefined} controls autoPlay playsInline />
    )
  }

  return (
    <button
      type="button"
      className="video"
      data-idle="true"
      onClick={() => setPlaying(true)}
      aria-label="播放视频"
    >
      {cover ? <img src={cover} alt="" draggable={false} /> : <span className="video__blank" />}
      <span className="video__play">
        <IconVideo size={22} />
      </span>
    </button>
  )
}
