/*
 * Sync transport.
 *
 * The only module in the app that performs network I/O. Everything else reads
 * the local store and trusts this file to make the two converge.
 *
 * Explicit `now`: staleness, retry backoff and the GC cursor are all
 * time-dependent, so the clock is a parameter (architecture.md constraint 6).
 */

import * as idb from '../store/idb.js'

const DEFAULT_BASE = '/api'
let BASE = DEFAULT_BASE
const PULL_LIMIT = 200
const MAX_ATTEMPTS = 5

/* Same-origin by default. An absolute base is only for running this exact
   module against a real server outside a browser — the integration tests. */
export function configureTransport({ base }) {
  BASE = base ?? DEFAULT_BASE
}

export class TransportError extends Error {
  constructor(message, { offline = false, unauthorized = false, reason = null, status = 0 } = {}) {
    super(message)
    this.offline = offline
    this.unauthorized = unauthorized
    /* The server's machine-readable reason, so a screen can say something
       specific instead of "something went wrong". Without this every caller's
       error mapping was dead code. */
    this.reason = reason
    this.status = status
  }
}

function headers(token) {
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

async function call(path, { method = 'GET', body, token, signal } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: headers(token),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    /* A rejected fetch is the network being absent, not a server fault. */
    throw new TransportError(e.message, { offline: true })
  }

  if (res.status === 401) {
    const body = await res.json().catch(() => ({}))
    throw new TransportError('unauthenticated', {
      unauthorized: true,
      status: 401,
      reason: body?.error ?? null,
    })
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new TransportError(`${method} ${path} failed: ${res.status}`, {
      status: res.status,
      reason: body?.error ?? null,
    })
  }
  return res.json()
}

/* ------------------------------------------------------------------ auth */

export async function login(pin, employeeId) {
  const { token, employee } = await call('/auth/login', { method: 'POST', body: { pin, employee_id: employeeId } })
  return { token, employee }
}

/* --------------------------------------------------------------- staff --
 * Online only. Employees are server-owned: pin_salt and pin_hash are secret
 * columns and the roster is not a syncable entity, so there is nothing to queue
 * and nothing a client could usefully do offline. Callers must say so plainly
 * rather than optimistically pretending the change is saved. */

export async function listStaff(token) {
  return call('/employees', { token })
}

export async function addStaff(token, { name, role, pin }) {
  return call('/employees', { method: 'POST', token, body: { name, role, pin } })
}

export async function setStaffActive(token, id, active) {
  return call(`/employees/${id}/active`, { method: 'POST', token, body: { active } })
}

export async function resetStaffPin(token, id, pin) {
  return call(`/employees/${id}/pin`, { method: 'POST', token, body: { pin } })
}

export async function changeOwnPin(token, { currentPin, newPin }) {
  return call('/auth/pin', { method: 'POST', token, body: { current_pin: currentPin, new_pin: newPin } })
}

export async function me(token) {
  return call('/auth/me', { token })
}

/* ------------------------------------------------------------------ sync */

export async function register(token, { deviceId: id, label, platform }) {
  return call('/sync/register', { method: 'POST', token, body: { device_id: id, label, platform } })
}

export async function pull(token, cursor, deviceId) {
  const q = new URLSearchParams({ cursor: String(cursor ?? 0), limit: String(PULL_LIMIT), device_id: deviceId })
  return call(`/sync/pull?${q}`, { token })
}

export async function push(token, deviceId, ops) {
  const { results } = await call('/sync/push', { method: 'POST', token, body: { device_id: deviceId, ops } })
  return results
}

export async function reference(token) {
  return call('/sync/reference', { token })
}

export async function conflicts(token) {
  const { conflicts: list } = await call('/sync/conflicts', { token })
  return list
}

export async function resolveConflict(token, id, { resolution, payload, deviceId }) {
  return call(`/sync/conflicts/${id}/resolve`, {
    method: 'POST',
    token,
    body: { resolution, payload, device_id: deviceId },
  })
}

/* ------------------------------------------------------------ public view */

