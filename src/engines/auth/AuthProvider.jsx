import { createContext, useContext, useCallback, useMemo, useState } from 'react'
import { can, canOffline, CAPABILITIES } from './permissions.js'
import { SEED_EMPLOYEE } from '../store/seed.js'
import { useSync } from '../sync/SyncProvider.jsx'

export { CAPABILITIES } from './permissions.js'

/*
 * Auth state machine.
 *
 *   anonymous →(pin online)→ online →(token expired)→ expired
 *                    │              │
 *                    │              ├(network lost)→ unlocked (local pin)
 *                    │              └(logout)────────→ anonymous
 *
 * `unlocked` carries a cached permission snapshot. Permission re-validation
 * belongs to the sync phase; the shape of the machine ships now because every
 * screen gates actions through it.
 *
 * The PIN gate is deliberately not biometrics — WebAuthn degrades to
 * "must be online" on devices without a platform authenticator, which is
 * exactly the failure a dock app cannot afford. (behaviors-auth.md)
 */

const AuthCtx = createContext(null)

const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000

export function AuthProvider({ children }) {
  const sync = useSync()
  const [state, setState] = useState('online')
  const [employee, setEmployee] = useState(SEED_EMPLOYEE)
  const [snapshotAt, setSnapshotAt] = useState(() => new Date())

  /* Permissions are re-validated on every successful reconnect. */
  const validated = sync.state === 'synced'

  /* Offline unlock drops to the mechanic capability set: a cached snapshot may
     predate a demotion, so nothing privileged is granted without a server. */
  const effectiveRole = sync.online ? employee.role : 'mechanic'

  const may = useCallback(
    (capability) => {
      if (sync.online) return can(employee.role, capability)
      return canOffline(employee.role, capability)
    },
    [employee.role, sync.online],
  )

  const refuseReason = useCallback(
    (capability) => {
      if (can(employee.role, capability)) {
        return 'This needs a connection. Reconnect and try again.'
      }
      return 'Your role does not allow this.'
    },
    [employee.role],
  )

  const signOut = useCallback(() => {
    sync.signOut()
    setState('anonymous')
    setEmployee(null)
  }, [sync])

  const value = useMemo(
    () => ({
      state,
      employee,
      effectiveRole,
      snapshotAt,
      snapshotExpiresAt: new Date(snapshotAt.getTime() + SNAPSHOT_TTL_MS),
      validated,
      may,
      refuseReason,
      signOut,
      setEmployee: (e) => {
        setEmployee(e)
        setState('online')
        setSnapshotAt(new Date())
      },
      CAPABILITIES,
    }),
    [state, employee, effectiveRole, snapshotAt, validated, may, refuseReason, signOut, sync],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}