/*
 * Palette marks — one nautical illustration per palette, for the picker.
 *
 * These are illustrations, not glyphs: each one is two or three colours deep,
 * so unlike Icon.jsx they cannot be a single stroked path. The colours are the
 * palette's *own* tokens, not copies of them. Putting `data-palette` on the svg
 * makes the palette blocks in tokens.css resolve again inside this subtree, so
 * the mark is drawn in the colours of the palette it is advertising — and it
 * follows the palette if the hues are ever retuned, which a table of hex codes
 * never did.
 *
 * Inlined rather than shipped as a hidden sprite with `<use href="#id">`: an
 * instance is rendered five times on one screen, `use` would hand all five the
 * same resolved colours, and one id cannot appear five times in a document.
 *
 * Lightness is not previewed. The mode owns that, and the picker is not a
 * screenshot of the app — the icon answers "which colour", the name and the
 * description next to it answer "which theme".
 */

const MARKS = {
  /* The paper intake card the retired app was built around. The four others
     are the water they are named for; legacy is the app itself. */
  legacy: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" fill="none" stroke="var(--primary)" strokeWidth="2" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" stroke="var(--tertiary)" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),

  /* Compass over crossed sights: classic nautical. */
  'deep-water': (
    <>
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="var(--primary)" strokeWidth="1.25" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="var(--tertiary)" strokeWidth="1.5" />
      <path
        d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07L19.07 4.93"
        stroke="var(--tertiary)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.5" fill="var(--primary)" />
      <circle cx="12" cy="2.5" r="0.75" fill="var(--success)" />
      <circle cx="12" cy="21.5" r="0.75" fill="var(--success)" />
      <circle cx="2.5" cy="12" r="0.75" fill="var(--success)" />
      <circle cx="21.5" cy="12" r="0.75" fill="var(--success)" />
    </>
  ),

  /* A sail against a setting sun, riding a swell. */
  'sunset-harbour': (
    <>
      <path
        d="M3.5 19c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M9 18.5l1.5-11h3L15 18.5z" fill="var(--tertiary)" />
      <path d="M9.5 7.5h5M10 7.5V5.5h4v2" fill="none" stroke="var(--tertiary)" strokeWidth="1" />
      <path d="M10 5.5l2-2 2 2z" fill="var(--success)" />
    </>
  ),

  /* Squall lines and a bolt under a low cloud. */
  'storm-watch': (
    <>
      <path
        d="M3 17c2.5-3 4.5 0 7 0s2.5-3 5-3 4.5 3 7 1"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 20c2.5-2 4.5 0 7 0s2.5-2 5-2 4.5 2 7 1"
        fill="none"
        stroke="var(--success)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M6 9.5a2.5 2.5 0 0 1 3-2 3.5 3.5 0 0 1 6.5 1 2.5 2.5 0 0 1 1.5 4.5H7a2.5 2.5 0 0 1-1-3.5z" fill="var(--primary)" />
      <path d="M12.5 6.5l-2 4.5h2.5L11.5 15l4-5.5h-2.5z" fill="var(--tertiary)" />
    </>
  ),

  /* A palm between two fish. */
  'coral-bay': (
    <>
      <path
        d="M12 21.5v-4m0 0c1.5-1.5 3-1 3.5-4M12 17.5c-1.5-1-2.5-2-3-4.5M12 15V9m0 0c1-1.5 1.5-3 .5-5M12 9c-1-1.5-.5-3.5-1.5-4.5"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.5 14c1-1 2.5-.5 3-2M7.5 13.5c-.5-1-1.5-1.5-2.5-1.5"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M4 10s1.5-1 2.5 0 .5 1.5 0 2-2.5 0-2.5 0l-.5.5v-1z" fill="var(--tertiary)" />
      <path d="M20 13s-1.5-1-2.5 0-.5 1.5 0 2 2.5 0 2.5 0l.5.5v-1z" fill="var(--success)" />
    </>
  ),
}

export default function ThemeIcon({ palette, size = 28 }) {
  const mark = MARKS[palette]
  if (!mark) return null
  return (
    <svg
      data-palette={palette}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {mark}
    </svg>
  )
}
