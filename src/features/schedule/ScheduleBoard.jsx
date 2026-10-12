import { useMemo, useState } from 'react'
import { Button, Card, EmptyState, SelectField, Sheet, StatusPill, TextField } from '../../ui'
import {
  RESOURCES,
  TASK_TYPES,
  appointmentStatusMeta,
  nextAppointmentStatuses,
  groupByDay,
  resourceFor,
  defaultEnd,
  durationMinutesFor,
  taskLabel,
  appointmentPhase,
} from '../../domain/schedule.js'

/*
 * The schedule board.
 *
 * Presentation only: rows arrive joined and ready, every write goes back out
 * through the actions handed in, and no capacity rule is re-derived here. The
 * board shows a refusal it is given; it does not decide one.
 */

const pad = (n) => String(n).padStart(2, '0')

const toLocalInput = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const formatRange = (start, end) => {
  const a = new Date(start)
  const b = new Date(end)
  if (Number.isNaN(a.getTime())) return 'No time set'
  const left = `${pad(a.getHours())}:${pad(a.getMinutes())}`
  if (Number.isNaN(b.getTime())) return left
  return `${left}–${pad(b.getHours())}:${pad(b.getMinutes())}`
}

const formatDayHeading = (key) => {
  if (key === 'unscheduled') return 'No date'
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function ScheduleBoard({ rows, cards, now, canBook, onSave, onTransition, selectedCardId }) {
  const [composing, setComposing] = useState(false)
  const [refusal, setRefusal] = useState(null)

  const days = useMemo(() => [...groupByDay(rows.map((r) => r.appointment))], [rows])
  const byId = useMemo(() => new Map(rows.map((r) => [r.appointment.id, r])), [rows])

  const move = (appointment, status) => {
    const outcome = onTransition(appointment, status)
    if (outcome && !outcome.ok) setRefusal(outcome.reason)
    else setRefusal(null)
  }

  const newButton = (
    <Button fullWidth icon="plus" disabled={!canBook} onClick={() => setComposing(true)}>
      New appointment
    </Button>
  )

  return (
    <div>
      <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        {newButton}
        {!canBook ? (
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-2)' }}>
            Booking needs a connection and an office or admin role. Two phones booking the ramp with no signal is the
            case this avoids.
          </p>
        ) : null}
        {refusal ? (
          <p role="alert" style={{ font: 'var(--body-m)', color: 'var(--on-error-container)', background: 'var(--error-container)', padding: 'var(--space-3)', borderRadius: 'var(--corner-m)', marginTop: 'var(--space-3)' }}>
            {refusal}
          </p>
        ) : null}
      </div>

      {!rows.length ? (
        <EmptyState
          icon="calendar"
          title="Nothing scheduled"
          body="Drop-offs, cleaning, repair, pickup and ramp use all live here, so the yard only has one calendar to read."
        />
      ) : (
        days.map(([key, appointments]) => (
          <section key={key}>
            <div className="section-head">
              {formatDayHeading(key)} · {appointments.length}
            </div>
            <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {appointments.map((appointment) => {
                const row = byId.get(appointment.id) ?? { appointment }
                const meta = appointmentStatusMeta(appointment.status)
                const resource = RESOURCES[resourceFor(appointment.task_type)]
                const moves = nextAppointmentStatuses(appointment.status)
                const phase = appointmentPhase(appointment, now)
                return (
                  <Card key={appointment.id} variant="outlined">
                    <div className="list-item" style={{ cursor: 'default' }}>
                      <span className="list-item__text">
                        <span className="list-item__title">
                          {formatRange(appointment.scheduled_start, appointment.scheduled_end)} · {taskLabel(appointment.task_type)}
                        </span>
                        <span className="list-item__support">
                          {[row.boat?.name || row.boat?.model, row.customer?.name, resource?.label]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {phase === 'overdue' ? <span className="list-item__support">Scheduled time has passed</span> : null}
                        {phase === 'in_progress' ? <span className="list-item__support">Happening now</span> : null}
                        {appointment.notes ? <span className="list-item__support">{appointment.notes}</span> : null}
                      </span>
                      <span className="list-item__trailing">
                        <StatusPill tone={meta.tone} shape={meta.shape}>
                          {meta.label}
                        </StatusPill>
                      </span>
                    </div>

                    {canBook && moves.length ? (
                      <div className="row" style={{ gap: 'var(--space-2)', padding: '0 var(--space-4) var(--space-3)', flexWrap: 'wrap' }}>
                        {moves.map((s) => (
                          <Button key={s} variant="text" size="sm" onClick={() => move(appointment, s)}>
                            {appointmentStatusMeta(s).label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                )
              })}
            </div>
          </section>
        ))
      )}

      <ComposeSheet
        open={composing}
        cards={cards}
        selectedCardId={selectedCardId}
        onDismiss={() => setComposing(false)}
        onSave={(fields) => {
          const outcome = onSave(fields)
          if (outcome && !outcome.ok) {
            setRefusal(outcome.reason)
            return false
          }
          setRefusal(null)
          setComposing(false)
          return true
        }}
      />
    </div>
  )
}

function ComposeSheet({ open, cards, selectedCardId, onDismiss, onSave }) {
  const [taskType, setTaskType] = useState('drop_off')
  const [cardId, setCardId] = useState(selectedCardId ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [notes, setNotes] = useState('')

  if (!open) return null

  const startIso = start ? new Date(start).toISOString() : null
  const endIso = end ? new Date(end).toISOString() : startIso ? defaultEnd(startIso, taskType) : null

  const pickStart = (value) => {
    setStart(value)
    /* Prefill the end from the task's nominal duration, and let it be changed:
       the duration is a default, not a rule. */
    setEnd(value ? toLocalInput(defaultEnd(new Date(value).toISOString(), taskType)) : '')
  }

  const pickTask = (value) => {
    setTaskType(value)
    if (start) setEnd(toLocalInput(defaultEnd(new Date(start).toISOString(), value)))
  }

  const chosen = cards.find((c) => c.id === cardId)

  const submit = () => {
    onSave({
      card_id: cardId || null,
      boat_id: chosen?.boat_id ?? null,
      customer_id: chosen?.customer_id ?? null,
      task_type: taskType,
      scheduled_start: startIso,
      scheduled_end: endIso,
      status: 'booked',
      notes: notes.trim() || null,
    })
  }

  return (
    <Sheet open={open} title="New appointment" onDismiss={onDismiss}>
      <div style={{ padding: '0 var(--space-2)' }}>
        <SelectField
          label="Task"
          value={taskType}
          onChange={pickTask}
          options={TASK_TYPES.map((t) => ({ value: t.value, label: `${t.label} · ${RESOURCES[t.resource].label}` }))}
        />
        <SelectField
          label="Card"
          value={cardId}
          onChange={setCardId}
          options={[{ value: '', label: 'No card' }, ...cards.map((c) => ({ value: c.id, label: c.work_order_no }))]}
        />
        <TextField label="Starts" type="datetime-local" value={start} onChange={pickStart} required />
        <TextField label="Ends" type="datetime-local" value={end} onChange={setEnd} />
        <TextField label="Notes" value={notes} onChange={setNotes} multiline />
      </div>
      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-5)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <Button variant="text" onClick={onDismiss}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!cardId || !start}>
          Book it
        </Button>
      </div>
      <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-5)' }}>
        Booking a {taskLabel(taskType).toLowerCase()} takes the {RESOURCES[resourceFor(taskType)].label.toLowerCase()} for
        about {durationMinutesFor(taskType)} minutes. Capacity is checked when you book.
      </p>
    </Sheet>
  )
}
