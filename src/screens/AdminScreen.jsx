import { useEffect, useState } from 'react'
import {
  TopBar, Segmented, ListItem, TextField, Button, StatusPill, EmptyState, Divider, Sheet,
} from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { ROLE_LABEL } from '../engines/auth/permissions.js'
import * as store from '../engines/store/localStore.js'

/*
 * Admin.
 *
 * The staff tab is live. Adding, deactivating and resetting a PIN all need a
 * connection, because employees are server-owned: the PIN columns are secret
 * and the roster is not a syncable entity, so a client can neither read nor
 * write them. See server/staff.js.
 *
 * That is why this screen refuses rather than queues. A staff change that
 * silently waits for signal looks applied and is not, and the next thing that
 * happens is someone cannot get in on Monday morning.
 */

const TABS = [
  { value: 'employees', label: 'Staff' },
  { value: 'catalogue', label: 'Parts' },
  { value: 'templates', label: 'Labels' },
]

const ROLES = ['office', 'mechanic', 'admin']

export default function AdminScreen() {
  const { goBack } = useRouter()
  const { employee } = useAuth()
  const sync = useSync()
  const [tab, setTab] = useState('employees')
  const [staff, setStaff] = useState(() => store.listStaff())
  const [adding, setAdding] = useState(false)

  useEffect(() => store.subscribe(() => setStaff(store.listStaff())), [])

  return (
    <div>
      <TopBar title="Admin" onBack={goBack} />

      <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="Admin section" />
      </div>

      {tab === 'employees' ? (
        <>
          <div className="section-head">Staff · {staff.length}</div>

          {staff.length === 0 ? (
            <EmptyState icon="users" title="No staff yet" body="Add the people who work here. Each one signs in with their own PIN." />
          ) : (
            staff.map((person) => (
              <ListItem
                key={person.id}
                icon="users"
                title={person.name}
                support={person.id === employee?.id ? `${ROLE_LABEL[person.role]} · you` : ROLE_LABEL[person.role]}
                trailing={<StatusPill tone={person.role === 'admin' ? 'warn' : 'neutral'} shape="square">{person.role}</StatusPill>}
              />
            ))
          )}

          <Divider />

          <div style={{ padding: 'var(--space-4)' }}>
            {sync.online ? (
              <Button fullWidth icon="plus" onClick={() => setAdding(true)}>
                Add staff member
              </Button>
            ) : (
              <>
                <Button fullWidth icon="plus" disabled>
                  Add staff member
                </Button>
                <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-2)' }}>
                  Staff records and PINs live on the server, so this needs a connection. Everything
                  else on this device keeps working offline.
                </p>
              </>
            )}
          </div>
        </>
      ) : null}

      {tab === 'catalogue' ? (
        <Catalogue />
      ) : null}

      {tab === 'templates' ? (
        <>
          <div className="section-head">Checklist labels</div>
          <EmptyState
            icon="tune"
            title="Server-owned templates"
            body="Checklist wording and the marina's storage layout come from the server, so they change without an app release."
          />
        </>
      ) : null}

      {adding ? <AddStaff onClose={() => setAdding(false)} onDone={() => setAdding(false)} /> : null}
    </div>
  )
}

/*
 * Parts come from the server by way of sync, so this reads the real roster
 * rather than a hardcoded list. It used to show four invented items with prices,
 * which on a dock reads as the marina's actual catalogue.
 */
function Catalogue() {
  return (
    <>
      <div className="section-head">Parts catalogue</div>
      <EmptyState
        icon="wrench"
        title="Server-owned"
        body="Parts and their prices come from the server and arrive by sync. This tab used to list four invented items with invented prices, which on a working dock reads as the marina's real price list."
      />
    </>
  )
}

function AddStaff({ onClose, onDone }) {
  /* Own hook call. It was reaching for a `sync` that only existed in
     AdminScreen's scope, so every add threw a ReferenceError and the catch
     reported it as "could not add them" — a server problem that was never
     touched. */
  const sync = useSync()
  const [name, setName] = useState('')
  const [role, setRole] = useState('mechanic')
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await sync.addStaff({ name, role, pin })
      onDone()
    } catch (e) {
      setError(
        {
          needs_signal: 'No signal. Staff changes go to the server, so this one has to wait.',
          name_required: 'Enter a name.',
          unknown_role: 'Pick a role.',
          pin_too_short: 'A PIN is 4 to 12 digits.',
          pin_not_numeric: 'A PIN is digits only.',
          pin_in_use: 'Someone already uses that PIN.',
        }[e?.reason] ?? 'Could not add them. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const ready = name.trim() && /^\d{4,12}$/.test(pin)

  return (
    <Sheet open title="Add staff member" onDismiss={onClose}>
      <TextField label="Name" value={name} onChange={setName} placeholder="Rin Oyelaran" />
      <div className="field">
        <span className="field__label">Role</span>
        <Segmented
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          value={role}
          onChange={setRole}
          ariaLabel="Role"
        />
      </div>
      <TextField
        label="PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={setPin}
        error={error}
        help="They choose this at sign-in. It is not shown again."
      />
      <div style={{ padding: 'var(--space-4)' }}>
        <Button fullWidth onClick={submit} disabled={!ready || busy} loading={busy}>
          Add to staff
        </Button>
      </div>
    </Sheet>
  )
}