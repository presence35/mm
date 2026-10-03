import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sqliteDriver } from './db/driver.js'
import { FULL_DDL } from './schema.js'
import { push, pull, registerDevice, touchDevice, collectGarbage } from './sync.js'
import { createServer } from './index.js'

function freshDb() {
  const file = join(mkdtempSync(join(tmpdir(), 'mm-')), 't.db')
  const db = sqliteDriver(file)
  db.exec(FULL_DDL)
  return db
}

const ADMIN = { deviceId: 'dev-a', actorId: 'emp-admin', role: 'admin' }
const MECH = { deviceId: 'dev-b', actorId: 'emp-m2', role: 'mechanic' }

const customer = (id = 'c-1') => ({ op_id: `op-${id}`, entity: 'customers', entity_id: id, op: 'upsert', rev: 0, payload: { id, name: 'Marcus Reyes', phone: '250-555-0142' } })

test('a create is applied at version 1', async () => {
  const db = freshDb()
  const [r] = await push(db, { ...ADMIN, ops: [customer()] })
  assert.equal(r.result, 'applied')
  assert.equal(r.version, 1)
})

test('replaying the same op_id returns the original result and does not double-apply', async () => {
  const db = freshDb()
  const op = customer()
  const [first] = await push(db, { ...ADMIN, ops: [op] })
  const [second] = await push(db, { ...ADMIN, ops: [op] })
  assert.deepEqual(second, first)
  const rows = await db.all('SELECT * FROM customers')
  assert.equal(rows.length, 1)
})

test('an edit must present the version it saw', async () => {
  const db = freshDb()
  const [created] = await push(db, { ...ADMIN, ops: [customer()] })
  const [edited] = await push(db, {
    ...ADMIN,
    ops: [{ op_id: 'op-e1', entity: 'customers', entity_id: 'c-1', op: 'upsert', rev: created.version, payload: { name: 'Marcus R.' } }],
  })
  assert.equal(edited.result, 'applied')
  assert.equal(edited.version, 2)
})

test('a stale edit does not overwrite and preserves both versions', async () => {
  const db = freshDb()
  const [created] = await push(db, { ...ADMIN, ops: [customer()] })

  // Two devices that both saw version 1. Office can write customers; a
  // mechanic cannot, so both act as office here.
  const deviceB = { deviceId: 'dev-b', actorId: 'emp-o', role: 'office' }
  await push(db, { ...deviceB, ops: [{ op_id: 'op-b1', entity: 'customers', entity_id: 'c-1', op: 'upsert', rev: created.version, payload: { city: 'Comox' } }] })

  // Device A still thinks it is at 1 and writes something different.
  const [stale] = await push(db, {
    ...ADMIN,
    ops: [{ op_id: 'op-a1', entity: 'customers', entity_id: 'c-1', op: 'upsert', rev: created.version, payload: { city: 'Campbell River' } }],
  })

  assert.equal(stale.result, 'conflict')
  assert.ok(stale.conflict_id)

  // The server keeps what it had; the other version is not lost.
  const row = await db.get('SELECT * FROM customers WHERE id = ?', ['c-1'])
  assert.equal(row.city, 'Comox')

  const conflicts = await db.all('SELECT * FROM card_conflicts WHERE id = ?', [stale.conflict_id])
  assert.equal(conflicts.length, 1)
  assert.equal(JSON.parse(conflicts[0].local_payload).city, 'Campbell River')
  assert.equal(JSON.parse(conflicts[0].server_payload).city, 'Comox')
})

test('pull returns only what changed since the cursor', async () => {
  const db = freshDb()
  const [first] = await push(db, { ...ADMIN, ops: [customer()] })

  const empty = await pull(db, { cursor: first.seq })
  assert.equal(empty.changes.length, 0)

  await push(db, { ...ADMIN, ops: [{ op_id: 'op-c9', entity: 'customers', entity_id: 'c-2', op: 'upsert', rev: 0, payload: { id: 'c-2', name: 'Priya Anand' } }] })

  const delta = await pull(db, { cursor: first.seq })
  assert.equal(delta.changes.length, 1)
  assert.equal(delta.changes[0].entity_id, 'c-2')
  assert.equal(delta.full_sync, false)
})

test('seq is monotonic across entities', async () => {
  const db = freshDb()
  const a = await push(db, { ...ADMIN, ops: [customer('c-1')] })
  const b = await push(db, { ...ADMIN, ops: [customer('c-2')] })
  assert.ok(b[0].seq > a[0].seq)
})

test('a mechanic cannot write a customer', async () => {
  const db = freshDb()
  const [r] = await push(db, { ...MECH, ops: [customer('c-9')] })
  assert.equal(r.result, 'rejected')
  assert.equal(r.reason, 'unauthorized_entity')
})

