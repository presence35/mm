import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as transport from './transport.js'
import * as store from '../store/localStore.js'
import * as idb from '../store/idb.js'

/*
 * Sync state machine — the single owner of connectivity, pending writes and
 * conflict count.
 *
 *   idle → syncing → synced → idle
 *            ├─ conflict → conflict → resolve → syncing
 *            ├─ offline  → offline → online → syncing
 *            └─ error    → error   → retry   → syncing
 *
 * Constraint 4: one sealed machine, one owner. No screen derives connectivity
 * or keeps its own `isOnline`.
 *
 * Constraint 1: the transport is the only module that performs network I/O.
 */

const SyncCtx = createContext(null)

const POLL_MS = 60_000
const BACKOFF_MS = 30_000
const MAX_ATTEMPTS = 5
const TOKEN_KEY = 'mm.token'

export function SyncProvider({ children }) {
  const [state, setState] = useState('idle')
  const [pending, setPending] = useState(0)
  const [conflicts, setConflicts] = useState(0)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [forceOffline, setForceOffline] = useState(false)
  const [failure, setFailure] = useState(null)

  const attempts = useRef(0)
  const lastAttempt = useRef(0)
  const timer = useRef(null)
  const running = useRef(false)
  /*
 * Read synchronously from the first render. It used to start false and be set
 * from an effect, so every boot flashed the sign-in screen before the app
 * appeared — and on a reload that flash looked exactly like being logged out.
 */
const [hasCachedSession, setHasCachedSession] = useState(() => {
  try {
    return Boolean(localStorage.getItem(TOKEN_KEY))
  } catch {
    return false
  }
})

  const token = useRef(null)
  const deviceId = useRef(null)

  const online = !forceOffline && (typeof navigator === 'undefined' || navigator.onLine)

  /* ------------------------------------------------------------ session */

  const ensureSession = useCallback(async () => {
    if (token.current) return token.current
    let t = null
    try {
      t = localStorage.getItem(TOKEN_KEY)
    } catch {
      t = null
    }

    /* No token at all: this device has never signed in, and must not appear to
       have a session. A cached token is what makes offline unlock possible. */
    if (!t) {
      setHasCachedSession(false)
      return null
    }

    /* Used the cached session immediately. Waiting to ask the server first is
       what made every boot flash the sign-in screen before the app appeared. */
    token.current = t

    try {
      /* Validates and refreshes permissions against the server. A cached
         snapshot is never trusted across a reconnect. */
      await transport.me(t)
      return t
    } catch (e) {
      /* Only an actual rejection ends the session. Being unable to ask is not
         the same as being told no: this app exists to work with no signal, and
         deleting the token because the dock wifi dropped logged staff out and
         destroyed their offline unlock. An unreachable server leaves the cached
         session alone - the permission snapshot already downgrades offline, and
         capability checks fall back to canOffline. */
      if (!e?.unauthorized) return t

      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {
        /* ignore */
      }
      token.current = null
      setHasCachedSession(false)
      return null
    }

    try {
      /* Validates and refreshes permissions against the server. A cached
         snapshot is never trusted across a reconnect. */
      await transport.me(t)
      token.current = t
      return t
    } catch {
      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {
        /* ignore */
      }
      return null
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      await store.hydrate()
      if (!alive) return
      deviceId.current = await idb.deviceId()
      setPending(await store.refreshPending())
      setConflicts((await idb.openConflicts()).length)

      /* A returning device has a cached session. Nothing else kicks the
         machine on boot — it starts idle and only enters syncing when a write
         happens — so without this a valid token still lands on the login
         screen with no way past it. */
      let cached = null
      try {
        cached = localStorage.getItem(TOKEN_KEY)
      } catch {
        cached = null
      }
      if (cached) {
        setHasCachedSession(true)
        setState('syncing')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /* --------------------------------------------------------------- cycle */

  const cycle = useCallback(async () => {
    if (running.current) return
    running.current = true
    lastAttempt.current = Date.now()
    try {
      if (!online) {
        setState('offline')
        return
      }

      setState('syncing')
      const t = await ensureSession()
      if (!t) {
        /* No server session. Everything still works locally; we are simply
           not connected to the server right now. */
        setState('offline')
        return
      }

      if (!deviceId.current) deviceId.current = await idb.deviceId()
      await transport.register(t, {
        deviceId: deviceId.current,
        label: navigator.userAgent?.slice(0, 60) ?? 'browser',
        platform: 'web',
      })

      /* Pull before draining. A device joining an existing marina seeds its own
         snapshot locally at rev 0; the pull brings the server's version and
         dropSuperseded discards the duplicate ops. Draining first would push
         that stale snapshot into a conflict with the server's own data. */
      const out = await transport.pullAll(t, deviceId.current, new Date())

      /* Always rebuild the projection, not just after a full rehydrate. A delta
         pull brings child rows — logs, received items, authorised work — and
         the in-memory projection has to see them or the card renders as if
         they do not exist. */
      await store.reload()

      await store.refreshPending()
      const res = await transport.drain(t, deviceId.current, new Date())

      setPending(await store.refreshPending())
      const open = await idb.openConflicts()
      setConflicts(open.length)

      attempts.current = 0
      setFailure(null)
      setLastSyncedAt(new Date())
      /* Derived from what is actually still open, not from conflicts created
         this cycle. Those may already have been resolved, which produced a
         'Needs review — 0 changes conflicted' state that cannot exist. */
      setState(open.length > 0 ? 'conflict' : 'synced')
    } catch (e) {
      if (e.offline) {
        setState('offline')
        return
      }
      attempts.current += 1
      setFailure(e.message)
      setState(attempts.current >= MAX_ATTEMPTS ? 'error' : 'offline')
    } finally {
      running.current = false
      setPending(await store.refreshPending())
    }
  }, [online, ensureSession])

  /* A local write is the trigger — but only a write. Unconditionally entering
     'syncing' here meant a cycle's own reload notified the store, which
     re-entered 'syncing', forever. The data was correct; the state never
     settled. */
  const notifyLocalWrite = useCallback(() => {
    store.refreshPending().then((n) => {
      setPending(n)
      if (n > 0 && online) setState('syncing')
    })
  }, [online])

  useEffect(() => {
    return store.subscribe(notifyLocalWrite)
  }, [notifyLocalWrite])

  useEffect(() => {
    if (state !== 'syncing') return undefined
    cycle()
    return undefined
  }, [state, cycle])

  useEffect(() => {
    const onOnline = () => setState('syncing')
    const onOffline = () => setState('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    /* Poll, but never sooner than the backoff after a failure. */
    const poll = setInterval(() => {
      if (!online) return
      if (state === 'syncing') return
      if (attempts.current > 0 && Date.now() - lastAttempt.current < BACKOFF_MS) return
      setState('syncing')
    }, POLL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(poll)
    }
  }, [online, state])

  /* Only an explicit "go online" toggles trigger a cycle. A failed cycle must
     NOT bounce back into 'syncing': that made the machine flip
     offline -> syncing -> offline as fast as it could, hammering a server
     that was already refusing connections, and React correctly blew the stack
     depth. Retries now come from the poll timer, network events, a local
     write, or the user tapping sync. */
  const wasForced = useRef(false)
  useEffect(() => {
    if (forceOffline) {
      wasForced.current = true
      setState('offline')
      return
    }
    if (wasForced.current) {
      wasForced.current = false
      setState('syncing')
    }
  }, [forceOffline])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && online) setState('syncing')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [online])

  /* -------------------------------------------------------------- actions */

  const signIn = useCallback(async (pin, employeeId) => {
    const { token: t, employee } = await transport.login(pin, employeeId)
    try {
      localStorage.setItem(TOKEN_KEY, t)
    } catch {
      /* private mode — the session lasts this page only */
    }
    token.current = t
    /* Set here, not only inside cycle(): if the machine is already 'syncing'
       the transition does not fire and we would stay on the login screen with
       a valid session. */
    setHasCachedSession(true)
    setState('syncing')
    return employee
  }, [])

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
    token.current = null
    setState('offline')
  }, [])

  const resolve = useCallback(
    async (conflictId, { resolution, payload }) => {
      /* Resolving is a queued write, not a network call: a worker who spots a
         conflict in the yard should not have to find signal to settle it. */
      const conflict = (await idb.openConflicts()).find((c) => c.id === conflictId)
      if (!conflict) return

      if (resolution !== 'kept_server') {
        await store.putEntity(conflict.entity, {
          ...(await store.getEntity(conflict.entity, conflict.entity_id)),
          ...(payload ?? conflict.local_payload),
        })
      }
      await idb.resolveConflict(conflictId, 'resolved', resolution)

      try {
        const t = await ensureSession()
        if (t) {
          await transport.resolveConflict(t, conflictId, {
            resolution,
            payload: payload ?? conflict.local_payload,
            deviceId: deviceId.current,
          })
        }
      } catch {
        /* Stays resolved locally; the next cycle pushes the outcome. */
      }

      setConflicts((await idb.openConflicts()).length)
      setState('syncing')
    },
    [ensureSession],
  )

  /*
   * Staff and credentials. Online only — the roster is server-owned and the PIN
   * columns are secret, so there is nothing to queue. Each one refuses loudly
   * when offline rather than reporting a success that never happened.
   */
  const requireSignal = () => {
    if (token.current) return null
    /* Carries `reason` like a TransportError does, so a screen's error mapping
       can actually match it. A bare Error made every mapping dead code. */
    const err = new Error('needs_signal')
    err.reason = 'needs_signal'
    err.offline = true
    return err
  }

  const addStaff = useCallback(async (fields) => {
    const problem = requireSignal()
    if (problem) throw problem
    const out = await transport.addStaff(token.current, fields)
    /* Pull so the roster on this device reflects the change immediately rather
       than at the next cycle. */
    setState('syncing')
    return out
  }, [])

  const setStaffActive = useCallback(async (id, active) => {
    const problem = requireSignal()
    if (problem) throw problem
    const out = await transport.setStaffActive(token.current, id, active)
    setState('syncing')
    return out
  }, [])

  const resetStaffPin = useCallback(async (id, pin) => {
    const problem = requireSignal()
    if (problem) throw problem
    const out = await transport.resetStaffPin(token.current, id, pin)
    setState('syncing')
    return out
  }, [])

  const changeOwnPin = useCallback(async ({ currentPin, newPin }) => {
    const problem = requireSignal()
    if (problem) throw problem
    return transport.changeOwnPin(token.current, { currentPin, newPin })
  }, [])

  const value = useMemo(
    () => ({
      state,
      pending,
      conflicts,
      lastSyncedAt,
      online,
      forceOffline,
      setForceOffline,
      hasCachedSession,
      failure,
      signIn,
      signOut,
      resolve,
      addStaff,
      setStaffActive,
      resetStaffPin,
      changeOwnPin,
      retry: () => {
        attempts.current = 0
        lastAttempt.current = 0
        setState('syncing')
      },
      syncNow: () => setState('syncing'),
    }),
    [state, pending, conflicts, lastSyncedAt, online, forceOffline, hasCachedSession, failure, signIn, signOut, resolve, addStaff, setStaffActive, resetStaffPin, changeOwnPin],
  )

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>
}

export function useSync() {
  const ctx = useContext(SyncCtx)
  if (!ctx) throw new Error('useSync must be used inside SyncProvider')
  return ctx
}