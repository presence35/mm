import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RESOURCES,
  TASK_TYPES,
  resourceFor,
  durationMinutesFor,
  defaultEnd,
  nextAppointmentStatuses,
  canTransition,
  consumesCapacity,
  validateAppointment,
  capacityCheck,
  loadInWindow,
  appointmentPhase,
  appointmentStatusMeta,
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_ORDER,
  sortByStart,
  groupByDay,
  dayKey,
} from './schedule.js'

const at = (hhmm, day = '2026-10-12') => `${day}T${hhmm}:00.000Z`

const appt = (over = {}) => ({
  id: 'a1',
  task_type: 'drop_off',
  scheduled_start: at('10:00'),
  scheduled_end: at('10:45'),
  status: 'booked',
  ...over,
})

/* ------------------------------------------------------------- the registry */

test('every task type names a resource that actually exists', () => {
  for (const t of TASK_TYPES) {
    assert.ok(RESOURCES[t.resource], `${t.value} → ${t.resource}`)
    assert.ok(t.minutes > 0, t.value)
  }
})

/* The decision: drop-off, pickup and ramp-use share one physical pool. If
   someone "fixes" this by giving each its own resource, this test fails and
   says why. */
test('drop-off, pickup and ramp-use share the ramp pool', () => {
  assert.equal(resourceFor('drop_off'), 'ramp')
  assert.equal(resourceFor('pickup'), 'ramp')
  assert.equal(resourceFor('ramp'), 'ramp')
})

test('cleaning and repair do not contend with the ramp', () => {
  assert.notEqual(resourceFor('cleaning'), resourceFor('repair'))
  assert.notEqual(resourceFor('cleaning'), 'ramp')
  assert.notEqual(resourceFor('repair'), 'ramp')
})

/* ------------------------------------------------------------ transitions */

test('an appointment walks proposed → booked → in_progress → done', () => {
  assert.ok(canTransition('proposed', 'booked'))
  assert.ok(canTransition('booked', 'in_progress'))
  assert.ok(canTransition('in_progress', 'done'))
})

test('a booked or proposed appointment can be cancelled, a finished one cannot', () => {
  assert.ok(canTransition('proposed', 'cancelled'))
  assert.ok(canTransition('booked', 'cancelled'))
  assert.ok(!canTransition('done', 'cancelled'))
  assert.ok(!canTransition('cancelled', 'booked'))
})

test('stages cannot be skipped', () => {
  assert.ok(!canTransition('proposed', 'in_progress'))
  assert.ok(!canTransition('proposed', 'done'))
  assert.ok(!canTransition('booked', 'done'))
})

test('terminal states stay terminal and unknown states move nowhere', () => {
  assert.deepEqual(nextAppointmentStatuses('done'), [])
  assert.deepEqual(nextAppointmentStatuses('cancelled'), [])
  assert.deepEqual(nextAppointmentStatuses('bogus'), [])
})

/* A proposal reserves nothing — that is what lets office hold three options
   for one customer without any of them blocking the ramp. */
test('only booked and in_progress consume capacity', () => {
  assert.ok(consumesCapacity('booked'))
  assert.ok(consumesCapacity('in_progress'))
  assert.ok(!consumesCapacity('proposed'))
  assert.ok(!consumesCapacity('cancelled'))
  assert.ok(!consumesCapacity('done'))
})

/* ----------------------------------------------------------- validation */

test('an appointment must have a real task type and an end after its start', () => {
  assert.deepEqual(validateAppointment(appt()), [])
  assert.deepEqual(validateAppointment(appt({ task_type: 'nonsense' })), ['unknown_task_type'])
  assert.deepEqual(validateAppointment(appt({ scheduled_end: at('09:00') })), ['end_not_after_start'])
  assert.deepEqual(validateAppointment(appt({ scheduled_end: at('10:00') })), ['end_not_after_start'])
  assert.ok(validateAppointment(appt({ scheduled_start: 'not-a-time' })).includes('start_not_a_time'))
})

test('the nominal duration prefills an end time', () => {
  assert.equal(durationMinutesFor('cleaning'), 120)
  assert.equal(defaultEnd(at('09:00'), 'cleaning'), at('11:00'))
  assert.equal(defaultEnd('not-a-time', 'cleaning'), null)
})

/* -------------------------------------------------------------- capacity */

