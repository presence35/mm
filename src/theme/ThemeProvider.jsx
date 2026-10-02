import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'

const ThemeCtx = createContext(null)
const STORAGE_KEY = 'mm.theme'

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(theme) {
  const el = document.documentElement
  if (theme === 'system') delete el.dataset.theme
  else el.dataset.theme = theme
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStored)

  useEffect(() => {
    apply(theme)
  }, [theme])

  const setTheme = useCallback((next) => {
    setThemeState(next)
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private mode — theme simply will not persist */
    }
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, resolved: theme === 'system' ? 'system' : theme }),
    [theme, setTheme],
  )

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}