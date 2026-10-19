import { useEffect, useRef, useState } from 'react'
import { Button, TextField, SelectField, KeyValue, Divider, ListItem, Snackbar, Dialog, StatusPill } from '../../ui'
import { useRouter } from '../../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../../engines/auth/AuthProvider.jsx'
import { useSync } from '../../engines/sync/SyncProvider.jsx'
import * as store from '../../engines/store/localStore.js'
import { statusMeta, stageFraction } from '../../domain/cardStatus.js'
import { locationSummary } from '../../domain/storageLocation.js'

/*
 * A boat's own record: what it is, its serials, and who is working on it.
 *
 * Editing is office/admin only and, per behaviours-auth.md constraint 5, never
 * queues offline — a cached permission snapshot may predate a demotion, and a
 * boat record is not something a dock should be able to rewrite without a
 * server. A mechanic reads this screen and changes nothing.
 *
 * The rule the legacy app enforced is kept: a boat needs a name or a model. An
 * unnamed boat with no model is not findable in a list of two hundred.
 *
 * `type` on a serial is free text rather than a fixed list, exactly as the
 * legacy app had it: engine and hull numbers are recorded against whatever name
 * the supplier used, and an enum would refuse the real answer.
 */

const RATE_TYPES = [
  { value: 'SW', label: 'SW' },
  { value: 'DW', label: 'DW' },
]

const text = (v) => (v === null || v === undefined ? '' : String(v))

const draftOf = (boat) => ({
  name: text(boat.name),
  model: text(boat.model),
  motor_type: text(boat.motor_type),
  licence: text(boat.licence),
  trailer_licence: text(boat.trailer_licence),
  rate_type: boat.rate_type || 'SW',
  length_ft: boat.length_ft === null || boat.length_ft === undefined ? '' : String(boat.length_ft),
})

const serialDrafts = (serials) =>
  (serials ?? []).map((s) => ({
    id: s.id,
    type: text(s.type) || 'engine',
    serial_number: text(s.serial_number),
    notes: text(s.notes),
  }))

const serialKey = (rows) => JSON.stringify(rows.map((r) => [r.type, r.serial_number, r.notes]))

/* Dirty means "differs from what is stored" — compared field by field and then
   row by row, the same rule the legacy app used before it let the router drop
   unsaved work. */
function isDirty(draft, serials, boat, storedSerials) {
  const same = (a, b) => text(a) === text(b)
  const fieldsDiffer =
    !same(draft.name, boat.name) ||
    !same(draft.model, boat.model) ||
    !same(draft.motor_type, boat.motor_type) ||
    !same(draft.licence, boat.licence) ||
    !same(draft.trailer_licence, boat.trailer_licence) ||
    !same(draft.rate_type, boat.rate_type ?? 'SW') ||
    !same(draft.length_ft === '' ? null : Number(draft.length_ft), boat.length_ft)

  return fieldsDiffer || serialKey(serials) !== serialKey(serialDrafts(storedSerials))
}

