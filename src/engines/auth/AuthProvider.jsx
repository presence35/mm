import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { can, canOffline, CAPABILITIES } from './permissions.js'
import { resolveRemembered, rememberEmployeeId } from './session.js'
import * as store from '../store/localStore.js'
import { useSync } from '../sync/SyncProvider.jsx'

export { CAPABILITIES } from './permissions.js'

/*
 * Auth state machine.
 *
 *   anonymous →(who + pin online)→ online →(token expired)→ expired
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
 *
 * Identity is restored on boot from the token and the roster. It used to start
 * as a seeded employee, which meant every reload put the app in front of a
 * fabricated office user: wrong name, wrong permissions, and no way to tell from
 * the UI that it had happened. On a dock that reads as lost work.
 */

const AuthCtx = createContext(null)

const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000

export function AuthProvider({ children }) {
  const sync = useSync()

  const [employee, setEmployee] = useState(() => resolveRemembered())
  const [state, setState] = useState(() => (resolveRemembered() ? 'online' : 'anonymous'))
  const [snapshotAt, setSnapshotAt] = useState(() => new Date())

  /* The roster arrives by sync, so a person who was valid at sign-in can be
     resolved only after the first pull. Re-resolve when it changes — but never
     over a session that already resolved, or a roster edit would silently swap
     the signed-in user mid-task. */
  useEffect(() => {
    if (employee) return undefined
    return store.subscribe(() => {
      const found = resolveRemembered()
      if (found) {
        setEmployee(found)
        setState('online')
      }
    })
  }, [employee])

  /* A token with nobody to attribute it to is not a session. */
  useEffect(() => {
    if (!sync.hasCachedSession && employee) {
      setEmployee(null)
      setState('anonymous')
    }
  }, [sync.hasCachedSession, employee])

  /* Permissions are re-validated on every successful reconnect. */
  const validated = sync.state === 'synced'

  /* Offline unlock drops to the mechanic capability set: a cached snapshot may
     predate a demotion, so nothing privileged is granted without a server. */
  const role = employee?.role ?? null
  const effectiveRole = !role ? null : sync.online ? role : 'mechanic'

  const may = useCallback(
    (capability) => {
      if (!role) return false
      if (sync.online) return can(role, capability)
      return canOffline(role, capability)
    },
    [role, sync.online],
  )

  const refuseReason = useCallback(
    (capability) => {
      if (can(role, capability)) {
        return 'This needs a connection. Reconnect and try again.'
      }
      return 'Your role does not allow this.'
    },
    [role],
  )

  const signOut = useCallback(() => {
    sync.signOut()
    rememberEmployeeId(null)
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
        /* Remembered on success, not on selection. Picking someone and backing
           out must not change who this device belongs to. */
        if (e?.id) rememberEmployeeId(e.id)
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