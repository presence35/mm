/*
 * IndexedDB store.
 *
 * Constraint 1: screens read from here. No screen calls fetch, no screen
 * touches IndexedDB. Phase 1 used memory + localStorage; this is the real
 * thing, and the read API did not move.
 *
 * Same shape as before, plus what sync needs: a per-entity table keyed by
 * the client-generated id, a row `version` for optimistic concurrency, and an
 * outbox of pending ops.
 */

const DB_NAME = 'marina-manager'
const DB_VERSION = 2
const STORES = ['customers', 'boats', 'service_cards', 'work_logs', 'received_items', 'authorized_work', 'condition_assessment', 'photos', 'invoice_items', 'status_history', 'meta', 'outbox', 'conflicts', 'reference']

let dbPromise = null

function openRaw(version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('idb blocked'))
  })
}

/*
 * A database can exist at the current version and still be missing stores —
 * half-created, corrupted, or left by an older build. onupgradeneeded will
 * never fire again at the same version, so the app would run with an empty
 * store list: every write queues nowhere and nothing ever syncs. That failure
 * is silent, which is the worst kind.
 *
 * So verify after opening, and rebuild rather than limp.
 */
function open() {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    let db = await openRaw(DB_VERSION)
    const missing = STORES.filter((s) => !db.objectStoreNames.contains(s))
    if (!missing.length) return db

    db.close()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = resolve
      req.onerror = resolve
      req.onblocked = resolve
    })
    db = await openRaw(DB_VERSION)
    return db
  })()
  return dbPromise
}

function tx(db, names, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode)
    let out
    t.oncomplete = () => resolve(out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
    Promise.resolve(fn(t)).then((v) => {
      out = v
    }, reject)
  })
}

