import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'

/* Palette and mode are separate decisions. Palette = which colours. Mode =
 * light / dark / follow the OS. Every palette works in every mode. */

const PALETTE_KEY = 'mm.palette'
const MODE_KEY = 'mm.theme'

export const PALETTES = [
  { id: 'deep-water', name: 'Deep Water', desc: 'Classic nautical' },
  { id: 'sunset-harbour', name: 'Sunset Harbour', desc: 'Warm & golden' },
  { id: 'storm-watch', name: 'Storm Watch', desc: 'Rugged & green' },
  { id: 'coral-bay', name: 'Coral Bay', desc: 'Bright & tropical' },
]

const PALETTE_IDS = new Set(PALETTES.map((p) => p.id))
const MODES = new Set(['system', 'light', 'dark'])

function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key)
    return allowed.has(v) ? v : fallback
  } catch {
    return fallback
  }
}

function apply(palette, mode) {
  const el = document.documentElement
  el.dataset.palette = palette
  if (mode === 'system') delete el.dataset.mode
  else el.dataset.mode = mode
}

const ThemeCtx = createContext(null)

export function ThemeProvider({ children }) {
  const [palette, setPaletteState] = useState(() => read(PALETTE_KEY, PALETTE_IDS, 'deep-water'))
  const [mode, setModeState] = useState(() => read(MODE_KEY, MODES, 'system'))

  useEffect(() => {
    apply(palette, mode)
  }, [palette, mode])

  const persist = (key, value, isDefault) => {
    try {
      if (isDefault) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* private mode — the choice simply will not persist */
    }
  }

  const setPalette = useCallback((next) => {
    setPaletteState(next)
    persist(PALETTE_KEY, next, false)
  }, [])

  const setMode = useCallback((next) => {
    setModeState(next)
    persist(MODE_KEY, next, next === 'system')
  }, [])

  const value = useMemo(() => ({ palette, setPalette, mode, setMode }), [palette, setPalette, mode, setMode])

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}