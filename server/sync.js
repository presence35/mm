import { ALL_TABLES, syncColumnsFor, isKnown, T } from './entities.js'
import { randomUUID } from 'node:crypto'

/*
 * The sync engine.
 *
 * Two implementations of the same protocol live here and nowhere else:
 *   push() — client writes, idempotent, conflict-detecting
 *   pull() — client reads, delta or full rehydrate
 *
 * Nothing above this file knows how concurrency is resolved.
 */

const REJECT = {
  UNKNOWN_ENTITY: 'unknown_entity',
  UNAUTHORIZED_ENTITY: 'unauthorized_entity',
  UNAUTHORIZED_ROLE: 'unauthorized_role',
  ENTITY_NOT_FOUND: 'entity_not_found',
  VALIDATION_FAILED: 'validation_failed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
}

const MAX_PAYLOAD_BYTES = 512 * 1024
const PULL_LIMIT_CAP = 1000
const GC_FLOOR_DAYS = 90

/* behaviours-auth.md constraint 5: only mechanic card work queues offline, so
   these never accept a write from a client that cannot prove a live session.
   Appointments are absent from `mechanic` on purpose: a booking is an office
   action, and two phones off the network must not both take the ramp. */
const ROLE_CAN_WRITE = {
  admin: new Set(Object.keys(ALL_TABLES)),
  office: new Set(['customers', 'boats', 'boat_serials', 'service_cards', 'received_items', 'authorized_work', 'invoice_items', 'status_history', 'work_logs', 'parts_used', 'appointments']),
  mechanic: new Set(['received_items', 'authorized_work', 'condition_assessment', 'checklist_completions', 'work_logs', 'parts_used', 'photos']),
}

export function rowToPayload(entity, row) {
  const out = {}
  /* syncColumnsFor, not columnsFor: this is the function that decides what leaves
     the server, so it is where a secret column stops. */
  for (const c of syncColumnsFor(entity)) out[c] = normaliseRead(entity, c, row[c])
  return out
}

/* SQLite refuses booleans, and undefined. The client speaks JS; the wire
   speaks SQL. Anything that is not a bindable scalar is stored as JSON text
   rather than crashing the process — a malformed write must not take the
   server down.

   Column-aware, because truncating a REAL is how 24.5 ft became 24 ft: the
   schema declared `length_ft` REAL while this function silently floored it on
   every write. */
function bindable(name, value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return INTEGER_COLUMNS.has(name) ? Math.trunc(value) : value
  }
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}

/* Reads a numeric column back as a number. An old row stored as TEXT comes
   back as "3.0"; without this that value propagates to every client that
   pulls it and keeps reproducing itself. */
