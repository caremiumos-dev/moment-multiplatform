/**
 * 图标：全部是手写的 1.5px 线条路径。
 *
 * 不用图标库、不用 emoji —— 前者引入一堆用不上的图标，后者在中文排版里
 * 尺寸与基线都对不齐。统一 16x16 视口，`currentColor` 取色，随文字变色。
 */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 点赞：拇指。已赞时由外部把 fill 打开。 */
export function IconLike(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 7.2 8 2.4a1.25 1.25 0 0 1 2.4.55V6h2.35a1.2 1.2 0 0 1 1.18 1.42l-.92 4.6A1.2 1.2 0 0 1 11.83 13H5.5" />
      <path d="M5.5 6.9H3.3a.8.8 0 0 0-.8.8v4.5c0 .44.36.8.8.8h2.2" />
    </Icon>
  )
}

/** 评论：对话框，尾巴在左下。 */
export function IconComment(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 9.4a1.6 1.6 0 0 1-1.6 1.6H5.4L2.5 13.5V3.6A1.6 1.6 0 0 1 4.1 2h7.8a1.6 1.6 0 0 1 1.6 1.6z" />
    </Icon>
  )
}

/** 位置：图钉。 */
export function IconPin(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 14.2s4.6-4.1 4.6-7.4a4.6 4.6 0 1 0-9.2 0C3.4 10.1 8 14.2 8 14.2z" />
      <circle cx="8" cy="6.6" r="1.6" />
    </Icon>
  )
}

/** 更多操作：三个点，竖排。 */
export function IconMore(props: IconProps) {
  return (
    <Icon {...props} strokeWidth={0}>
      <circle cx="8" cy="3.2" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="12.8" r="1.15" fill="currentColor" />
    </Icon>
  )
}

/** 关闭：叉。 */
export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Icon>
  )
}

/** 图片：山与太阳。 */
export function IconImage(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1" />
      <circle cx="5.9" cy="6.5" r="1.1" />
      <path d="m2.6 11.6 3.3-3.2 2.6 2.4 2-1.7 2.9 2.5" />
    </Icon>
  )
}

/** 视频：播放三角套方框。 */
export function IconVideo(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3.4" width="12" height="9.2" rx="1.2" />
      <path d="m6.8 6.2 3.4 1.8-3.4 1.8z" />
    </Icon>
  )
}

/** 话题：井号。小括号话题在客户端就长这样，这里用井号区分「可点的话题标签」。 */
export function IconTopic(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.3 2.4 5 13.6M11 2.4 9.7 13.6M2.6 5.9h10.8M2.6 10.1h10.8" />
    </Icon>
  )
}

/** 返回：左箭头。 */
export function IconBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.8 3.4 5.2 8l4.6 4.6" />
      <path d="M5.4 8h8" />
    </Icon>
  )
}

/** 下拉：V 形，小尺寸用在「加载更多」旁。 */
export function IconChevron(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.2 6.2 3.8 3.6 3.8-3.6" />
    </Icon>
  )
}

/** 编辑：笔。用在「写一条」入口。 */
export function IconPen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.1 2.6 13.4 4.9 5.6 12.7l-3 .6.6-3z" />
      <path d="m9.6 4.1 2.3 2.3" />
    </Icon>
  )
}
