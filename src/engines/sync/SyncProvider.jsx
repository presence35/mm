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
  const timer = useRef(null)
  const running = useRef(false)
  const [hasCachedSession, setHasCachedSession] = useState(false)

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
    /* A cached token is what makes offline unlock possible at all. Without
       one, a phone that has never signed in must not appear to have a
       session. */
    setHasCachedSession(Boolean(t))
    if (!t) return null

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
    })()
    return () => {
      alive = false
    }
  }, [])

  /* --------------------------------------------------------------- cycle */

  const cycle = useCallback(async () => {
    if (running.current) return
    running.current = true
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

      const out = await transport.pullAll(t, deviceId.current, new Date())
      if (out.full) await store.reload()

      await store.refreshPending()
      const res = await transport.drain(t, deviceId.current, new Date())

      setPending(await store.refreshPending())
      const open = await idb.openConflicts()
      setConflicts(open.length)
      await store.reload()

      attempts.current = 0
      setFailure(null)
      setLastSyncedAt(new Date())
      setState(res.conflicts > 0 || open.length > 0 ? 'conflict' : 'synced')
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
    const poll = setInterval(() => {
      if (online && state !== 'syncing') setState('syncing')
    }, POLL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(poll)
    }
  }, [online, state])

  useEffect(() => {
    if (forceOffline) setState('offline')
    else if (state === 'offline') setState('syncing')
  }, [forceOffline, state])

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
      const t = await ensureSession()
      if (!t) return
      await transport.resolveConflict(t, conflictId, { resolution, payload, deviceId: deviceId.current })
      await idb.resolveConflict(conflictId, 'resolved', resolution)
      if (resolution !== 'kept_server') {
        const conflict = (await idb.openConflicts()).find((c) => c.id === conflictId)
        if (conflict) await store.patchCard(conflict.entity_id, payload ?? conflict.local_payload)
      }
      setConflicts((await idb.openConflicts()).length)
      setState('syncing')
    },
    [ensureSession],
  )

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
      retry: () => setState('syncing'),
      syncNow: () => setState('syncing'),
    }),
    [state, pending, conflicts, lastSyncedAt, online, forceOffline, hasCachedSession, failure, signIn, signOut, resolve],
  )

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>
}

export function useSync() {
  const ctx = useContext(SyncCtx)
  if (!ctx) throw new Error('useSync must be used inside SyncProvider')
  return ctx
}