function normaliseRead(entity, name, value) {
  if (value === null || value === undefined) return null
  if (INTEGER_COLUMNS.has(name)) {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  if (REAL_COLUMNS.has(name)) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

/* The two sets mirror schema.js columnDdl exactly. A column declared INTEGER
   there and REAL here (or the reverse) round-trips wrong in both directions. */
const INTEGER_COLUMNS = new Set([
  'version', 'rev', 'sort_order', 'quantity', 'total', 'active', 'is_fake', 'is_scanned',
  'wrap_required', 'unwrap_done', 'authorized', 'completed', 'present',
  'boathouse_no', 'slip_no', 'storage_row', 'season_year',
])

const REAL_COLUMNS = new Set([
  'length_ft', 'width_ft', 'height_front_ft', 'height_back_ft',
  'tax_rate', 'unit_price', 'gps_lat', 'gps_lng',
])

/* ------------------------------------------------------------------ push */

export async function push(db, { deviceId, actorId, role, ops }) {
  const results = []
  for (const op of ops) results.push(await applyOp(db, { deviceId, actorId, role, op }))
  return results
}

async function applyOp(db, ctx) {
  const { op, role } = ctx

  /* Idempotency: a repeat returns the ORIGINAL result. A rejected op is
     consumed too, so a stale retry cannot be replayed into acceptance. */
  const seen = await db.get(`SELECT result FROM ${T('sync_ops')} WHERE op_id = ?`, [op.op_id])
  if (seen) {
    try {
      return { op_id: op.op_id, ...JSON.parse(seen.result) }
    } catch {
      return { op_id: op.op_id, result: 'rejected', reason: REJECT.VALIDATION_FAILED }
    }
  }

  const finish = async (payload) => {
    await db.run(`INSERT INTO ${T('sync_ops')} (op_id, result, created_at) VALUES (?, ?, ?)`, [
      op.op_id,
      JSON.stringify(payload),
      new Date().toISOString(),
    ])
    return { op_id: op.op_id, ...payload }
  }

  if (!op || !op.op_id) return finish({ result: 'rejected', reason: REJECT.VALIDATION_FAILED })
  if (!isKnown(op.entity)) return finish({ result: 'rejected', reason: REJECT.UNKNOWN_ENTITY })
  if (!ROLE_CAN_WRITE[role]?.has(op.entity)) {
    return finish({ result: 'rejected', reason: ROLE_CAN_WRITE[role] ? REJECT.UNAUTHORIZED_ENTITY : REJECT.UNAUTHORIZED_ROLE })
  }

  const payload = op.payload ?? {}
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return finish({ result: 'rejected', reason: REJECT.PAYLOAD_TOO_LARGE })
  }

  if (op.op === 'delete') return finish(await applyDelete(db, ctx, op))
  return finish(await applyUpsert(db, ctx, op))
}

const BINDABLE_META = new Set(['rev', 'version', 'updated_at', 'updated_by', 'device_id', 'deleted_at'])

/*
 * Is this write a no-op?
 *
 * The conflict rule is `version != rev`, which is correct for concurrency and
 * wrong for this: the same edit arriving twice — a snapshot queued twice, or
 * two devices that happened to type the same value — moves the version without
 * changing a single field. Raising a conflict there asks a worker to choose
 * between two identical values, and on a child entity (received item, work
 * log, authorised work) it asks them to choose between two versions the
 * conflict screen cannot even display.
 *
 * Mirrors the write rule exactly: `payload[c] ?? existing[c]`, so an absent or
 * null field means "leave it as it is", not "set it to null". Compared through
 * normaliseRead so that 1 and "1.0" are not mistaken for a difference.
 */
function sameContent(entity, payload, existing) {
  for (const c of syncColumnsFor(entity)) {
    if (BINDABLE_META.has(c)) continue
    const incoming = payload[c]
    if (incoming === undefined || incoming === null) continue
    if (normaliseRead(entity, c, bindable(c, incoming)) !== normaliseRead(entity, c, existing[c])) return false
  }
  return true
}

async function applyUpsert(db, { deviceId, actorId, op }) {
  const spec = ALL_TABLES[op.entity]
  /* Also the write side: a client cannot set a PIN by pushing a row, which would
     otherwise be privilege escalation from any signed-in device. */
  const columns = syncColumnsFor(op.entity)
  const existing = await db.get(`SELECT * FROM ${T(spec.table)} WHERE ${spec.pk} = ?`, [op.entity_id])
  const now = new Date().toISOString()

  /* Concurrency: the client says "I saw version N". If the server is not at
     N, someone else wrote first. Keep both — never silently overwrite. */
  if (existing && Number(existing.version) !== Number(op.rev)) {
    /* Unless the write changes nothing, in which case there is no disagreement
       to keep. Acknowledged at the version already held, and no change_log row
       is written because no change happened. */
    if (sameContent(op.entity, op.payload ?? {}, existing)) {
      return { result: 'applied', version: Number(existing.version), seq: await headSeq(db) }
    }
    return conflict(db, op, existing, 'version_moved')
  }
  if (!existing && Number(op.rev) !== 0) {
    return conflict(db, op, null, 'row_absent')
  }

  const version = existing ? Number(existing.version) + 1 : 1
  const payload = op.payload ?? {}
  const values = columns.map((c) => {
    if (c === 'rev') return Number(op.rev)
    if (c === 'version') return version
    if (c === 'updated_at') return now
    if (c === 'updated_by') return actorId
    if (c === 'device_id') return deviceId
    if (c === 'deleted_at') return existing?.deleted_at ?? null
    return bindable(c, payload[c] ?? existing?.[c] ?? null)
  })

  const placeholders = columns.map(() => '?').join(', ')

  if (existing) {
    const assignments = columns.map((c) => `${c} = ?`).join(', ')
    await db.run(`UPDATE ${T(spec.table)} SET ${assignments} WHERE ${spec.pk} = ?`, [...values, op.entity_id])
  } else {
    await db.run(`INSERT INTO ${T(spec.table)} (${columns.join(', ')}) VALUES (${placeholders})`, values)
  }

  const row = await db.get(`SELECT * FROM ${T(spec.table)} WHERE ${spec.pk} = ?`, [op.entity_id])
  const seq = await logChange(db, { op_id: op.op_id, entity: op.entity, entity_id: op.entity_id, op: 'upsert', version, row, actorId, deviceId, now })

  return { result: 'applied', version, seq }
}

async function applyDelete(db, { deviceId, actorId, op }) {
  const spec = ALL_TABLES[op.entity]
  const existing = await db.get(`SELECT * FROM ${T(spec.table)} WHERE ${spec.pk} = ?`, [op.entity_id])
  if (!existing) return { result: 'rejected', reason: REJECT.ENTITY_NOT_FOUND }
  if (Number(existing.version) !== Number(op.rev)) return conflict(db, op, existing, 'version_moved')

  const now = new Date().toISOString()
  const version = Number(existing.version) + 1

  await db.run(
    `UPDATE ${T(spec.table)} SET deleted_at = ?, version = ?, updated_at = ?, updated_by = ?, device_id = ? WHERE ${spec.pk} = ?`,
    [now, version, now, actorId, deviceId, op.entity_id],
  )

  const row = await db.get(`SELECT * FROM ${T(spec.table)} WHERE ${spec.pk} = ?`, [op.entity_id])
  const seq = await logChange(db, { op_id: op.op_id, entity: op.entity, entity_id: op.entity_id, op: 'delete', version, row, actorId, deviceId, now })

  return { result: 'applied', version, seq }
}

async function conflict(db, op, existing, why) {
  const id = op.conflict_id ?? randomUUID()
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO ${T('card_conflicts')} (id, entity, entity_id, local_payload, server_payload, local_rev, server_version, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      op.entity,
      op.entity_id,
      JSON.stringify(op.payload ?? {}),
      JSON.stringify(existing ? rowToPayload(op.entity, existing) : null),
      Number(op.rev),
      existing ? Number(existing.version) : 0,
      now,
    ],
  )

  return { result: 'conflict', conflict_id: id, server_version: existing ? Number(existing.version) : 0, reason: why }
}

