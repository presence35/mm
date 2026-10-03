import { ALL_TABLES, columnsFor, isKnown } from './entities.js'
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
   these never accept a write from a client that cannot prove a live session. */
const ROLE_CAN_WRITE = {
  admin: new Set(Object.keys(ALL_TABLES)),
  office: new Set(['customers', 'boats', 'boat_serials', 'service_cards', 'received_items', 'authorized_work', 'invoice_items', 'status_history', 'work_logs', 'parts_used']),
  mechanic: new Set(['received_items', 'authorized_work', 'condition_assessment', 'checklist_completions', 'work_logs', 'parts_used', 'photos']),
}

function rowToPayload(entity, row) {
  const out = {}
  for (const c of columnsFor(entity)) out[c] = row[c] ?? null
  return out
}

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
  const seen = await db.get('SELECT result FROM sync_ops WHERE op_id = ?', [op.op_id])
  if (seen) {
    try {
      return { op_id: op.op_id, ...JSON.parse(seen.result) }
    } catch {
      return { op_id: op.op_id, result: 'rejected', reason: REJECT.VALIDATION_FAILED }
    }
  }

  const finish = async (payload) => {
    await db.run('INSERT INTO sync_ops (op_id, result, created_at) VALUES (?, ?, ?)', [
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

async function applyUpsert(db, { deviceId, actorId, op }) {
  const spec = ALL_TABLES[op.entity]
  const columns = columnsFor(op.entity)
  const existing = await db.get(`SELECT * FROM ${spec.table} WHERE ${spec.pk} = ?`, [op.entity_id])
  const now = new Date().toISOString()

  /* Concurrency: the client says "I saw version N". If the server is not at
     N, someone else wrote first. Keep both — never silently overwrite. */
  if (existing && Number(existing.version) !== Number(op.rev)) {
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
    return payload[c] ?? existing?.[c] ?? null
  })

  const placeholders = columns.map(() => '?').join(', ')

  if (existing) {
    const assignments = columns.map((c) => `${c} = ?`).join(', ')
    await db.run(`UPDATE ${spec.table} SET ${assignments} WHERE ${spec.pk} = ?`, [...values, op.entity_id])
  } else {
    await db.run(`INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders})`, values)
  }

  const row = await db.get(`SELECT * FROM ${spec.table} WHERE ${spec.pk} = ?`, [op.entity_id])
  const seq = await logChange(db, { op_id: op.op_id, entity: op.entity, entity_id: op.entity_id, op: 'upsert', version, row, actorId, deviceId, now })

  return { result: 'applied', version, seq }
}

async function applyDelete(db, { deviceId, actorId, op }) {
  const spec = ALL_TABLES[op.entity]
  const existing = await db.get(`SELECT * FROM ${spec.table} WHERE ${spec.pk} = ?`, [op.entity_id])
  if (!existing) return { result: 'rejected', reason: REJECT.ENTITY_NOT_FOUND }
  if (Number(existing.version) !== Number(op.rev)) return conflict(db, op, existing, 'version_moved')

  const now = new Date().toISOString()
  const version = Number(existing.version) + 1

  await db.run(
    `UPDATE ${spec.table} SET deleted_at = ?, version = ?, updated_at = ?, updated_by = ?, device_id = ? WHERE ${spec.pk} = ?`,
    [now, version, now, actorId, deviceId, op.entity_id],
  )

  const row = await db.get(`SELECT * FROM ${spec.table} WHERE ${spec.pk} = ?`, [op.entity_id])
  const seq = await logChange(db, { op_id: op.op_id, entity: op.entity, entity_id: op.entity_id, op: 'delete', version, row, actorId, deviceId, now })

  return { result: 'applied', version, seq }
}

async function conflict(db, op, existing, why) {
  const id = op.conflict_id ?? randomUUID()
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO card_conflicts (id, entity, entity_id, local_payload, server_payload, local_rev, server_version, detected_at)
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
    `INSERT INTO change_log (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [op_id, entity, entity_id, op, version, op === 'delete' ? null : JSON.stringify(rowToPayload(entity, row)), now, actorId, deviceId],
  )
  const head = await db.get('SELECT MAX(seq) AS seq FROM change_log')
  return head?.seq ?? 0
}

/* ------------------------------------------------------------------ pull */

export async function pull(db, { cursor = 0, limit = 200 }) {
  const size = Math.min(Number(limit) || 200, PULL_LIMIT_CAP)
  const stale = await cursorBelowFloor(db, cursor, nowMs())

  if (stale) {
    /* Full rehydrate: the client missed changes we no longer keep. This is the
       path a user hits after iOS evicts offline app data. */
    const entities = []
    for (const [entity, spec] of Object.entries(ALL_TABLES)) {
      const rows = await db.all(`SELECT * FROM ${spec.table} WHERE deleted_at IS NULL`)
      for (const row of rows) entities.push({ entity, entity_id: row[spec.pk], op: 'upsert', version: row.version, payload: rowToPayload(entity, row), changed_at: row.updated_at })
    }
    const head = await db.get('SELECT MAX(seq) AS seq FROM change_log')
    return { changes: entities, cursor: head?.seq ?? 0, has_more: false, full_sync: true }
  }

  const rows = await db.all('SELECT * FROM change_log WHERE seq > ? ORDER BY seq ASC LIMIT ?', [Number(cursor) || 0, size])
  const changes = rows.map((r) => ({
    seq: Number(r.seq),
    entity: r.entity,
    entity_id: r.entity_id,
    op: r.op,
    version: Number(r.version),
    payload: r.payload ? JSON.parse(r.payload) : null,
    changed_at: r.changed_at,
  }))
  const head = await db.get('SELECT MAX(seq) AS seq FROM change_log')
  const latest = changes.length ? changes[changes.length - 1].seq : Number(cursor) || 0

  return { changes, cursor: latest, has_more: latest < (head?.seq ?? 0), full_sync: false }
}

/* A cursor below the GC floor means we can no longer produce a correct
   delta. The 90-day floor protects dark devices. */
async function cursorBelowFloor(db, cursor, now) {
  const row = await db.get('SELECT MIN(last_cursor) AS oldest FROM sync_devices WHERE revoked_at IS NULL')
  if (!row || row.oldest == null) return Number(cursor) > 0 && (await headSeq(db)) === 0
  return Number(cursor) < Number(row.oldest)
}

async function headSeq(db) {
  const row = await db.get('SELECT MAX(seq) AS seq FROM change_log')
  return Number(row?.seq ?? 0)
}

export function nowMs() {
  return Date.now()
}

/* -------------------------------------------------------------------- gc */

/* A change_log row dies only once every live device has passed it AND it is
   older than the floor. Deleting earlier silently corrupts a dark device. */
export async function collectGarbage(db, { now = new Date(), floorDays = GC_FLOOR_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - floorDays * 86400000).toISOString()
  const devices = await db.get('SELECT MIN(last_cursor) AS oldest FROM sync_devices WHERE revoked_at IS NULL')
  if (!devices || devices.oldest == null) return { deleted: 0, protected: 'no devices registered' }

  const r = await db.run('DELETE FROM change_log WHERE seq < ? AND changed_at < ?', [Number(devices.oldest), cutoff])
  return { deleted: r.changes, oldest: Number(devices.oldest), cutoff }
}

/* ---------------------------------------------------------------- devices */

export async function registerDevice(db, { deviceId, label, platform, employeeId }) {
  await db.run(
    `INSERT INTO sync_devices (device_id, label, platform, employee_id, last_cursor, last_seen_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (device_id) DO UPDATE SET label = ?, platform = ?, last_seen_at = ?`,
    [deviceId, label, platform, employeeId, new Date().toISOString(), label, platform, new Date().toISOString()],
  )
  return db.get('SELECT * FROM sync_devices WHERE device_id = ?', [deviceId])
}

export async function touchDevice(db, deviceId, cursor) {
  await db.run('UPDATE sync_devices SET last_cursor = ?, last_seen_at = ? WHERE device_id = ?', [
    Number(cursor) || 0,
    new Date().toISOString(),
    deviceId,
  ])
}