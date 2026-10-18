/**
 * 主题上下文。
 *
 * 颜色通过 context 下发，而不是每个组件 `import { getTheme }` 后自己算：
 * 这样切换主题只需在根部换一次，整棵树跟着重渲染。
 */

import React, { createContext, useContext } from 'react'
import { getTheme, type Theme } from './theme.js'

const ThemeContext = createContext<Theme>(getTheme('dark'))

export function ThemeProvider({
  theme,
  children,
}: {
  theme: Theme
  children: React.ReactNode
}): React.ReactElement {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

/** 取当前主题的色值表。 */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}
