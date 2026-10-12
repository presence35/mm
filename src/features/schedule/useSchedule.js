import { useCallback, useEffect, useState } from 'react'
import * as store from '../../engines/store/localStore.js'
import { useAuth, CAPABILITIES } from '../../engines/auth/AuthProvider.jsx'
import {
  RESOURCES,
  validateAppointment,
  capacityCheck,
  consumesCapacity,
  canTransition,
} from '../../domain/schedule.js'

/*
 * Schedule data access.
 *
 * Screens compose this and never touch the store. The capability gate lives in
 * useScheduleActions rather than in the board, so there is exactly one place
 * that can let a booking through — and it is the same place the server checks.
 */

function decorate(appointment) {
  const record = appointment.card_id ? store.getCard(appointment.card_id) : null
  return {
    appointment,
    card: record?.card ?? null,
    boat: record?.boat ?? null,
    customer: record?.customer ?? null,
  }
}

export function useSchedule({ cardId = null } = {}) {
  const read = useCallback(() => store.listAppointments({ cardId }).map(decorate), [cardId])
  const [rows, setRows] = useState(read)

  useEffect(() => {
    setRows(read())
    return store.subscribe(() => setRows(read()))
  }, [read])

  return rows
}

const PROBLEM_COPY = {
  unknown_task_type: 'Choose what kind of appointment this is.',
  start_not_a_time: 'Enter a start time.',
  end_not_a_time: 'Enter an end time.',
  end_not_after_start: 'The end time has to be after the start time.',
  unknown_resource: 'That kind of appointment has no resource assigned to it yet.',
}

function capacityCopy(verdict) {
  const label = RESOURCES[verdict.resource]?.label ?? 'That resource'
  return `${label} is already taken for that window (${verdict.clashing.length} of ${verdict.capacity} in use). Pick another time.`
}

export function useScheduleActions() {
  const { may, refuseReason } = useAuth()

  /* A booking is an office/admin action and never queues offline, so this is
     the single gate — the auth layer already refuses from a stale snapshot. */
  const guard = useCallback(() => {
    if (may(CAPABILITIES.BOOK_APPOINTMENT)) return null
    return { ok: false, reason: refuseReason(CAPABILITIES.BOOK_APPOINTMENT) }
  }, [may, refuseReason])

  const save = useCallback(
    (fields) => {
      const denied = guard()
      if (denied) return denied

      const problems = validateAppointment(fields)
      if (problems.length) return { ok: false, reason: PROBLEM_COPY[problems[0]] ?? 'That appointment is not valid.' }

      if (consumesCapacity(fields.status)) {
        const verdict = capacityCheck({
          appointments: store.listAppointments(),
          candidate: fields,
          ignoreId: fields.id ?? null,
        })
        if (!verdict.ok) return { ok: false, reason: capacityCopy(verdict) }
      }

      return { ok: true, appointment: store.putAppointment(fields) }
    },
    [guard],
  )

  /* Legality first, capacity second: a move that is illegal from this state is
     an error in the caller, not a booking problem, and must not be reported as
     one. */
  const transition = useCallback(
    (appointment, status) => {
      const denied = guard()
      if (denied) return denied

      if (!canTransition(appointment.status, status)) {
        return { ok: false, reason: `An appointment that is ${appointment.status} cannot be ${status}.` }
      }

      if (consumesCapacity(status)) {
        const verdict = capacityCheck({
          appointments: store.listAppointments(),
          candidate: { ...appointment, status },
          ignoreId: appointment.id,
        })
        if (!verdict.ok) return { ok: false, reason: capacityCopy(verdict) }
      }

      store.putAppointment({ ...appointment, status })
      return { ok: true }
    },
    [guard],
  )

  return { save, transition }
}