async function logChange(db, { op_id, entity, entity_id, op, version, row, actorId, deviceId, now }) {
  await db.run(
    `INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [op_id, entity, entity_id, op, version, op === 'delete' ? null : JSON.stringify(rowToPayload(entity, row)), now, actorId, deviceId],
  )
  const head = await db.get(`SELECT MAX(seq) AS seq FROM ${T('change_log')}`)
  return head?.seq ?? 0
}

/* ------------------------------------------------------------------ pull */

export async function pull(db, { cursor = 0, limit = 200 }) {
  const size = Math.min(Number(limit) || 200, PULL_LIMIT_CAP)
  const stale = await cursorBelowFloor(db, cursor)

  if (stale) {
    /* Full rehydrate: the client missed changes we no longer keep. This is the
       path a user hits after iOS evicts offline app data. */
    const entities = []
    for (const [entity, spec] of Object.entries(ALL_TABLES)) {
      const rows = await db.all(`SELECT * FROM ${T(spec.table)} WHERE deleted_at IS NULL`)
      for (const row of rows) entities.push({ entity, entity_id: row[spec.pk], op: 'upsert', version: row.version, payload: rowToPayload(entity, row), changed_at: row.updated_at, changed_by: row.updated_by })
    }
    const head = await db.get(`SELECT MAX(seq) AS seq FROM ${T('change_log')}`)
    return { changes: entities, cursor: head?.seq ?? 0, has_more: false, full_sync: true }
  }

  const rows = await db.all(`SELECT * FROM ${T('change_log')} WHERE seq > ? ORDER BY seq ASC LIMIT ?`, [Number(cursor) || 0, size])
  const changes = rows.map((r) => ({
    seq: Number(r.seq),
    entity: r.entity,
    entity_id: r.entity_id,
    op: r.op,
    version: Number(r.version),
    payload: r.payload ? JSON.parse(r.payload) : null,
    changed_at: r.changed_at,
    changed_by: r.updated_by,
  }))
  const head = await db.get(`SELECT MAX(seq) AS seq FROM ${T('change_log')}`)
  const latest = changes.length ? changes[changes.length - 1].seq : Number(cursor) || 0

  return { changes, cursor: latest, has_more: latest < (head?.seq ?? 0), full_sync: false }
}

/*
 * A cursor we cannot serve from the delta stream must produce a full rehydrate.
 */
async function cursorBelowFloor(db, cursor) {
  const at = Number(cursor) || 0
  const bounds = await db.get(`SELECT MIN(seq) AS oldest, MAX(seq) AS head FROM ${T('change_log')}`)
  const head = Number(bounds?.head ?? 0)
  const oldest = bounds?.oldest == null ? 0 : Number(bounds.oldest)

  /* Two ways the log stops being able to answer a delta query, and only one
     used to be checked:

       - the cursor is past the end: the log was rebuilt — a reset, or a
         restored backup.
       - **the cursor is below the beginning**: rows were collected, so `seq >
         cursor` starts mid-history. A device holding nothing asked for
         `cursor=0` and was served whatever survived GC, which for a migrated
         marina is a fragment of child rows and none of the cards they belong
         to.

     The second is silent by construction: the query succeeds and returns a
     short list. Comparing the cursor against the *devices* table cannot catch
     it — a device that just registered holds 0, so MIN(last_cursor) is 0 and
     `0 < 0` is false. The floor is the oldest row that still exists.

     `at < oldest - 1` rather than `at < oldest`: a device at cursor N already
     holds everything up to N locally, so it only needs the rows the log still
     has. Forcing a rehydrate there would be safe but would re-download the
     marina every time GC moved the floor. */
  if (at > head) return true
  if (at < oldest - 1) return true

  const row = await db.get(`SELECT MIN(last_cursor) AS oldest FROM ${T('sync_devices')} WHERE revoked_at IS NULL`)
  if (!row || row.oldest == null) return at > 0 && head === 0
  return at < Number(row.oldest)
}

async function headSeq(db) {
  const row = await db.get(`SELECT MAX(seq) AS seq FROM ${T('change_log')}`)
  return Number(row?.seq ?? 0)
}

export async function syncState(db) {
  const bounds = await db.get(`SELECT MIN(seq) AS oldest, MAX(seq) AS head, COUNT(*) AS rows FROM ${T('change_log')}`)
  const devices = await db.all(`SELECT device_id, last_cursor, last_seen_at, revoked_at FROM ${T('sync_devices')} ORDER BY last_cursor ASC`)
  const counts = {}
  for (const [entity, spec] of Object.entries(ALL_TABLES)) {
    const row = await db.get(`SELECT COUNT(*) AS n FROM ${T(spec.table)}`)
    counts[entity] = Number(row?.n ?? 0)
  }
  return {
    log: { oldest: Number(bounds?.oldest ?? 0), head: Number(bounds?.head ?? 0), rows: Number(bounds?.rows ?? 0) },
    gc_floor_days: GC_FLOOR_DAYS,
    counts,
    devices,
  }
}

export function nowMs() {
  return Date.now()
}

/* -------------------------------------------------------------------- gc */

/* A change_log row dies only once every live device has passed it AND it is
   older than the floor. Deleting earlier silently corrupts a dark device. */
export async function collectGarbage(db, { now = new Date(), floorDays = GC_FLOOR_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - floorDays * 86400000).toISOString()
  const devices = await db.get(`SELECT MIN(last_cursor) AS oldest FROM ${T('sync_devices')} WHERE revoked_at IS NULL`)
  if (!devices || devices.oldest == null) return { deleted: 0, protected: 'no devices registered' }

  const r = await db.run(`DELETE FROM ${T('change_log')} WHERE seq < ? AND changed_at < ?`, [Number(devices.oldest), cutoff])
  return { deleted: r.changes, oldest: Number(devices.oldest), cutoff }
}

/* ---------------------------------------------------------------- devices */

export async function registerDevice(db, { deviceId, label, platform, employeeId }) {
  await db.run(
    `INSERT INTO ${T('sync_devices')} (device_id, label, platform, employee_id, last_cursor, last_seen_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (device_id) DO UPDATE SET label = ?, platform = ?, last_seen_at = ?`,
    [deviceId, label, platform, employeeId, new Date().toISOString(), label, platform, new Date().toISOString()],
  )
  return db.get(`SELECT * FROM ${T('sync_devices')} WHERE device_id = ?`, [deviceId])
}

export async function touchDevice(db, deviceId, cursor) {
  await db.run(`UPDATE ${T('sync_devices')} SET last_cursor = ?, last_seen_at = ? WHERE device_id = ?`, [
    Number(cursor) || 0,
    new Date().toISOString(),
    deviceId,
  ])
}