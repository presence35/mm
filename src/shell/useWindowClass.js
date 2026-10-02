import { useEffect, useState } from 'react'

/* Design for the window we actually have, not a guessed device category.
   architecture.md §IA — compact <600, medium 600–839, expanded 840+. */

function read() {
  if (typeof window === 'undefined') return 'compact'
  const w = window.innerWidth
  if (w >= 840) return 'expanded'
  if (w >= 600) return 'medium'
  return 'compact'
}

export function useWindowClass() {
  const [cls, setCls] = useState(read)

  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setCls(read()))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return cls
}

export function useIsTouch() {
  const [touch, setTouch] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const onChange = () => setTouch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return touch
}