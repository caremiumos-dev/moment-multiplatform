/**
 * 发布器。
 *
 * 行内展开，不弹模态框 —— 写东西时不该被一层遮罩困住。
 * 图片与视频互斥（SDK 会直接拒绝两者同时存在），所以选了一个就锁住另一个。
 */

import { useState } from 'react'
import type { MomentView } from '@shared/types'
import { IconClose, IconImage, IconPen, IconPin, IconVideo } from './icons'
import TopicPicker from './TopicPicker'
import { bridge, call, errorText } from '../api'
import './composer.css'

interface ComposerProps {
  onPublished: (moment: MomentView) => void
}

interface Preview {
  path: string
  dataUrl: string
}

/** 已选视频：路径 + 封面（默认是视频第一帧）。 */
interface PickedVideo {
  videoPath: string
  coverPath: string | null
  coverPreview: string
  coverAuto: boolean
}

/** 服务端一条多图动态最多 9 张。 */
const MAX_IMAGES = 9

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

export default function Composer({ onPublished }: ComposerProps) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [topics, setTopics] = useState<string[]>([])
  const [images, setImages] = useState<Preview[]>([])
  const [video, setVideo] = useState<PickedVideo | null>(null)
  const [location, setLocation] = useState('')
  const [showLocation, setShowLocation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')

  const empty = !content.trim() && images.length === 0 && !video
  const locked = busy

  function reset() {
    setContent('')
    setTopics([])
    setImages([])
    setVideo(null)
    setLocation('')
    setShowLocation(false)
    setError('')
    setPhase('')
  }

  async function pickImages() {
    setError('')
    try {
      const paths = await call(bridge.pickImages())
      if (paths.length === 0) return
      const merged = [...images.map((item) => item.path), ...paths].slice(0, MAX_IMAGES)
      const previews = await call(bridge.previewImages(merged))
      setImages(previews.map((item) => ({ path: item.path, dataUrl: item.dataUrl })))
      // 选图意味着放弃视频：两者不能同时发。
      setVideo(null)
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  async function pickVideo() {
    setError('')
    try {
      // 抽帧在主进程做，大文件要一两秒，界面上给个说法。
      setPhase('正在读取视频第一帧…')
      const picked = await call(bridge.pickVideo())
      if (!picked) return
      setVideo(picked)
      setImages([])
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setPhase('')
    }
  }

  /** 手动换封面；取消则保持原样。 */
  async function changeCover() {
    if (!video) return
    setError('')
    try {
      const picked = await call(bridge.pickCover(video.coverPath))
      if (!picked) return
      setVideo({ ...video, ...picked })
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  /** 去掉封面（手表端会显示默认图）。 */
  function dropCover() {
    if (!video) return
    setVideo({ ...video, coverPath: null, coverPreview: '', coverAuto: false })
  }

  async function submit() {
    if (empty || busy) return
    setBusy(true)
    setError('')
    // 上传大文件时给一点进度感：分阶段写文案，而不是画个假进度条。
    setPhase(images.length > 0 ? '正在上传图片…' : video ? '正在上传视频…' : '正在发布…')
    try {
      const moment = await call(
        bridge.publish({
          content,
          topics,
          imagePaths: images.map((item) => item.path),
          videoPath: video?.videoPath ?? null,
          coverPath: video?.coverPath ?? null,
          location,
        }),
      )
      onPublished(moment)
      reset()
      setOpen(false)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  if (!open) {
    return (
      <button type="button" className="composer__entry" onClick={() => setOpen(true)}>
        <IconPen size={15} />
        <span>写点什么</span>
      </button>
    )
  }

  return (
    <section className="composer" aria-label="发布动态">
      <textarea
        className="composer__text"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="今天发生了什么"
        rows={4}
        autoFocus
        disabled={locked}
        maxLength={1000}
      />

      {images.length > 0 ? (
        <div className="composer__thumbs">
          {images.map((item) => (
            <figure key={item.path} className="composer__thumb">
              {item.dataUrl ? <img src={item.dataUrl} alt="" /> : <span className="composer__thumbblank" />}
              <button
                type="button"
                className="composer__thumbx"
                onClick={() => setImages(images.filter((each) => each.path !== item.path))}
                aria-label="移除这张图片"
                disabled={locked}
              >
                <IconClose size={12} />
              </button>
            </figure>
          ))}
          {images.length < MAX_IMAGES ? (
            <button type="button" className="composer__thumb composer__thumb--add" onClick={pickImages} disabled={locked}>
              再加一张
            </button>
          ) : null}
        </div>
      ) : null}

      {video ? (
        <div className="composer__video">
          <div className="composer__coverbox">
            {video.coverPreview ? (
              <img src={video.coverPreview} alt="视频封面" />
            ) : (
              <span className="composer__coverspacer" />
            )}
          </div>

          <div className="composer__videotext">
            <div className="composer__videoname">
              <IconVideo size={13} />
              <span className="composer__files">{baseName(video.videoPath)}</span>
            </div>
            <div className="composer__covermeta">
              <span className="num">
                {video.coverPath
                  ? video.coverAuto
                    ? '封面：视频第一帧'
                    : '封面：自定义图片'
                  : '封面：未设置（手表端显示默认图）'}
              </span>
              <button type="button" className="composer__coveract" onClick={changeCover} disabled={locked}>
                换封面
              </button>
              {video.coverPath ? (
                <button type="button" className="composer__coveract" onClick={dropCover} disabled={locked}>
                  去掉
                </button>
              ) : null}
            </div>
          </div>

          <button type="button" className="textbtn" data-tone="accent" onClick={() => setVideo(null)} disabled={locked}>
            移除视频
          </button>
        </div>
      ) : null}

      <TopicPicker selected={topics} onChange={setTopics} />

      {showLocation ? (
        <div className="composer__loc">
          <IconPin size={13} />
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="填一个地点，比如「学校」"
            maxLength={30}
            autoFocus
            disabled={locked}
          />
          <button
            type="button"
            className="textbtn"
            onClick={() => {
              setLocation('')
              setShowLocation(false)
            }}
            disabled={locked}
          >
            不用了
          </button>
        </div>
      ) : null}

      {error ? <p className="composer__error">{error}</p> : null}

      <div className="composer__foot">
        <div className="composer__tools">
          <button
            type="button"
            className="composer__tool"
            onClick={pickImages}
            disabled={locked || Boolean(video)}
            title={video ? '视频动态不能再加图片' : '添加图片'}
          >
            <IconImage size={16} />
            <span>图片</span>
          </button>
          <button
            type="button"
            className="composer__tool"
            onClick={pickVideo}
            disabled={locked || images.length > 0}
            title={images.length > 0 ? '图片动态不能再加视频' : '添加视频'}
          >
            <IconVideo size={16} />
            <span>视频</span>
          </button>
          <button
            type="button"
            className="composer__tool"
            onClick={() => setShowLocation(true)}
            disabled={locked || showLocation}
          >
            <IconPin size={16} />
            <span>位置</span>
          </button>
        </div>

        <div className="composer__actions">
          {phase ? <span className="num">{phase}</span> : null}
          <button
            type="button"
            className="textbtn"
            onClick={() => {
              reset()
              setOpen(false)
            }}
            disabled={locked}
          >
            取消
          </button>
          <button type="button" className="btn" onClick={submit} disabled={empty || busy}>
            {busy ? '发送中' : '发布'}
          </button>
        </div>
      </div>
    </section>
  )
}
