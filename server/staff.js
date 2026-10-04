import { randomUUID } from 'node:crypto'

import { T } from './entities.js'
import { hashPin, verifyPin } from './db/index.js'

/*
 * Staff and credentials.
 *
 * Everything here writes the employees row directly rather than going through
 * the sync engine, for two reasons that are really one reason:
 *
 *  - pin_salt and pin_hash are secret columns. syncColumnsFor keeps them out of
 *    the sync path, so a client can neither read nor write them. Staff changes
 *    therefore have to come through an authenticated route.
 *  - employees is REFERENCE data, not a syncable entity. A push naming it is
 *    rejected outright, which is also why a mechanic cannot make themselves an
 *    admin from a signed-in phone.
 *
 * Consequences, stated rather than hidden: staff cannot be added or changed
 * offline, and the change appears on other devices only once it syncs. That is
 * the correct trade for credentials, not a limitation worked around.
 */

export const ROLES = ['admin', 'office', 'mechanic']

const PIN_MIN = 4
const PIN_MAX = 12

export function validatePin(pin) {
  if (typeof pin !== 'string') return 'pin_required'
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return 'pin_too_short'
  if (!/^\d+$/.test(pin)) return 'pin_not_numeric'
  return null
}

function initialsFor(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/*
 * Rows are read back with the allow-list, never SELECT *. The PIN columns are on
 * the same row that gets listed in the staff screen, so a wildcard here would
 * hand the app every credential on the island.
 */
export async function listStaff(db) {
  const rows = await db.all(
    `SELECT id, name, role, initials, active, updated_at FROM ${T('employees')} WHERE deleted_at IS NULL ORDER BY created_at ASC`,
  )
  return rows.map((r) => ({ ...r, active: Number(r.active) === 1 }))
}

export async function createStaff(db, { name, role, pin, actorId }) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return { ok: false, status: 400, reason: 'name_required' }
  if (!ROLES.includes(role)) return { ok: false, status: 400, reason: 'unknown_role' }
  const pinProblem = validatePin(pin)
  if (pinProblem) return { ok: false, status: 400, reason: pinProblem }

  /* A duplicate PIN would let the wrong person walk in and, worse, make the
     audit trail ambiguous. Cheap to prevent. */
  const everyone = await db.all(`SELECT pin_salt, pin_hash FROM ${T('employees')} WHERE deleted_at IS NULL`)
  for (const person of everyone) {
    if (person.pin_salt && verifyPin(pin, person.pin_salt, person.pin_hash)) {
      return { ok: false, status: 409, reason: 'pin_in_use' }
    }
  }

  const id = randomUUID().replace(/-/g, '').toUpperCase().slice(0, 26)
  const { salt, hash } = hashPin(pin)
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO ${T('employees')}
       (id, name, role, initials, pin_salt, pin_hash, active, created_at, updated_at, updated_by, device_id, rev, version)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'server', 0, 1)`,
    [id, trimmed, role, initialsFor(trimmed), salt, hash, now, now, actorId],
  )

  await logStaff(db, { entityId: id, row: await readRow(db, id), actorId })
  return { ok: true, employee: publicStaff(await readRow(db, id)) }
}

export async function setStaffActive(db, { id, active, actorId }) {
  const row = await readRow(db, id)
  if (!row) return { ok: false, status: 404, reason: 'not_found' }

  const now = new Date().toISOString()
  await db.run(
    `UPDATE ${T('employees')} SET active = ?, updated_at = ?, updated_by = ?, device_id = 'server',
       version = version + 1 WHERE id = ?`,
    [active ? 1 : 0, now, actorId, id],
  )
  await logStaff(db, { entityId: id, row: await readRow(db, id), actorId })
  return { ok: true, employee: publicStaff(await readRow(db, id)) }
}

/* An admin letting someone back in. Does not require their old PIN, which is
   the point when they have forgotten it. */
export async function resetPin(db, { id, pin, actorId }) {
  const row = await readRow(db, id)
  if (!row) return { ok: false, status: 404, reason: 'not_found' }
  const pinProblem = validatePin(pin)
  if (pinProblem) return { ok: false, status: 400, reason: pinProblem }

  const { salt, hash } = hashPin(pin)
  const now = new Date().toISOString()
  await db.run(
    `UPDATE ${T('employees')} SET pin_salt = ?, pin_hash = ?, updated_at = ?, updated_by = ?,
       device_id = 'server', version = version + 1 WHERE id = ?`,
    [salt, hash, now, actorId, id],
  )
  await logStaff(db, { entityId: id, row: await readRow(db, id), actorId })
  return { ok: true }
}

/*
 * Changing your own PIN requires knowing the current one. Without that check a
 * borrowed unlocked phone would let whoever is holding it take the account over
 * permanently, and the lockout counter would never see it happen.
 */
export async function changeOwnPin(db, { employeeId, currentPin, newPin }) {
  const row = await readRow(db, employeeId)
  if (!row) return { ok: false, status: 404, reason: 'not_found' }

  const pinProblem = validatePin(newPin)
  if (pinProblem) return { ok: false, status: 400, reason: pinProblem }

  if (!row.pin_salt || !verifyPin(currentPin ?? '', row.pin_salt, row.pin_hash)) {
    return { ok: false, status: 401, reason: 'current_pin_incorrect' }
  }
  if (currentPin === newPin) {
    return { ok: false, status: 400, reason: 'pin_unchanged' }
  }

  const { salt, hash } = hashPin(newPin)
  const now = new Date().toISOString()
  await db.run(
    `UPDATE ${T('employees')} SET pin_salt = ?, pin_hash = ?, updated_at = ?, updated_by = ?,
       device_id = 'server', version = version + 1 WHERE id = ?`,
    [salt, hash, now, employeeId, employeeId],
  )
  await logStaff(db, { entityId: employeeId, row: await readRow(db, employeeId), actorId: employeeId })
  return { ok: true }
}

const readRow = (db, id) => db.get(`SELECT * FROM ${T('employees')} WHERE id = ? AND deleted_at IS NULL`, [id])

const publicStaff = (row) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  initials: row.initials,
  active: Number(row.active) === 1,
})

/*
 * Staff changes have to reach other devices, so they are logged like any other
 * change. rowToPayload is what strips the PIN columns, so it is used here too
 * rather than serialising the row directly.
 */
async function logStaff(db, { entityId, row, actorId }) {
  const { rowToPayload } = await import('./sync.js')
  await db.run(
    `INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
     VALUES (?, 'employees', ?, 'upsert', ?, ?, ?, ?, 'server')`,
    [randomUUID(), entityId, Number(row.version) || 1, JSON.stringify(rowToPayload('employees', row)), new Date().toISOString(), actorId],
  )
}