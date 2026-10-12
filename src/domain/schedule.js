/*
 * Scheduling — pure and deterministic.
 *
 * Legality and capacity only. Nothing here reads storage, a network or a
 * clock. Every time-dependent function takes `now` explicitly
 * (architecture.md constraint 6).
 *
 * ASSUMPTIONS. Stated because they are choices, not facts:
 *
 *   1. The ramp is a single lane. `drop_off`, `pickup` and `ramp` all consume
 *      it, so they share one capacity pool rather than three calendars. This is
 *      the "drop-off shares with the ramp" decision — a boat cannot reach a
 *      storage position without crossing the ramp, so the ramp is the gate.
 *   2. Capacity is a per-resource number in RESOURCES. It is an input, not a
 *      constant baked into the comparison, so the marina can change it without
 *      a code change once it is server-owned reference data.
 *   3. Nominal durations prefill an end time. They are NOT enforced — the yard
 *      decides when it is finished, and an appointment that runs long is the
 *      normal case, not an error.
 *   4. Working hours are not modelled. This is a board for a small yard, not a
 *      booking engine.
 */

/* ------------------------------------------- resources and capacity pools */

/* One pool per physical constraint. `capacity` is how many of that thing can
   be in use at once. */
export const RESOURCES = {
  ramp: { label: 'Ramp', capacity: 1 },
  wash_bay: { label: 'Wash bay', capacity: 2 },
  shop_bay: { label: 'Shop bay', capacity: 3 },
}

export const TASK_TYPES = [
  { value: 'drop_off', label: 'Drop off', resource: 'ramp', minutes: 45 },
  { value: 'pickup', label: 'Pickup', resource: 'ramp', minutes: 45 },
  { value: 'ramp', label: 'Ramp use', resource: 'ramp', minutes: 60 },
  { value: 'cleaning', label: 'Cleaning', resource: 'wash_bay', minutes: 120 },
  { value: 'repair', label: 'Repair work', resource: 'shop_bay', minutes: 240 },
]

const BY_VALUE = Object.fromEntries(TASK_TYPES.map((t) => [t.value, t]))

export function taskLabel(taskType) {
  return BY_VALUE[taskType]?.label ?? taskType ?? '—'
}

export function resourceFor(taskType) {
  return BY_VALUE[taskType]?.resource ?? null
}

export function durationMinutesFor(taskType) {
  return BY_VALUE[taskType]?.minutes ?? 60
}

/* Interval end from a start plus the task's nominal duration. Prefill only. */
export function defaultEnd(startIso, taskType) {
  const start = toMs(startIso)
  if (!Number.isFinite(start)) return null
  return new Date(start + durationMinutesFor(taskType) * 60_000).toISOString()
}

/* ----------------------------------------------------------- state machine */

/* proposed → booked → in_progress → done, with cancel from either open state.
   `done` and `cancelled` are terminal: a reappointment is a new row, because
   "the boat came back" is a different fact from "the first visit finished". */
const NEXT = {
  proposed: ['booked', 'cancelled'],
  booked: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
}

export const OPEN_STATUSES = new Set(['proposed', 'booked', 'in_progress'])

export function isOpen(status) {
  return OPEN_STATUSES.has(status)
}

export function nextAppointmentStatuses(status) {
  return [...(NEXT[status] ?? [])]
}

export function canTransition(from, to) {
  return nextAppointmentStatuses(from).includes(to)
}

/* Capacity is checked on the move into `booked`, never on `proposed`
   (architecture.md §Appointment). A proposal reserves nothing, which is what
   lets office hold three options for the same customer. */
export function consumesCapacity(status) {
  return status === 'booked' || status === 'in_progress'
}

/* --------------------------------------------------------------- capacity */

function toMs(value) {
  if (typeof value === 'number') return value
  const t = new Date(value ?? NaN).getTime()
  return Number.isFinite(t) ? t : NaN
}

/* Half-open: [start, end). A job finishing at 10:00 does not clash with one
   starting at 10:00. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

/* Problems that make an appointment meaningless regardless of capacity. */
export function validateAppointment(appointment) {
  const problems = []
  if (!BY_VALUE[appointment?.task_type]) problems.push('unknown_task_type')
  const start = toMs(appointment?.scheduled_start)
  const end = toMs(appointment?.scheduled_end)
  if (!Number.isFinite(start)) problems.push('start_not_a_time')
  if (!Number.isFinite(end)) problems.push('end_not_a_time')
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) problems.push('end_not_after_start')
  return problems
}

