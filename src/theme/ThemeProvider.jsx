import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'

/* Palette and mode are separate decisions. Palette = which colours. Mode =
 * light / dark / follow the OS. Every palette works in every mode. */

const PALETTE_KEY = 'mm.palette'
const MODE_KEY = 'mm.theme'

export const PALETTES = [
  { id: 'legacy', name: 'Legacy', desc: 'The old app, teal on cream' },
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
  syncBrowserChrome()
}

/* The phone's own bar is part of the background — leave it and a stale colour
   sits above the new page. Read from the body rather than from the token: the
   computed value already answers "which mode am I actually in", whether that
   came from the OS or from this setting. */
function syncBrowserChrome() {
  const page = getComputedStyle(document.body).backgroundColor
  if (!page) return
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = page
}

const ThemeCtx = createContext(null)

export function ThemeProvider({ children }) {
  const [palette, setPaletteState] = useState(() => read(PALETTE_KEY, PALETTE_IDS, 'legacy'))
  const [mode, setModeState] = useState(() => read(MODE_KEY, MODES, 'system'))

  useEffect(() => {
    apply(palette, mode)
  }, [palette, mode])

  /* Following the OS, the page can turn over without us being told. */
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => syncBrowserChrome()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

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