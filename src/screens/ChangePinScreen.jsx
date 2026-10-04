import { useState } from 'react'
import { TopBar, TextField, Button, ListItem, Divider, StatusPill } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'

/*
 * Change your own PIN.
 *
 * Reachable by anyone signed in, not just admins: it is your credential, and
 * the person most likely to need it changed is the one who cannot ask an admin
 * for help.
 *
 * Requires the current PIN. Without that check, anyone holding an unlocked
 * phone could take the account over permanently and the lockout counter would
 * never see it happen.
 *
 * Needs a connection, because the hash lives on the server and is a secret
 * column that never syncs. That is stated on the screen rather than discovered
 * when the button does nothing.
 */

const WHY = {
  needs_signal: 'No signal. Your PIN is stored on the server, so this needs a connection.',
  current_pin_incorrect: 'That is not your current PIN.',
  pin_too_short: 'A PIN is 4 to 12 digits.',
  pin_not_numeric: 'A PIN is digits only.',
  pin_unchanged: 'That is the PIN you already have.',
}

export default function ChangePinScreen() {
  const { goBack } = useRouter()
  const { employee } = useAuth()
  const sync = useSync()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const mismatch = confirm.length > 0 && next !== confirm
  const ready = /^\d{4,12}$/.test(current) && /^\d{4,12}$/.test(next) && next === confirm

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await sync.changeOwnPin({ currentPin: current, newPin: next })
      setDone(true)
    } catch (e) {
      setError(WHY[e?.reason] ?? 'Could not change your PIN. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div>
        <TopBar title="Change PIN" onBack={goBack} />
        <div style={{ padding: 'var(--space-5)', textAlign: 'center' }}>
          <StatusPill tone="done" shape="bar">PIN changed</StatusPill>
          <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-3)' }}>
            Use your new PIN the next time you sign in. Your current session stays signed in.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <TopBar title="Change PIN" onBack={goBack} />

      <ListItem icon="users" title={employee?.name ?? 'You'} support={employee?.role} />

      {!sync.online ? (
        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
            {WHY.needs_signal}
          </p>
        </div>
      ) : null}

      <TextField
        label="Current PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={current}
        onChange={setCurrent}
      />
      <TextField
        label="New PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={next}
        onChange={setNext}
      />
      <TextField
        label="Confirm new PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={confirm}
        onChange={setConfirm}
        error={mismatch ? 'The two do not match.' : error}
        help="4 to 12 digits. An admin can reset it if you forget it."
      />

      <Divider />

      <div style={{ padding: 'var(--space-4)' }}>
        <Button fullWidth onClick={submit} disabled={!ready || busy || !sync.online} loading={busy}>
          Change my PIN
        </Button>
      </div>
    </div>
  )
}