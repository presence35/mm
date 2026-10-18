/*
 * Appearance marks — one glyph per mode, for the appearance picker.
 *
 * Same job as ThemeIcon, different question: that one answers "which colour",
 * this one "which lightness". So it carries no `data-palette` of its own: it
 * draws in whatever palette the app is currently in, which is the truth about
 * the mode rather than a preview of a different one.
 *
 * The marks are paths rather than Icon.jsx glyphs because "automatic" is a
 * half-filled disc — fill on one side, stroke on the other — and one stroked
 * path cannot say that.
 */

const MARKS = {
  light: (
    <>
      <circle cx="12" cy="12" r="4.25" fill="var(--primary)" />
      <g stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round">
        <path d="M12 2.5v2.25M12 19.25v2.25M2.5 12h2.25M19.25 12h2.25" />
        <path d="M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
      </g>
    </>
  ),
  dark: <path d="M20.5 14.6A8.75 8.75 0 0 1 9.4 3.5a8.75 8.75 0 1 0 11.1 11.1z" fill="var(--primary)" />,
  auto: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--primary)" strokeWidth="1.75" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="var(--primary)" />
    </>
  ),
}

export default function ModeIcon({ mode, size = 48 }) {
  const mark = MARKS[mode]
  if (!mark) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {mark}
    </svg>
  )
}