function reqp(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const ENTITIES = new Set(STORES.filter((s) => !['meta', 'outbox', 'conflicts', 'reference'].includes(s)))

/* ------------------------------------------------------------------ meta */

export async function getMeta(key, fallback = null) {
  const db = await open()
  const row = await tx(db, ['meta'], 'readonly', (t) => reqp(t.objectStore('meta').get(key)))
  return row ? row.value : fallback
}

export async function setMeta(key, value) {
  const db = await open()
  await tx(db, ['meta'], 'readwrite', (t) => reqp(t.objectStore('meta').put({ id: key, value })))
}

export const deviceId = async () => {
  let id = await getMeta('device_id')
  if (!id) {
    id = newId('dev')
    await setMeta('device_id', id)
  }
  return id
}

/* IDs are client-generated. The server never allocates one. */
export function newId(prefix) {
  const stamp = Date.now().toString(32).toUpperCase().padStart(10, '0')
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map((b) => b.toString(32).padStart(2, '0'))
    .join('')
  return `${prefix}-${stamp}${rand}`
}

/* ----------------------------------------------------------------- reads */

export async function all(entity) {
  const db = await open()
  return tx(db, [entity], 'readonly', (t) => reqp(t.objectStore(entity).getAll()))
}

export async function get(entity, id) {
  const db = await open()
  return tx(db, [entity], 'readonly', (t) => reqp(t.objectStore(entity).get(id)))
}

export async function put(entity, row) {
  const db = await open()
  await tx(db, [entity], 'readwrite', (t) => reqp(t.objectStore(entity).put(row)))
  return row
}

export async function putMany(entity, rows) {
  const db = await open()
  await tx(db, [entity], 'readwrite', (t) => {
    const store = t.objectStore(entity)
    for (const row of rows) store.put(row)
  })
  return rows.length
}

export async function clear(entity) {
  const db = await open()
  await tx(db, [entity], 'readwrite', (t) => reqp(t.objectStore(entity).clear()))
}

/* ---------------------------------------------------------------- writes */

/* Every mutation lands here first and is queued. Nothing reaches the network
   from this module — that is the whole point. */
export async function putAndQueue(entity, row, { op = 'upsert', conflictId } = {}) {
  const db = await open()
  const now = new Date()
  const next = { ...row, updated_at: row.updated_at ?? now.toISOString(), local_pending: true }
  /* One id, used as both the store key and the idempotency key. Two different
     values means ackOps deletes by a key that was never written and the
     outbox drains forever without ever emptying. */
  const opId = newId('op')

  await tx(db, [entity, 'outbox'], 'readwrite', (t) => {
    t.objectStore(entity).put(next)
    t.objectStore('outbox').put({
      id: opId,
      op_id: opId,
      entity,
      entity_id: row.id,
      op,
      rev: Number(row.version ?? 0),
      payload: stripMeta(row),
      conflict_id: conflictId,
      queued_at: now.toISOString(),
    })
  })
  return next
}

/* Server-side tombstone. No outbox entry: this is the server telling us. */
export async function removeLocal(entity, id) {
  const db = await open()
  await tx(db, [entity], 'readwrite', (t) => reqp(t.objectStore(entity).delete(id)))
}

export async function removeAndQueue(entity, id) {
  const db = await open()
  const row = await get(entity, id)
  if (!row) return
  const opId = newId('op')
  await tx(db, [entity, 'outbox'], 'readwrite', (t) => {
    t.objectStore(entity).delete(id)
    t.objectStore('outbox').put({
      id: opId,
      op_id: opId,
      entity,
      entity_id: id,
      op: 'delete',
      rev: Number(row.version ?? 0),
      payload: {},
      queued_at: new Date().toISOString(),
    })
  })
}

function stripMeta(row) {
  const { version, rev, updated_at, updated_by, device_id, deleted_at, local_pending, ...rest } = row
  return rest
}

/* ---------------------------------------------------------------- outbox */

export async function pendingOps() {
  const db = await open()
  return tx(db, ['outbox'], 'readonly', (t) => reqp(t.objectStore('outbox').getAll()))
}

export async function ackOps(opIds) {
  const db = await open()
  await tx(db, ['outbox'], 'readwrite', (t) => {
    const store = t.objectStore('outbox')
    for (const opId of opIds) store.delete(opId)
  })
}

export async function requeueOp(op) {
  const db = await open()
  await tx(db, ['outbox'], 'readwrite', (t) => reqp(t.objectStore('outbox').put(op)))
}

/* ------------------------------------------------------------- conflicts */

export async function addConflict(conflict) {
  const db = await open()
  await tx(db, ['conflicts'], 'readwrite', (t) => reqp(t.objectStore('conflicts').put(conflict)))
}

export async function openConflicts() {
  const db = await open()
  const all = await tx(db, ['conflicts'], 'readonly', (t) => reqp(t.objectStore('conflicts').getAll()))
  return all.filter((c) => c.status === 'open')
}

export async function resolveConflict(id, status, resolution) {
  const db = await open()
  const row = await tx(db, ['conflicts'], 'readwrite', (t) => reqp(t.objectStore('conflicts').put({ id, status: 'resolved', resolution })))
  return row
}

/* ------------------------------------------------------------ reference */

export async function putReference(snapshot) {
  const db = await open()
  for (const [entity, rows] of Object.entries(snapshot ?? {})) {
    await tx(db, ['reference'], 'readwrite', (t) => {
      const store = t.objectStore('reference')
      store.clear()
      for (const row of rows) store.put({ id: `${entity}:${row.id ?? row.item_key ?? row.value}`, entity, row })
    })
  }
}

export async function getReference(entity) {
  const db = await open()
  const rows = await tx(db, ['reference'], 'readonly', (t) => reqp(t.objectStore('reference').getAll()))
  return rows.filter((r) => r.entity === entity).map((r) => r.row)
}

/* ---------------------------------------------------------- full rehydrate */

/* After an iOS eviction or a cursor below the GC floor. Wipe and rebuild —
   the server sends the truth. */
export async function wipe() {
  const db = await open()
  const names = [...ENTITIES, 'conflicts', 'outbox', 'reference']
  await tx(db, names, 'readwrite', (t) => {
    for (const n of names) t.objectStore(n).clear()
  })
}

export async function count(entity) {
  const db = await open()
  return tx(db, [entity], 'readonly', (t) => reqp(t.objectStore(entity).count()))
}