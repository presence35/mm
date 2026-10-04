import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sqliteDriver } from './db/driver.js'
import { FULL_DDL } from './schema.js'
import { pull, registerDevice, touchDevice } from './sync.js'
import { T, syncColumnsFor, columnsFor } from './entities.js'

/*
 * Does an employee's PIN hash escape the server?
 *
 * entities.js claims pin_salt and pin_hash stay on the server. Two paths could
 * have broken that claim:
 *
 *   push   — closed already. Employees live in REFERENCE, not ENTITIES, so
 *            isKnown() rejects the op and a client cannot write a staff row at
 *            all. Verified below, because "it is rejected" is a load-bearing
 *            claim and not an assumption.
 *
 *   pull   — was open. A full rehydrate serialises every table, employees
 *            included, and it used the unrestricted column list. This is the
 *            path a phone takes after iOS evicts its offline data, so it is not
 *            a rare event.
 */

const freshDb = () => {
  const db = sqliteDriver(join(mkdtempSync(join(tmpdir(), 'mm-pin-')), 't.db'))
  db.exec(FULL_DDL)
  return db
}

/* An employee row as the server holds it, credentials and all. */
async function seedStaff(db) {
  await db.run(
    `INSERT INTO ${T('employees')}
       (id, name, role, initials, pin_salt, pin_hash, active, created_at, updated_at, version, rev)
     VALUES ('emp-2', 'Bo Lindqvist', 'mechanic', 'BL', 'SALTSALT', 'HASHHASH', 1, ?, ?, 1, 0)`,
    ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
  )
}

test('a client cannot write a staff row through sync at all', async () => {
  const db = freshDb()
  const { push } = await import('./sync.js')

  const [{ result, reason }] = await push(db, {
    deviceId: 'dev-a',
    actorId: 'emp-admin',
    role: 'admin',
    ops: [
      {
        op_id: 'op-1',
        entity: 'employees',
        entity_id: 'emp-9',
        op: 'upsert',
        rev: 0,
        payload: { id: 'emp-9', name: 'Mallory', role: 'admin', pin_hash: 'chosen-by-me' },
      },
    ],
  })

  assert.equal(result, 'rejected')
  assert.equal(reason, 'unknown_entity', 'otherwise a mechanic could make themselves an admin')

  const row = await db.get(`SELECT * FROM ${T('employees')} WHERE id = ?`, ['emp-9'])
  assert.equal(row, null, 'nothing was written')
  await db.close?.()
})

test('a PIN hash never leaves the server in a full rehydrate', async () => {
  const db = freshDb()
  await seedStaff(db)

  /* Force the rehydrate path: the device is ahead of where our change log
     begins, which is what a phone looks like after its offline data is evicted
     and the log has been trimmed past it. */
  await registerDevice(db, { deviceId: 'dev-a', label: 'A', platform: 'web', employeeId: 'emp-admin' })
  await touchDevice(db, 'dev-a', 5)

  const { changes, full_sync: full } = await pull(db, { cursor: 0 })
  assert.equal(full, true, 'this must be the rehydrate path, not a delta')

  const employees = changes.filter((c) => c.entity === 'employees')
  assert.equal(employees.length, 1, 'staff still sync — they must, for assignments to resolve')

  const wire = JSON.stringify(changes)
  assert.ok(!wire.includes('HASHHASH'), 'pin_hash reached a client')
  assert.ok(!wire.includes('SALTSALT'), 'pin_salt reached a client')

  /* And the useful fields did arrive. */
  assert.equal(employees[0].payload.name, 'Bo Lindqvist')
  assert.equal(employees[0].payload.role, 'mechanic')
  await db.close?.()
})

test('nothing is sitting in the change log waiting to be served', async () => {
  const db = freshDb()
  await seedStaff(db)

  /* Simulate a staff change made by a dedicated route, which logs the row. */
  const { rowToPayload } = await import('./sync.js')
  const row = await db.get(`SELECT * FROM ${T('employees')} WHERE id = ?`, ['emp-2'])
  await db.run(
    `INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
     VALUES ('op-x', 'employees', 'emp-2', 'upsert', 2, ?, ?, 'emp-admin', 'server')`,
    [JSON.stringify(rowToPayload('employees', row)), new Date().toISOString()],
  )

  const logged = await db.get(`SELECT payload FROM ${T('change_log')} WHERE entity = 'employees'`)
  assert.ok(!String(logged.payload).includes('HASHHASH'), 'credentials reached the change log')
  await db.close?.()
})

test('the sync column list is what excludes secrets, and the full list is not', async () => {
  const synced = syncColumnsFor('employees')
  const full = columnsFor('employees')

  assert.ok(!synced.includes('pin_hash'), 'sync must not carry pin_hash')
  assert.ok(!synced.includes('pin_salt'), 'sync must not carry pin_salt')
  assert.ok(full.includes('pin_hash'), 'the legacy import still needs the real hash')
  assert.ok(full.includes('pin_salt'))

  /* Nothing else lost: the fields a client legitimately needs are all there. */
  for (const c of ['id', 'name', 'role', 'initials', 'active', 'rev', 'version']) {
    assert.ok(synced.includes(c), `${c} must still sync`)
  }
})

test('an entity with no secrets is unaffected', () => {
  assert.deepEqual(syncColumnsFor('customers'), columnsFor('customers'))
})