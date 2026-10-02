/*
 * Local stroke icon set (24×24, 2px stroke, round caps).
 *
 * Deliberate deviation: Material Symbols would normally come from a CDN, but
 * this app is local-first and must render identically with no network. Icons
 * ship with the bundle. Documented in the Phase 1 handoff.
 */

const P = {
  cards: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M7 14h4 M13 14h4 M7 17h4',
  users:
    'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20 M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M22 20v-1.5a4 4 0 0 0-3-3.87 M16 3.6a4 4 0 0 1 0 7.75',
  boat: 'M12 16V4 M12 5.5 18.5 15h-6.5z M2.5 16h19l-2.4 4.2a2 2 0 0 1-1.7 1H6.6a2 2 0 0 1-1.7-1z',
  map: 'M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z M9 4v13 M15 6.5v13',
  tune: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4.5v5 M7 14.5v5',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h3v3h-3z M20 14v3 M14 20h6',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  dots: 'M12 6.5h.01 M12 12h.01 M12 17.5h.01',
  plus: 'M12 5v14 M5 12h14',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18 M6 6l12 12',
  right: 'm9 5 7 7-7 7',
  down: 'm5 9 7 7 7-7',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  offline:
    'M2 2l20 20 M8.5 16.4a5 5 0 0 1 7 0 M5 12.9a10 10 0 0 1 3.2-2 M2.5 9.5a15 15 0 0 1 4.6-2.8 M12 19.5h.01 M16.5 10.2a10 10 0 0 1 2.5 2.7',
  alert: 'M12 3 2.5 20h19z M12 9v5 M12 17.5h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  calendar: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M4 11h16 M8 3v4 M16 3v4',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  wrench:
    'M15.2 3.4a5.5 5.5 0 0 0-5 7.6L3.6 17.6a2 2 0 0 0 2.8 2.8l6.6-6.6a5.5 5.5 0 0 0 7.1-6.5l-3 3-2.8-2.8 3-3a5.5 5.5 0 0 0-2.1-.3z',
  pencil: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z',
  trash: 'M4 7h16 M9 7V5h6v2 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  receipt:
    'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h4',
  sync: 'M20 12a8 8 0 0 1-13.7 5.6L3 14 M3 12a8 8 0 0 1 13.7-5.6L21 10 M3 19v-5h5 M21 5v5h-5',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M19 5l-1.5 1.5 M6.5 17.5 5 19',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  bolt: 'M13 3 4 14h7l-1 7 9-11h-7z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 8l-4 4 4 4 M6 12h9',
}

export default function Icon({ name, size = 24, filled = false, ...rest }) {
  const d = P[name]
  if (!d) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {filled ? <path d={d} fill="currentColor" stroke="none" /> : <path d={d} />}
    </svg>
  )
}