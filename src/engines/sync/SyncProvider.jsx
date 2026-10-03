import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as store from '../store/localStore.js'

/*
 * Sync state machine — the single owner of connectivity and pending writes.
 *
 *   idle → syncing → synced → idle
 *            ├─ conflict → conflict → resolve → syncing
 *            ├─ offline  → offline → online → syncing
 *            └─ error    → error   → retry   → syncing
 *
 * Constraint 4: one sealed machine, one owner. No screen derives connectivity
 * or keeps its own `isOnline` flag — they read this.
 *
 * The transport is not implemented yet (Phase 4). Until then the engine runs
 * the real local-first loop: writes queue in the store outbox, and the queue
 * drains when the engine believes it is online. `forceOffline` exists so the
 * offline states are reachable and testable today rather than after Phase 4.
 */

const SyncCtx = createContext(null)

const RETRY_LIMIT = 5

export function SyncProvider({ children }) {
  const [state, setState] = useState(() => (typeof navigator !== 'undefined' && navigator.onLine ? 'idle' : 'offline'))
  const [pending, setPending] = useState(() => store.pendingWriteCount())
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [failures, setFailures] = useState(0)
  const [forceOffline, setForceOffline] = useState(false)
  const timerRef = useRef(null)

  const refreshPending = useCallback(() => {
    setPending(store.pendingWriteCount())
  }, [])

  useEffect(() => {
    const unsub = store.subscribe(refreshPending)
    return () => {
      unsub()
      clearTimeout(timerRef.current)
    }
  }, [refreshPending])

  useEffect(() => {
    const onOnline = () => setState('syncing')
    const onOffline = () => setState('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const runSync = useCallback(() => {
    clearTimeout(timerRef.current)
    const online = !forceOffline && (typeof navigator === 'undefined' || navigator.onLine)

    if (!online) {
      setState('offline')
      return
    }

    const queued = store.pendingWrites()
    if (!queued.length) {
      setState((s) => (s === 'offline' || s === 'error' ? 'synced' : s))
      return
    }

    setState('syncing')
    // Placeholder for POST /api/sync/push. Simulated round trip only — no network.
    timerRef.current = setTimeout(() => {
      setFailures(0)
      store.drainOutbox(queued.map((o) => o.op_id))
      refreshPending()
      setLastSyncedAt(new Date())
      setState('synced')
    }, 700)
  }, [forceOffline, refreshPending])

  useEffect(() => {
    if (state !== 'syncing') return undefined
    runSync()
    return () => clearTimeout(timerRef.current)
  }, [state, runSync])

  // A local write is the trigger, not a timer. Without this the outbox sits
  // idle until something else flips the machine to 'syncing'.
  useEffect(() => {
    if (forceOffline) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (pending > 0 && (state === 'idle' || state === 'synced')) setState('syncing')
  }, [forceOffline, pending, state])

  useEffect(() => {
    if (forceOffline) setState('offline')
    else if (state === 'offline') setState('syncing')
  }, [forceOffline, state])

  const retry = useCallback(() => {
    setFailures((f) => {
      const next = f + 1
      if (next >= RETRY_LIMIT) {
        setState('error')
        return 0
      }
      setState('syncing')
      return next
    })
  }, [])

  const resolveConflicts = useCallback(() => {
    setState('syncing')
  }, [])

  const value = useMemo(
    () => ({
      state,
      pending,
      lastSyncedAt,
      online: state !== 'offline' && !forceOffline,
      forceOffline,
      setForceOffline,
      retry,
      resolveConflicts,
      syncNow: () => setState('syncing'),
    }),
    [state, pending, lastSyncedAt, forceOffline, retry, resolveConflicts],
  )

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>
}

export function useSync() {
  const ctx = useContext(SyncCtx)
  if (!ctx) throw new Error('useSync must be used inside SyncProvider')
  return ctx
}