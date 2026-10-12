/*
 * Card status — the single source of truth.
 *
 * Constraint 5 (no mirror rule): the card list, card detail, map and public
 * view all import from here. No consumer derives status, tone, shape or the
 * next legal transition on its own.
 */

export const CARD_STATUS = {
  intake: { label: 'Intake', tone: 'action', shape: 'triangle', step: 0 },
  fall_checklist: { label: 'Fall check', tone: 'progress', shape: 'square', step: 1 },
  storage: { label: 'In storage', tone: 'progress', shape: 'diamond', step: 2 },
  spring_checklist: { label: 'Spring check', tone: 'progress', shape: 'slanted', step: 3 },
  service: { label: 'Service', tone: 'action', shape: 'round', step: 4 },
  cleaning: { label: 'Cleaning', tone: 'progress', shape: 'bar', step: 5 },
  ready: { label: 'Ready', tone: 'done', shape: 'ring', step: 6 },
  invoiced: { label: 'Invoiced', tone: 'done', shape: 'half', step: 7 },
  archived: { label: 'Archived', tone: 'neutral', shape: 'square', step: 8 },
}

export const STATUS_ORDER = Object.keys(CARD_STATUS)

/* Legal transitions, stated explicitly rather than derived from `step`, so
   that optional stages (cleaning can be skipped) stay expressible.
   A one-step backward move is always legal: field corrections happen. */
const FORWARD = {
  intake: ['fall_checklist'],
  fall_checklist: ['storage'],
  storage: ['spring_checklist'],
  spring_checklist: ['service'],
  service: ['cleaning', 'ready'],
  cleaning: ['ready'],
  ready: ['invoiced'],
  invoiced: ['archived'],
  archived: [],
}

export function nextStatuses(status) {
  const out = [...(FORWARD[status] ?? [])]
  const back = STATUS_ORDER[STATUS_ORDER.indexOf(status) - 1]
  if (back) out.push(back)
  return out
}

export function canTransition(from, to) {
  return nextStatuses(from).includes(to)
}

export function statusMeta(status) {
  return CARD_STATUS[status] ?? { label: status ?? '—', tone: 'neutral', shape: 'square', step: 0 }
}

/* ------------------------------------------------------- stage strip model
 *
 * One ordered list of stages, consumed by exactly one component (ui/StageStrip)
 * through exactly one composition (features/card/CardDetail). The legacy app
 * showed the stage twice — a tracker strip and a prev/next stepper — and this
 * rebuild had added a third, a progress bar. All three are the same fact.
 */

/* The only stage a card can legally skip. `service → ready` is a legal
   transition (see FORWARD), so a card may reach READY having never been
   CLEANING. Marked from the strip so a positional `done` is never read as
   "this boat was cleaned". */
export const OPTIONAL_STAGES = new Set(['cleaning'])

export const STAGES = STATUS_ORDER.map((key) => ({
  key,
  label: CARD_STATUS[key].label,
  optional: OPTIONAL_STAGES.has(key),
}))

/* Positional, not historical. A stage behind the current one is `done`; a
   skippable stage behind it is still `done` positionally, which is why
   OPTIONAL_STAGES exists and why StageStrip draws an optional stage with a
   hollow marker instead of a tick. Nothing here asserts the work happened. */
export function stagePhase(current, stage) {
  const at = STATUS_ORDER.indexOf(stage)
  const now = STATUS_ORDER.indexOf(current)
  if (at < 0 || now < 0) return 'future'
  if (at === now) return 'current'
  return at < now ? 'done' : 'future'
}

/* Counts for the Cards filter chips. Every card lands in exactly one bucket,
   so the counts sum to the list length; an unrecognised status still gets a
   bucket rather than vanishing from a total. */
export function countsByStatus(cards) {
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]))
  for (const card of cards ?? []) {
    const key = card?.status
    if (!key) continue
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}