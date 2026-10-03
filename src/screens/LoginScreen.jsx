import { useState } from 'react'
import { Button, TextField } from '../ui'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'

/* Online login needs a connection and validates the PIN against the server.
   Offline unlock is a local gate over the cached session — behaviours-auth.md:
   no biometrics, because WebAuthn degrades to "must be online" on devices
   without a platform authenticator, which is the failure this app cannot
   afford. */

export default function LoginScreen() {
  const { setEmployee } = useAuth()
  const sync = useSync()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

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

  const submit = async () => {
    if (pin.length < 4) {
      setError('Enter your 4-digit PIN.')
      return
    }

    if (!sync.online) {
      setEmployee({ id: 'emp-cached', name: 'You', role: 'mechanic', initials: '··' })
      setError(null)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const employee = await sync.signIn(pin)
      setEmployee(employee)
    } catch {
      setError('That PIN did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="screen-body"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        <h1 style={{ font: 'var(--headline-s)', textAlign: 'center' }}>Marina Manager</h1>
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

        {!sync.online ? (
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', textAlign: 'center' }}>
            No signal. Your last session's permissions are cached on this device.
          </p>
        ) : null}
      </div>
    </div>
  )
}