/*
 * Card status — the single source of truth.
 *
 * Constraint 5 (no mirror rule): the card list, card detail, map and public
 * view all import from here. No consumer derives status, tone, shape or the
 * next legal transition on its own.
 */

export const CARD_STATUS = {
  intake: { label: 'Intake', tone: 'action', step: 0 },
  fall_checklist: { label: 'Fall', tone: 'progress', step: 1 },
  storage: { label: 'Storage', tone: 'progress', step: 2 },
  spring_checklist: { label: 'Spring', tone: 'progress', step: 3 },
  service: { label: 'Service', tone: 'action', step: 4 },
  cleaning: { label: 'Cleaning', tone: 'progress', step: 5 },
  ready: { label: 'Ready', tone: 'done', step: 6 },
  invoiced: { label: 'Invoiced', tone: 'done', step: 7 },
  archived: { label: 'Archived', tone: 'neutral', step: 8 },
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

/*
 * The card a boat's row should open.
 *
 * A boat collects one card per season, so "the boat's card" is a rule rather
 * than a lookup. This is the legacy app's rule, kept deliberately: the card that
 * is neither invoiced nor archived. Invoiced and archived cards are history and
 * belong on the owner's screen, not behind a boat in the yard list.
 *
 * Returns null when a boat has only history or no cards at all — the caller
 * sends the worker to the owner instead of inventing a card to open. Rather than
 * the first match, the newest season wins, so the answer does not depend on the
 * order the store happens to hand rows over in.
 */
export function activeCardFor(cards) {
  const open = (cards ?? []).filter((c) => c.status !== 'invoiced' && c.status !== 'archived')
  if (!open.length) return null
  const newest = (a, b) =>
    Number(b.season_year ?? 0) - Number(a.season_year ?? 0) ||
    String(b.work_order_no ?? '').localeCompare(String(a.work_order_no ?? ''))
  return open.slice().sort(newest)[0]
}

export function canTransition(from, to) {
  return nextStatuses(from).includes(to)
}

export function statusMeta(status) {
  return CARD_STATUS[status] ?? { label: status ?? '—', tone: 'neutral', step: 0 }
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

/* The small progress bar's numbers, so the meter and the strip cannot disagree.
   Positional like stagePhase: the bar measures where the card sits, and an
   optional stage skipped stays without a dent. Unknown status → null — no bar
   rather than a wrong one. */
export function stageProgress(status) {
  const at = STATUS_ORDER.indexOf(status)
  if (at < 0) return null
  return { done: at + 1, total: STATUS_ORDER.length }
}

/* The same position as a 0–1 fraction, for the rail on a status pill. Nine
   arbitrary glyphs had to be memorised; how far along a fixed rail you are does
   not, because the stages only ever run in one order. One derivation, so the
   pill, the strip and the meter cannot disagree. */
export function stageFraction(status) {
  const progress = stageProgress(status)
  return progress ? progress.done / progress.total : null
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

/* The stages as filter options, in lifecycle order. Derived from the map above
   so a tenth stage appears in every filter sheet by existing, and no screen
   keeps its own shorter list of the ones somebody remembered. */
export function statusOptions() {
  return Object.entries(CARD_STATUS)
    .map(([value, meta]) => ({ value, ...meta }))
    .sort((a, b) => a.step - b.step)
}