test('the ramp holds one: a second overlapping job is refused, and says why', () => {
  const existing = [appt({ id: 'a1' })]
  const verdict = capacityCheck({
    appointments: existing,
    candidate: appt({ id: 'a2', scheduled_start: at('10:30'), scheduled_end: at('11:15') }),
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'capacity_full')
  assert.equal(verdict.resource, 'ramp')
  assert.equal(verdict.clashing.length, 1)
})

test('a non-overlapping job on the same resource is allowed', () => {
  const verdict = capacityCheck({
    appointments: [appt({ id: 'a1' })],
    candidate: appt({ id: 'a2', scheduled_start: at('10:45'), scheduled_end: at('11:30') }),
  })
  assert.equal(verdict.ok, true)
})

/* Half-open intervals: the ramp is free at the instant the last job ends. */
test('back-to-back jobs do not clash', () => {
  const verdict = capacityCheck({
    appointments: [appt({ id: 'a1', scheduled_start: at('10:00'), scheduled_end: at('10:45') })],
    candidate: appt({ id: 'a2', scheduled_start: at('10:45'), scheduled_end: at('11:30') }),
  })
  assert.equal(verdict.ok, true)
})

test('a drop-off blocks a ramp booking, which is the whole point of sharing', () => {
  const verdict = capacityCheck({
    appointments: [appt({ id: 'a1', task_type: 'drop_off' })],
    candidate: appt({ id: 'a2', task_type: 'ramp' }),
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'capacity_full')
})

test('a proposal in the same window does not block a booking', () => {
  const verdict = capacityCheck({
    appointments: [appt({ id: 'a1', status: 'proposed' })],
    candidate: appt({ id: 'a2' }),
  })
  assert.equal(verdict.ok, true)
})

test('a cancelled job frees its capacity', () => {
  const verdict = capacityCheck({
    appointments: [appt({ id: 'a1', status: 'cancelled' })],
    candidate: appt({ id: 'a2' }),
  })
  assert.equal(verdict.ok, true)
})

test('different resources do not contend', () => {
  const verdict = capacityCheck({
    appointments: [appt({ id: 'a1', task_type: 'ramp', scheduled_start: at('09:00'), scheduled_end: at('12:00') })],
    candidate: appt({ id: 'a2', task_type: 'cleaning', scheduled_start: at('10:00'), scheduled_end: at('11:00') }),
  })
  assert.equal(verdict.ok, true)
})

test('a resource with spare capacity accepts until it is full', () => {
  const bookings = [
    appt({ id: 'a1', task_type: 'repair' }),
    appt({ id: 'a2', task_type: 'repair' }),
    appt({ id: 'a3', task_type: 'repair' }),
  ]
  /* shop_bay holds 3, so the fourth overlapping job is the one refused. */
  assert.equal(RESOURCES.shop_bay.capacity, 3)
  assert.equal(capacityCheck({ appointments: bookings, candidate: appt({ id: 'a9', task_type: 'repair' }) }).ok, false)
  const twoOnly = bookings.slice(0, 2)
  assert.equal(capacityCheck({ appointments: twoOnly, candidate: appt({ id: 'a9', task_type: 'repair' }) }).ok, true)
})

test('editing a booking does not count it as clashing with itself', () => {
  const existing = [appt({ id: 'a1' })]
  const moved = appt({ id: 'a1', scheduled_start: at('10:15'), scheduled_end: at('11:00') })
  assert.equal(capacityCheck({ appointments: existing, candidate: moved }).ok, false)
  assert.equal(capacityCheck({ appointments: existing, candidate: moved, ignoreId: 'a1' }).ok, true)
})

test('an over-capacity board stays visible rather than being forgiven', () => {
  const double = [appt({ id: 'a1' }), appt({ id: 'a2' })]
  /* Both already hold the one ramp. A third must be refused, and the count of
     what is already booked must be reported, not hidden. */
  const verdict = capacityCheck({ appointments: double, candidate: appt({ id: 'a3' }) })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.clashing.length, 2)
})

test('an invalid appointment is refused before capacity is even considered', () => {
  const verdict = capacityCheck({ appointments: [], candidate: appt({ scheduled_end: at('09:00') }) })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'end_not_after_start')
})

test('loadInWindow reports what is already on a resource', () => {
  const bookings = [appt({ id: 'a1' }), appt({ id: 'a2', status: 'cancelled' })]
  assert.equal(loadInWindow({ appointments: bookings, resource: 'ramp', start: at('10:00'), end: at('10:45') }), 1)
})

/* ---------------------------------------------------------- presentation */

const NOW = '2026-10-12T12:00:00.000Z'

test('every appointment status pairs colour with a label and a shape', () => {
  for (const s of APPOINTMENT_STATUS_ORDER) {
    const m = APPOINTMENT_STATUS[s]
    assert.ok(m.label, s)
    assert.ok(m.tone, s)
    assert.ok(m.shape, s)
  }
})

test('status meta falls back rather than throwing on an unknown status', () => {
  assert.equal(appointmentStatusMeta('bogus').tone, 'neutral')
  assert.equal(appointmentStatusMeta(undefined).label, '—')
})

test('phase is read against an explicit now, never an implicit clock', () => {
  assert.equal(appointmentPhase(appt({ scheduled_start: at('14:00'), scheduled_end: at('15:00') }), NOW), 'upcoming')
  assert.equal(appointmentPhase(appt({ status: 'in_progress' }), NOW), 'in_progress')
  assert.equal(appointmentPhase(appt(), NOW), 'overdue')
  assert.equal(appointmentPhase(appt({ status: 'done' }), NOW), 'done')
  assert.equal(appointmentPhase(appt({ status: 'cancelled' }), NOW), 'cancelled')
})

test('the board sorts by start and breaks ties stably by id', () => {
  const rows = [
    appt({ id: 'b', scheduled_start: at('09:00') }),
    appt({ id: 'a', scheduled_start: at('09:00') }),
    appt({ id: 'c', scheduled_start: at('08:00') }),
  ]
  assert.deepEqual(
    sortByStart(rows).map((r) => r.id),
    ['c', 'a', 'b'],
  )
  /* The input order must not leak through. */
  assert.deepEqual(
    sortByStart([...rows].reverse()).map((r) => r.id),
    ['c', 'a', 'b'],
  )
})

test('day grouping keys off the local calendar day, with a fallback for junk', () => {
  assert.equal(dayKey('not-a-time'), null)
  const groups = groupByDay([appt({ id: 'a1' }), appt({ id: 'a2', scheduled_start: at('09:00', '2026-10-13') })])
  assert.deepEqual([...groups.keys()], ['2026-10-12', '2026-10-13'])
})