export default function BoatEdit({ record }) {
  const { navigate, setDirty } = useRouter()
  const { may, refuseReason, employee: me } = useAuth()
  const sync = useSync()

  const { boat, customer, card, serials, assignments } = record

  const [draft, setDraft] = useState(() => draftOf(boat))
  const [draftSerials, setDraftSerials] = useState(() => serialDrafts(serials))
  const [error, setError] = useState(null)
  const [blocked, setBlocked] = useState(null)
  const [saved, setSaved] = useState(null)

  const canEdit = may(CAPABILITIES.EDIT_BOAT)

  const dirty = isDirty(draft, draftSerials, boat, serials)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  /* After a save the store hands back the row we just wrote, and the draft it
     matches. A sync that replaces the boat underneath a half-finished edit is a
     different matter: that draft is left alone, because throwing away typed work
     to show a row that arrived over the air is the worse of the two. */
  const storedKey = `${boat.id}:${boat.version ?? 0}:${boat.updated_at ?? ''}`
  useEffect(() => {
    if (dirtyRef.current) return
    setDraft(draftOf(boat))
    setDraftSerials(serialDrafts(serials))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey])

  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])

  const set = (field, value) => setDraft((d) => ({ ...d, [field]: value }))
  const setSerial = (i, patch) => setDraftSerials((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const save = () => {
    if (!may(CAPABILITIES.EDIT_BOAT)) {
      setBlocked(refuseReason(CAPABILITIES.EDIT_BOAT))
      return
    }
    if (!draft.name.trim() && !draft.model.trim()) {
      setError('Give the boat a name or a model before saving.')
      return
    }
    setError(null)
    const length = Number.parseFloat(draft.length_ft)
    store.updateBoat(boat.id, {
      name: draft.name.trim() || null,
      model: draft.model.trim() || null,
      motor_type: draft.motor_type.trim() || null,
      licence: draft.licence.trim() || null,
      trailer_licence: draft.trailer_licence.trim() || null,
      rate_type: draft.rate_type || 'SW',
      length_ft: Number.isFinite(length) && length > 0 ? length : null,
    })
    /* Rows with no number are dropped, as the legacy app dropped them: an empty
       serial row is a row somebody started and did not finish. */
    store.setBoatSerials(
      boat.id,
      draftSerials
        .filter((s) => s.serial_number.trim())
        .map((s) => ({ ...s, serial_number: s.serial_number.trim(), notes: s.notes.trim() || null })),
    )
    setSaved('Boat updated')
  }

  const toggleAssignment = (person) => {
    if (!may(CAPABILITIES.ASSIGN_BOAT)) {
      setBlocked(refuseReason(CAPABILITIES.ASSIGN_BOAT))
      return
    }
    if (assignments.some((a) => a.employee_id === person.id)) store.removeAssignment(boat.id, person.id)
    else store.addAssignment(boat.id, person.id, me?.id ?? null)
  }

  const staff = store.listAssignableStaff()
  const meta = card ? statusMeta(card.status) : null

  return (
    <div>
      <KeyValue
        rows={[
          { k: 'Owner', v: customer?.name },
          { k: 'Length', v: boat.length_ft ? `${boat.length_ft} ft` : null },
          { k: 'Rate', v: boat.rate_type },
        ]}
      />

      {card ? (
        <ListItem
          icon="cards"
          title={`${card.work_order_no} · ${locationSummary(card)}`}
          support="Open the service card"
          onClick={() => navigate('card', { id: card.id })}
          trailing={
            <StatusPill tone={meta.tone} variant="quiet" progress={stageFraction(card.status)}>
              {meta.label}
            </StatusPill>
          }
        />
      ) : (
        <ListItem
          icon="users"
          title="No open card"
          support={customer ? `Open ${customer.name}` : undefined}
          onClick={customer ? () => navigate('people-detail', { id: customer.id }) : undefined}
        />
      )}

      <Divider />

      <div className="section-head">Boat</div>
      {canEdit ? (
        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
          <TextField label="Name" value={draft.name} onChange={(v) => set('name', v)} error={error ?? undefined} />
          <TextField label="Model" value={draft.model} onChange={(v) => set('model', v)} />
          <TextField label="Motor" value={draft.motor_type} onChange={(v) => set('motor_type', v)} />
          <TextField label="Licence" value={draft.licence} onChange={(v) => set('licence', v)} />
          <TextField label="Trailer licence" value={draft.trailer_licence} onChange={(v) => set('trailer_licence', v)} />
          <TextField label="Length (ft)" inputMode="decimal" value={draft.length_ft} onChange={(v) => set('length_ft', v)} />
          <SelectField label="Rate type" value={draft.rate_type} onChange={(v) => set('rate_type', v)} options={RATE_TYPES} />
        </div>
      ) : (
        <KeyValue
          rows={[
            { k: 'Name', v: boat.name },
            { k: 'Model', v: boat.model },
            { k: 'Motor', v: boat.motor_type },
            { k: 'Licence', v: boat.licence },
            { k: 'Trailer licence', v: boat.trailer_licence },
          ]}
        />
      )}

      <div className="section-head">Serial numbers</div>
      {canEdit ? (
        <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
          {draftSerials.map((s, i) => (
            <div key={s.id ?? `new-${i}`} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <TextField label={`Type ${i + 1}`} value={s.type} onChange={(v) => setSerial(i, { type: v })} />
                <TextField
                  label="Serial number"
                  value={s.serial_number}
                  onChange={(v) => setSerial(i, { serial_number: v })}
                />
                <TextField label="Notes" value={s.notes} onChange={(v) => setSerial(i, { notes: v })} />
              </div>
              <Button
                variant="text"
                size="sm"
                icon="trash"
                aria-label={`Remove serial ${i + 1}`}
                onClick={() => setDraftSerials((rows) => rows.filter((_, idx) => idx !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="tonal"
            fullWidth
            icon="plus"
            onClick={() => setDraftSerials((rows) => [...rows, { type: 'engine', serial_number: '', notes: '' }])}
          >
            Add serial
          </Button>
        </div>
      ) : !serials.length ? (
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>
          No serial numbers recorded.
        </p>
      ) : (
        serials.map((s) => (
          <ListItem key={s.id} title={s.type || 'Serial'} support={[s.serial_number, s.notes].filter(Boolean).join(' · ')} />
        ))
      )}

      <Divider />

      <div className="section-head">Assigned to</div>
      {!staff.length ? (
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>
          No active mechanics on this device yet. The roster arrives with the first sync.
        </p>
      ) : (
        staff.map((person) => {
          const assigned = assignments.some((a) => a.employee_id === person.id)
          return (
            <ListItem
              key={person.id}
              icon="users"
              title={person.name}
              support={person.role}
              /* The row is not clickable and carries exactly one control: a chip
                 cannot sit inside a clickable row, because the row is itself a
                 button and a button inside a button is invalid and unreachable
                 by keyboard. */
              trailing={
                <Button
                  variant={assigned ? 'tonal' : 'text'}
                  size="sm"
                  onClick={() => toggleAssignment(person)}
                >
                  {assigned ? 'Unassign' : 'Assign'}
                </Button>
              }
            />
          )
        })
      )}

      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        {/* Disabled only for "there is nothing to save". A button that refuses
            because of the role stays pressable and says why — see save(). */}
        <Button fullWidth disabled={!dirty} onClick={save}>
          Save changes
        </Button>
      </div>

      {sync.state === 'offline' ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-5)' }}>
          Editing a boat needs a connection. Everything already on this device stays readable offline.
        </p>
      ) : null}

      <Snackbar message={saved} onDismiss={() => setSaved(null)} />
      <Dialog
        open={Boolean(blocked)}
        title="Can't change this boat"
        body={blocked}
        onDismiss={() => setBlocked(null)}
        actions={<Button onClick={() => setBlocked(null)}>Got it</Button>}
      />
    </div>
  )
}