export async function publicCard(token) {
  const res = await fetch(`${BASE}/public/card/${encodeURIComponent(token)}`)
  if (!res.ok) return null
  return res.json()
}

/* -------------------------------------------------------------- engine */

/*
 * One drain, one pull. Both are called by SyncProvider and by nothing else.
 * The conflict rule lives here and nowhere else: when the server says
 * conflict, the server's version wins the entity and BOTH versions are kept
 * for a human to resolve. Nothing is ever silently discarded.
 */
export async function drain(token, deviceId, now = new Date()) {
  const queued = await idb.pendingOps()
  if (!queued.length) return { applied: 0, conflicts: 0, rejected: 0 }

  const results = await push(token, deviceId, queued.map((o) => ({
    op_id: o.op_id,
    entity: o.entity,
    entity_id: o.entity_id,
    op: o.op,
    rev: o.rev,
    payload: o.payload,
    conflict_id: o.conflict_id,
  })))

  const acked = []
  let conflicts = 0
  let rejected = 0

  for (const r of results) {
    const op = queued.find((o) => o.op_id === r.op_id)
    if (!op) continue

    if (r.result === 'applied') {
      const row = await idb.get(op.entity, op.entity_id)
      await idb.put(op.entity, { ...(row ?? {}), ...op.payload, id: op.entity_id, version: r.version, updated_at: new Date(now).toISOString(), local_pending: false })
      acked.push(r.op_id)
    } else if (r.result === 'conflict') {
      conflicts += 1
      /* Keep BOTH. The local version goes into the conflict row; the server's
         version arrives on the next pull, which is free because the op is
         acked and the row is no longer "pending". Nothing is discarded. */
      await idb.addConflict({
        id: r.conflict_id,
        entity: op.entity,
        entity_id: op.entity_id,
        local_payload: op.payload,
        server_version: r.server_version,
        status: 'open',
        detected_at: new Date(now).toISOString(),
      })
      acked.push(r.op_id)
    } else {
      rejected += 1
      acked.push(r.op_id)
    }
  }

  await idb.ackOps(acked)
  return { applied: results.filter((r) => r.result === 'applied').length, conflicts, rejected }
}

export async function pullAll(token, deviceId, now = new Date()) {
  const cursor = Number(await idb.getMeta('cursor', 0)) || 0
  const res = await pull(token, cursor, deviceId)

  if (res.full_sync) {
    await idb.wipe()
    await idb.setMeta('cursor', 0)
    const grouped = {}
    for (const change of res.changes) {
      ;(grouped[change.entity] ??= []).push({ ...change.payload, id: change.entity_id, version: change.version, updated_at: change.updated_at })
    }
    for (const [entity, rows] of Object.entries(grouped)) {
      if (rows.length) await idb.putMany(entity, rows)
    }
    await idb.setMeta('cursor', res.cursor)
    return { applied: res.changes.length, full: true }
  }

  let applied = 0
  for (const change of res.changes) {
    if (change.op === 'delete') {
      await idb.removeLocal(change.entity, change.entity_id)
    } else {
      const queued = await idb.pendingOps()
      const pendingHere = queued.some((o) => o.entity === change.entity && o.entity_id === change.entity_id)
      /* Never clobber a row with unsynced local edits. */
      if (!pendingHere) {
        await idb.put(change.entity, { ...change.payload, id: change.entity_id, version: change.version, updated_at: change.updated_at, local_pending: false })
        applied += 1
      } else {
        /* The server may already hold this edit — a second device seeding the
           same bootstrap snapshot, for instance. Drop the duplicate rather
           than pushing it into a conflict with ourselves. */
        const dropped = await idb.dropSuperseded(change.entity, change.entity_id, change)
        if (dropped && !pendingHere) {
          await idb.put(change.entity, { ...change.payload, id: change.entity_id, version: change.version, updated_at: change.updated_at, local_pending: false })
          applied += 1
        }
      }
    }
  }
  await idb.setMeta('cursor', res.cursor)
  await idb.setMeta('last_pull_at', new Date(now).toISOString())
  await idb.attachServerPayloads()
  return { applied, full: false }
}

export { MAX_ATTEMPTS }