test('an unknown entity is rejected, not silently dropped', async () => {
  const db = freshDb()
  const [r] = await push(db, { ...ADMIN, ops: [{ op_id: 'x', entity: 'drop_table', entity_id: 'x', op: 'upsert', rev: 0, payload: {} }] })
  assert.equal(r.result, 'rejected')
  assert.equal(r.reason, 'unknown_entity')
})

test('a rejected op is consumed so a stale retry cannot be replayed', async () => {
  const db = freshDb()
  const op = { op_id: 'dup-1', entity: 'nope', entity_id: 'x', op: 'upsert', rev: 0, payload: {} }
  const [first] = await push(db, { ...ADMIN, ops: [op] })
  assert.equal(first.result, 'rejected')

  const [retry] = await push(db, { ...ADMIN, ops: [{ ...op, entity: 'customers' }] })
  assert.equal(retry.result, 'rejected')
  assert.equal(retry.reason, 'unknown_entity')
})

test('delete is a tombstone, never a hard delete', async () => {
  const db = freshDb()
  const [created] = await push(db, { ...ADMIN, ops: [customer()] })
  const [del] = await push(db, { ...ADMIN, ops: [{ op_id: 'op-del', entity: 'customers', entity_id: 'c-1', op: 'delete', rev: created.version }] })
  assert.equal(del.result, 'applied')

  const row = await db.get('SELECT * FROM customers WHERE id = ?', ['c-1'])
  assert.ok(row, 'row still exists')
  assert.ok(row.deleted_at, 'tombstoned')
})

test('garbage collection keeps anything a live device has not seen', async () => {
  const db = freshDb()
  const [first] = await push(db, { ...ADMIN, ops: [customer()] })

  await registerDevice(db, { deviceId: 'slow', label: 'Old phone', platform: 'ios', employeeId: 'emp-m2' })
  await touchDevice(db, 'slow', 0) // dark device, has seen nothing

  const fresh = new Date()
  const r = await collectGarbage(db, { now: fresh })
  assert.equal(r.deleted, 0, 'the dark device still needs seq 1')
  assert.ok(first.seq > 0)
})

test('a cursor below the GC floor triggers a full rehydrate', async () => {
  const db = freshDb()
  await registerDevice(db, { deviceId: 'ahead', label: 'Desk', platform: 'web', employeeId: 'emp-admin' })
  const [first] = await push(db, { ...ADMIN, ops: [customer()] })
  await touchDevice(db, 'ahead', first.seq)

  // A device that comes back below the floor cannot be served a delta.
  const result = await pull(db, { cursor: 0 })
  assert.equal(result.full_sync, true)
  assert.ok(result.changes.length >= 1)
  assert.equal(result.changes[0].entity, 'customers')
})

/* ---------------------------------------------------------- over HTTP */

test('the public endpoint serves only the projection', async () => {
  const db = freshDb()
  const { app } = await createServer({ db, quiet: true })

  await push(db, { ...ADMIN, ops: [
    customer(),
    { op_id: 'op-b', entity: 'boats', entity_id: 'b-1', op: 'upsert', rev: 0, payload: { id: 'b-1', customer_id: 'c-1', name: 'Sea Jay', model: 'Yamaha 200', length_ft: 24 } },
    { op_id: 'op-card', entity: 'service_cards', entity_id: 'k-1', op: 'upsert', rev: 0, payload: { id: 'k-1', boat_id: 'b-1', work_order_no: 'WO-2481', season_year: 2026, status: 'intake', customer_token: 'tok-abcdefghijklmnop', other_work: 'SECRET internal note', remarks: 'SECRET remarks' } },
  ] })

  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const res = await fetch(`${base}/api/public/card/tok-abcdefghijklmnop`)
  const body = await res.json()
  server.close()

  assert.equal(res.status, 200)
  assert.equal(body.customer_name, 'Marcus Reyes')
  assert.equal(body.boat.name, 'Sea Jay')

  const serialised = JSON.stringify(body)
  for (const secret of ['SECRET', 'other_work', 'remarks']) {
    assert.equal(serialised.includes(secret), false, `${secret} must not be served`)
  }
  assert.equal(res.headers.get('cache-control'), 'no-store')
})

test('unknown and malformed tokens are indistinguishable', async () => {
  const db = freshDb()
  const { app } = await createServer({ db, quiet: true })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const unknown = await fetch(`${base}/api/public/card/aaaaaaaaaaaaaaaa`)
  const malformed = await fetch(`${base}/api/public/card/short`)
  server.close()

  assert.equal(unknown.status, 404)
  assert.equal(malformed.status, 404)
  assert.equal(await unknown.text(), await malformed.text())
})

test('sync routes require a session', async () => {
  const db = freshDb()
  const { app } = await createServer({ db, quiet: true })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const pull = await fetch(`${base}/api/sync/pull?cursor=0`)
  const pushRes = await fetch(`${base}/api/sync/push`, { method: 'POST', body: '{}' })
  server.close()

  assert.equal(pull.status, 401)
  assert.equal(pushRes.status, 401)
})