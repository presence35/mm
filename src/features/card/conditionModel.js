/*
 * Condition, as data.
 *
 * The rating and note transitions used to live inside a React hook, which made
 * them untestable — and a note field that silently refused to save shipped
 * exactly because of that. These are pure functions over a plain array, so the
 * rules can be asserted directly and the hook is left with nothing but wiring.
 *
 * One invariant holds everything together:
 *
 *   An entry exists if and only if it has a rating or a note.
 *
 * So an empty {area, rating: null, note: null} cannot be constructed, and
 * "cleared" never has to be represented as a separate tombstone state.
 */

export const RATINGS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damage', label: 'Damage' },
]

export const LABEL = Object.fromEntries(RATINGS.map((r) => [r.value, r.label]))

/* Worst first. Damage is the value a dispute turns on. */
const SEVERITY = ['damage', 'poor', 'fair', 'good']

/* Good is the absence of a problem, so a note beside it has nothing to
   describe. Below Good the note is what makes the rating actionable. */
const NEEDS_NOTE = new Set(['fair', 'poor', 'damage'])

export const needsNote = (rating) => NEEDS_NOTE.has(rating)

const withEntry = (condition, area, changes) => {
  const rest = (condition ?? []).filter((c) => c.area !== area)
  const prior = (condition ?? []).find((c) => c.area === area)
  const next = { area, rating: prior?.rating ?? null, note: prior?.note ?? null, ...changes }

  /* The invariant, enforced at the only place entries are created. */
  if (next.rating === null && next.note === null) return rest
  return [...rest, next]
}

/*
 * Clearing a rating deliberately keeps the note. Dropping the row instead
 * discarded whatever had been typed, which is the one thing this app must never
 * lose — and a note with no rating is a real state: seen, not gradable.
 */
export function setRating(condition, area, rating) {
  if (rating !== null && !LABEL[rating]) {
    throw new RangeError(`Unknown condition rating: ${JSON.stringify(rating)}`)
  }
  return withEntry(condition, area, { rating })
}

export function setNote(condition, area, text) {
  if (typeof text !== 'string') {
    /* TextField hands over the value, not the event. Reading .target off a
       string yields undefined, and the empty-note path below would swallow it
       and report success. A caller that gets this wrong is a programmer error. */
    throw new TypeError(`setNote() expects the field value as a string, got ${typeof text}`)
  }
  const trimmed = text.trim()
  return withEntry(condition, area, { note: trimmed ? text : null })
}

export function ratingFor(condition, area) {
  return (condition ?? []).find((c) => c.area === area)?.rating ?? null
}

export function noteFor(condition, area) {
  return (condition ?? []).find((c) => c.area === area)?.note ?? null
}

/*
 * Counts entries that actually carry a rating. A row can exist without one — an
 * area where only a note was typed — and counting rows would claim a check that
 * never happened.
 */
export function summarise(condition, total) {
  const entries = condition ?? []
  const rated = entries.filter((c) => c.rating).length
  const noted = entries.filter((c) => c.note).length
  const worst = SEVERITY.find((r) => entries.some((c) => c.rating === r)) ?? null

  if (!rated && !noted) return 'Not yet checked'

  const parts = []
  parts.push(rated ? `${rated} of ${total} checked` : 'No areas graded')
  if (worst) parts.push(`worst ${LABEL[worst].toLowerCase()}`)
  if (noted) parts.push(`${noted} noted`)
  return parts.join(' · ')
}