/*
 * The one place capacity is decided.
 *
 * `ignoreId` excludes the row being edited from its own clash count, so saving
 * an unchanged appointment does not report itself as full.
 *
 * Existing rows that already exceed capacity are counted, not forgiven: two
 * phones that booked the ramp offline produce an over-capacity board, and the
 * board must show that rather than hide it.
 */
export function capacityCheck({ appointments, candidate, ignoreId = null, resources = RESOURCES }) {
  const problems = validateAppointment(candidate)
  if (problems.length) return { ok: false, reason: problems[0], problems }

  const resource = resourceFor(candidate.task_type)
  const capacity = resources[resource]?.capacity
  if (!capacity) return { ok: false, reason: 'unknown_resource', resource }

  const start = toMs(candidate.scheduled_start)
  const end = toMs(candidate.scheduled_end)

  const clashing = (appointments ?? []).filter(
    (a) =>
      a.id !== ignoreId &&
      consumesCapacity(a.status) &&
      resourceFor(a.task_type) === resource &&
      overlaps(start, end, toMs(a.scheduled_start), toMs(a.scheduled_end)),
  )

  if (clashing.length + 1 > capacity) {
    return { ok: false, reason: 'capacity_full', resource, capacity, clashing }
  }
  return { ok: true, resource, capacity }
}

/* How many are already on the resource in a window, ignoring one row. The
   board shows this so a full ramp says why it is full. */
export function loadInWindow({ appointments, resource, start, end, ignoreId = null }) {
  const from = toMs(start)
  const to = toMs(end)
  return (appointments ?? []).filter(
    (a) =>
      a.id !== ignoreId &&
      consumesCapacity(a.status) &&
      resourceFor(a.task_type) === resource &&
      overlaps(from, to, toMs(a.scheduled_start), toMs(a.scheduled_end)),
  ).length
}

/* ------------------------------------------------------------ presentation */

/* Status tone + shape + label, exactly as cardStatus does it, so an
   appointment's state never depends on colour alone (constraint 9). */
export const APPOINTMENT_STATUS = {
  proposed: { label: 'Proposed', tone: 'neutral', shape: 'square' },
  booked: { label: 'Booked', tone: 'action', shape: 'round' },
  in_progress: { label: 'In progress', tone: 'progress', shape: 'diamond' },
  done: { label: 'Done', tone: 'done', shape: 'ring' },
  cancelled: { label: 'Cancelled', tone: 'error', shape: 'bar' },
}

export const APPOINTMENT_STATUS_ORDER = Object.keys(APPOINTMENT_STATUS)

export function appointmentStatusMeta(status) {
  return APPOINTMENT_STATUS[status] ?? { label: status ?? '—', tone: 'neutral', shape: 'square' }
}

/* Where an appointment sits relative to `now`. Explicit now, per constraint 6.
   A job inside its own window is running, not late — "overdue" is reserved for
   one whose end has passed without being done. */
export function appointmentPhase(appointment, now) {
  if (appointment?.status === 'done') return 'done'
  if (appointment?.status === 'cancelled') return 'cancelled'
  if (appointment?.status === 'in_progress') return 'in_progress'

  const start = toMs(appointment?.scheduled_start)
  const end = toMs(appointment?.scheduled_end)
  const at = toMs(now)
  if (!Number.isFinite(start) || !Number.isFinite(at)) return 'upcoming'
  if (at < start) return 'upcoming'
  if (Number.isFinite(end) && at <= end) return 'in_progress'
  return 'overdue'
}

/* Dated order for the board. Ties break by id so the order is stable and two
   renders of the same data cannot swap rows. */
export function sortByStart(appointments) {
  return [...(appointments ?? [])].sort((a, b) => {
    const d = toMs(a.scheduled_start) - toMs(b.scheduled_start)
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id))
  })
}

/* Local calendar day of a time, as `YYYY-MM-DD`. The board groups by this;
   `now` is still explicit because the caller decides which day is "today". */
export function dayKey(value) {
  const t = toMs(value)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function groupByDay(appointments) {
  const out = new Map()
  for (const a of sortByStart(appointments)) {
    const key = dayKey(a.scheduled_start) ?? 'unscheduled'
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(a)
  }
  return out
}
