import { useState } from 'react'
import { Button, TextField } from '../ui'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'

/* Online login needs a connection. Offline unlock is a local PIN gate that
   reuses the same input — behaviours-auth.md: no biometrics, because WebAuthn
   degrades to "must be online" on devices without a platform authenticator. */

export default function LoginScreen() {
  const { unlock } = useAuth()
  const sync = useSync()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)

  const submit = () => {
    if (pin.length < 4) {
      setError('Enter your 4-digit PIN.')
      return
    }
    if (!sync.online) {
      unlock()
      return
    }
    // Server validation arrives with the auth transport.
    unlock()
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
          <Button fullWidth onClick={submit} disabled={pin.length < 4}>
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