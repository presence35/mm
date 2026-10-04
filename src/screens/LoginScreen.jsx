import { useEffect, useState } from 'react'
import { Button, TextField, ListItem, Divider, Icon } from '../ui'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import * as store from '../engines/store/localStore.js'

/*
 * Sign in.
 *
 * You pick who you are, then enter your PIN. The identity step is not optional:
 * without it the server can only authenticate the first employee on file, which
 * would make a crew of mechanics share one login and make an audit trail
 * meaningless.
 *
 * The last person to sign in on this device is offered first, because the
 * common case is a mechanic's own phone and re-choosing every morning is
 * friction. Switching is always one tap away for a shared dock device.
 *
 * Offline unlock is a local gate over the cached session, and it is only
 * honest if it restores the person who actually signed in — behaviours-auth.md:
 * no biometrics, because WebAuthn degrades to "must be online" on a device with
 * no platform authenticator, which is the failure this app cannot afford.
 */

const LAST_EMPLOYEE_KEY = 'mm.employee'

const remembered = () => {
  try {
    const id = localStorage.getItem(LAST_EMPLOYEE_KEY)
    return id ? store.listStaff().find((e) => e.id === id) ?? null : null
  } catch {
    return null
  }
}

export default function LoginScreen() {
  const { setEmployee } = useAuth()
  const sync = useSync()
  const [staff, setStaff] = useState(() => store.listStaff())
  const [chosen, setChosen] = useState(() => remembered())
  const [picking, setPicking] = useState(() => !remembered())
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off = store.subscribe(() => setStaff(store.listStaff()))
    return off
  }, [])

  /* Offline with no cached session: nothing can unlock this device. */
  if (!sync.online && !sync.hasCachedSession) {
    return (
      <div className="screen-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <h1 style={{ font: 'var(--headline-s)', marginBottom: 'var(--space-3)' }}>No signal</h1>
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)' }}>
            This device has never signed in, so there is nothing to unlock. Reconnect once and sign
            in — after that it works offline.
          </p>
        </div>
      </div>
    )
  }

  const choose = (person) => {
    setChosen(person)
    setPicking(false)
    setError(null)
    setPin('')
    try {
      localStorage.setItem(LAST_EMPLOYEE_KEY, person.id)
    } catch {
      /* private mode: they pick every time, which still works */
    }
  }

  const submit = async () => {
    if (!chosen) {
      setError('Choose who you are first.')
      return
    }
    if (!/^\d{4,12}$/.test(pin)) {
      setError('Enter your PIN.')
      return
    }

    if (!sync.online) {
      /* Cached permissions only. The role comes from the real roster, not a
         hardcoded fallback, so an admin does not silently become a mechanic. */
      setEmployee(chosen)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const employee = await sync.signIn(pin, chosen.id)
      setEmployee(employee)
    } catch (e) {
      setError(e?.reason === 'invalid_credentials' ? 'That PIN did not work.' : 'Could not sign in. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (picking || !chosen) {
    return (
      <div className="screen-body">
        <div style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-4) var(--space-4)' }}>
          <h1 style={{ font: 'var(--headline-s)' }}>Marina Manager</h1>
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-1)' }}>
            Who are you?
          </p>
        </div>

        {staff.length === 0 ? (
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4)' }}>
            No staff list yet. Sign in once with a connection and it will arrive here.
          </p>
        ) : (
          staff.map((person) => (
            <ListItem
              key={person.id}
              icon="users"
              title={person.name}
              support={person.role}
              trailing={<Icon name="right" size={20} />}
              onClick={() => choose(person)}
            />
          ))
        )}
      </div>
    )
  }

  return (
    <div
      className="screen-body"
      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'var(--space-5)' }}
    >
      <div style={{ width: '100%', maxWidth: 360, margin: '0 auto' }}>
        <h1 style={{ font: 'var(--headline-s)', textAlign: 'center' }}>{chosen.name}</h1>
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', textAlign: 'center', marginTop: 'var(--space-1)' }}>
          {sync.online ? "Campbell's Landing Marina" : 'Unlocking offline'}
        </p>

        <div style={{ marginTop: 'var(--space-6)' }}>
          <TextField
            label="PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(v) => {
              setPin(v)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            error={error}
          />
        </div>

        <div style={{ padding: 'var(--space-4)' }}>
          <Button fullWidth onClick={submit} disabled={pin.length < 4 || busy} loading={busy}>
            {sync.online ? 'Sign in' : 'Unlock'}
          </Button>
        </div>

        {staff.length > 1 ? (
          <>
            <Divider />
            <div style={{ paddingTop: 'var(--space-3)', textAlign: 'center' }}>
              <Button variant="text" size="sm" onClick={() => setPicking(true)}>
                Not {chosen.name.split(' ')[0]}?
              </Button>
            </div>
          </>
        ) : null}

        {!sync.online ? (
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', textAlign: 'center' }}>
            No signal. Your last session's permissions are cached on this device.
          </p>
        ) : null}
      </div>
    </div>
  )
}