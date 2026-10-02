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

/* Determinate progress through the lifecycle. Cleaning is optional, so the
   denominator is the chain without it. */
const PROGRESS_CHAIN = ['intake', 'fall_checklist', 'storage', 'spring_checklist', 'service', 'ready', 'invoiced', 'archived']

export function progressPercent(status) {
  if (status === 'cleaning') return PROGRESS_CHAIN.indexOf('service') / (PROGRESS_CHAIN.length - 1)
  const i = PROGRESS_CHAIN.indexOf(status)
  return i < 0 ? 0 : i / (PROGRESS_CHAIN.length - 1)
}

export function statusMeta(status) {
  return CARD_STATUS[status] ?? { label: status ?? '—', tone: 'neutral', shape: 'square', step: 0 }
}