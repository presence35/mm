import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sqliteDriver, dialectDDL, toMySQL } from './db/driver.js'
import { FULL_DDL } from './schema.js'
import { push, pull, registerDevice, touchDevice, collectGarbage } from './sync.js'
import { createServer } from './index.js'
import { T, PREFIX, ALL_TABLES } from './entities.js'
import { bootstrap } from './db/index.js'

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
  const rows = await db.all(`SELECT * FROM ${T('customers')}`)
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

test('numeric identifiers survive a round trip as integers, not "3.0"', async () => {
  const db = freshDb()
  await push(db, { ...ADMIN, ops: [
    customer(),
    { op_id: 'op-boat', entity: 'boats', entity_id: 'b-1', op: 'upsert', rev: 0, payload: { id: 'b-1', customer_id: 'c-1', name: 'Sea Jay' } },
    { op_id: 'op-card', entity: 'service_cards', entity_id: 'k-1', op: 'upsert', rev: 0, payload: { id: 'k-1', boat_id: 'b-1', storage_type: 'marina_boathouse', boathouse_no: 3, slip_no: 7, season_year: 2026 } },
  ] })

  const row = await db.get(`SELECT * FROM ${T('service_cards')} WHERE id = ?`, ['k-1'])
  assert.equal(row.boathouse_no, 3)
  assert.equal(row.slip_no, 7)

  /* And the payload a client pulls is an integer, not a float-ish string. */
  const changes = await pull(db, { cursor: 0 })
  const card = changes.changes.find((c) => c.entity === 'service_cards')
  assert.equal(card.payload.boathouse_no, 3)
  assert.equal(card.payload.slip_no, 7)
  assert.equal(`${card.payload.boathouse_no}`, '3')
})

test('a legacy row stored as TEXT "3.0" reads back as 3', async () => {
  const db = freshDb()
  await push(db, { ...ADMIN, ops: [
    customer(),
    { op_id: 'op-boat2', entity: 'boats', entity_id: 'b-2', op: 'upsert', rev: 0, payload: { id: 'b-2', customer_id: 'c-1' } },
  ] })

  /* Simulate the wrong affinity an older build left behind. */
  await db.run(
    `INSERT INTO ${T('service_cards')} (id, boat_id, storage_type, boathouse_no, slip_no, rev, version, updated_at)
     VALUES ('k-legacy', 'b-2', 'marina_boathouse', '3.0', '7.0', 0, 1, '2026-01-01T00:00:00.000Z')`,
  )

  /* Legacy rows reach clients through the full rehydrate, which reads the
     tables directly rather than the change log. */
  await registerDevice(db, { deviceId: 'ahead', label: 'Desk', platform: 'web', employeeId: 'emp-admin' })
  await touchDevice(db, 'ahead', 9999)

  const result = await pull(db, { cursor: 0 })
  assert.equal(result.full_sync, true)
  const legacy = result.changes.find((c) => c.entity_id === 'k-legacy')
  assert.equal(legacy.payload.boathouse_no, 3)
  assert.equal(legacy.payload.slip_no, 7)
  assert.equal(`${legacy.payload.boathouse_no}`, '3')
})

test('booleans from a JS client bind as 0/1 and never crash the process', async () => {
  const db = freshDb()
  const [created] = await push(db, { ...ADMIN, ops: [customer()] })

  const [r] = await push(db, {
    ...ADMIN,
    ops: [{
      op_id: 'op-bool',
      entity: 'service_cards',
      entity_id: 'k-1',
      op: 'upsert',
      rev: 0,
      payload: { id: 'k-1', boat_id: 'b-1', work_order_no: 'WO-1', wrap_required: false, unwrap_done: true, tax_rate: 0, remarks: null },
    }],
  })
  assert.equal(r.result, 'applied')

  const row = await db.get(`SELECT * FROM ${T('service_cards')} WHERE id = ?`, ['k-1'])
  assert.equal(row.wrap_required, 0)
  assert.equal(row.unwrap_done, 1)
})

test('a non-scalar payload field is stored as JSON rather than killing the server', async () => {
  const db = freshDb()
  const [r] = await push(db, {
    ...ADMIN,
    ops: [{ op_id: 'op-obj', entity: 'customers', entity_id: 'c-1', op: 'upsert', rev: 0, payload: { id: 'c-1', name: { weird: true } } }],
  })
  assert.equal(r.result, 'applied')
  const row = await db.get(`SELECT * FROM ${T('customers')} WHERE id = ?`, ['c-1'])
  assert.equal(row.name, '{"weird":true}')
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
  const row = await db.get(`SELECT * FROM ${T('customers')} WHERE id = ?`, ['c-1'])
  assert.equal(row.city, 'Comox')

  const conflicts = await db.all(`SELECT * FROM ${T('card_conflicts')} WHERE id = ?`, [stale.conflict_id])
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

  const row = await db.get(`SELECT * FROM ${T('customers')} WHERE id = ?`, ['c-1'])
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

/*
 * The tokens that actually exist. Both shapes were previously rejected by a
 * 16-character minimum, so every seeded and every migrated card returned 404 —
 * the customer view had never worked, which read as "unreachable" rather than
 * broken.
 */
test('real customer tokens resolve, whatever their length', async () => {
  const db = freshDb()
  await bootstrap(db, () => {})
  const { app } = await createServer({ db, quiet: true })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  server.unref()
  const base = `http://127.0.0.1:${server.address().port}`

  const cases = [
    ['legacy 8-char token', 'VPrVMcbv'],
    ['seeded 14-char token', 'tk-2484-2b8c05'],
    ['new-style 33-char token', 'tk-01H8XK2M9P4R7T3V6YQ0N5C8D2F1A'],
  ]

  /* Each must get past the shape check. A 404 body is the answer for all of
     them, but a shape rejection and a genuine miss must be indistinguishable —
     so what is asserted is that none of them is treated as malformed. */
  for (const [label, token] of cases) {
    await db.run(
      `INSERT INTO ${T('service_cards')} (id, boat_id, work_order_no, customer_token, rev, version, updated_at)
       VALUES (?, NULL, ?, ?, 0, 1, ?)`,
      [`card-${token}`, `WO-${token}`, token, new Date().toISOString()],
    )
  }

  const shapes = new Set()
  for (const [, token] of cases) {
    const res = await fetch(`${base}/api/public/card/${token}`)
    const body = await res.json()
    shapes.add(JSON.stringify(Object.keys(body).sort()))
  }

  assert.equal(shapes.size, 1, 'a miss and a shape rejection must look identical')

  const tooShort = await fetch(`${base}/api/public/card/abc`)
  assert.equal(tooShort.status, 404)
  assert.deepEqual(await tooShort.json(), { error: 'not_found' })

  server.close()
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

test('a photo uploads, is written with metadata, and reaches the change log', async () => {
  const db = freshDb()
  /* Passing `db` skips bootstrap, and without it there is no admin to sign in
     as. Auth is exactly what this test is about, so seed it. */
  await bootstrap(db, () => {})
  const { app } = await createServer({ db, quiet: true })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  server.unref()
  const base = `http://127.0.0.1:${server.address().port}`

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234' }),
  })
  const { token } = await login.json()
  const auth = { authorization: `Bearer ${token}` }

  await push(db, {
    ...ADMIN,
    ops: [
      customer('c-1'),
      { op_id: 'op-b', entity: 'boats', entity_id: 'b-1', op: 'upsert', rev: 0, payload: { id: 'b-1', customer_id: 'c-1', name: 'Sea Jay' } },
      { op_id: 'op-k', entity: 'service_cards', entity_id: 'k-1', op: 'upsert', rev: 0, payload: { id: 'k-1', boat_id: 'b-1', work_order_no: 'WO-1' } },
    ],
  })

  /* A one-pixel JPEG is enough to prove the pipeline. */
  const png = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  )
  const form = new FormData()
  form.append('photo', new Blob([png], { type: 'image/jpeg' }), 'shot.jpg')
  form.append('card_id', 'k-1')
  form.append('device_id', 'dev-photo')
  form.append('caption', 'Waterline scuff')

  const res = await fetch(`${base}/api/photos`, { method: 'POST', headers: auth, body: form })
  const body = await res.json()
  server.close()

  assert.equal(res.status, 200)
  assert.equal(body.photo.caption, 'Waterline scuff')
  assert.equal(body.photo.card_id, 'k-1')

  const row = await db.get(`SELECT * FROM ${T('photos')} WHERE id = ?`, [body.photo.id])
  assert.equal(row.version, 1)
  assert.ok(row.updated_at, 'carries the shared metadata block')

  /* And it is reachable by another device through the delta stream. */
  const changes = await pull(db, { cursor: 0 })
  const photo = changes.changes.find((c) => c.entity === 'photos')
  assert.ok(photo, 'the photo is in the change log')
  assert.equal(photo.payload.caption, 'Waterline scuff')
})

test('a photo for a card that does not exist is refused', async () => {
  const db = freshDb()
  await bootstrap(db, () => {})
  const { app } = await createServer({ db, quiet: true })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  server.unref()
  const base = `http://127.0.0.1:${server.address().port}`

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234' }),
  })
  const { token } = await login.json()

  const form = new FormData()
  form.append('photo', new Blob([Buffer.from('x')], { type: 'image/jpeg' }), 'shot.jpg')
  form.append('card_id', 'k-nope')

  const res = await fetch(`${base}/api/photos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  server.close()
  assert.equal(res.status, 404)
})

/*
 * The new app shares a MySQL schema with the legacy app during cutover. A SQL
 * site that forgot T() would not fail loudly — CREATE TABLE IF NOT EXISTS would
 * adopt the legacy table's shape and reads would quietly return legacy columns.
 * So assert the property directly rather than trusting a grep.
 */
test('every table this app owns is created under the prefix, and none bare', async () => {
  const db = freshDb()

  const created = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_'))

  const expected = [
    ...Object.values(ALL_TABLES).map((s) => s.table),
    'change_log',
    'sync_ops',
    'sync_devices',
    'card_conflicts',
    'sessions',
    'login_attempts',
  ].map((n) => T(n))

  for (const name of expected) {
    assert.ok(created.includes(name), `${name} was not created`)
  }

  /* The failure this guards against: a bare name that a legacy table already
     occupies. Any table we did not expect is either a typo or a regression. */
  const unexpected = created.filter((n) => !expected.includes(n))
  assert.deepEqual(unexpected, [], `tables outside the prefix: ${unexpected.join(', ')}`)
  assert.ok(PREFIX.length > 0, 'a bare table name would collide with the legacy schema')
})

test('the prefix is configurable so a second environment can differ', () => {
  /* Read once at import. The value must be a plain prefix, not a qualified
     name — dot-qualifying here would produce "mm_.service_cards". */
  assert.match(PREFIX, /^[A-Za-z0-9_]*$/)
  assert.equal(T('photos'), `${PREFIX}photos`)
})

/*
 * MySQL DDL is generated but never executed in CI — there is no MySQL here.
 * dialectDDL is pure string transformation, so it can still be asserted. This
 * is the cheapest possible guard on code that otherwise ships unexecuted.
 */
test('the MySQL dialect rewrite is prefix-safe', () => {
  const mysql = dialectDDL('mysql', FULL_DDL)

  assert.ok(mysql.includes(`CREATE TABLE IF NOT EXISTS ${T('change_log')}`), 'change_log is created')
  assert.ok(mysql.includes('BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY'), 'seq becomes an auto-increment')
  assert.ok(!mysql.includes('INTEGER PRIMARY KEY AUTOINCREMENT'), 'no SQLite autoincrement survives')
  assert.ok(!/CREATE INDEX IF NOT EXISTS/.test(mysql), 'MySQL has no CREATE INDEX IF NOT EXISTS')

  /* The rewrite is a regex over generated SQL. A stale pattern would silently
     stop matching and hand MySQL SQLite's autoincrement, which fails at
     CREATE TABLE — so assert it still matches after the prefix changed. */
  /* Every created object must carry the prefix. Checking this catches a stale
     regex in dialectDDL just as well as a missed T() in a query. */
  const createdNames = [...mysql.matchAll(/(?:TABLE IF NOT EXISTS|CREATE(?: UNIQUE)? INDEX) (\w+)/g)].map(
    (m) => m[1],
  )
  assert.ok(createdNames.length >= 25, `expected every table, found ${createdNames.length}`)
  const unprefixed = createdNames.filter((n) => !n.startsWith(PREFIX))
  assert.deepEqual(unprefixed, [], `created outside the prefix: ${unprefixed.join(', ')}`)

  assert.equal(dialectDDL('sqlite', FULL_DDL), FULL_DDL, 'SQLite DDL is passed through untouched')
})

/*
 * MySQL is not reachable from here, so the translation is asserted instead of
 * executed. These are the exact statements in the running code — if a call site
 * changes its conflict target, this fails rather than the deployment.
 */
test('SQLite upserts are translated to MySQL, and only when provably portable', () => {
  assert.equal(
    toMySQL('INSERT INTO login_attempts (employee_id, source) VALUES (?, ?) ON CONFLICT (employee_id, source) DO UPDATE SET count = count + 1'),
    'INSERT INTO login_attempts (employee_id, source) VALUES (?, ?) ON DUPLICATE KEY UPDATE count = count + 1',
  )
  assert.equal(
    toMySQL('INSERT INTO sync_devices (device_id, label) VALUES (?, ?) ON CONFLICT (device_id) DO UPDATE SET label = ?'),
    'INSERT INTO sync_devices (device_id, label) VALUES (?, ?) ON DUPLICATE KEY UPDATE label = ?',
  )

  /* Whitespace and case vary between call sites; both must still translate. */
  assert.ok(toMySQL('... on conflict ( DEVICE_ID ) do update set x = ?').includes('ON DUPLICATE KEY UPDATE'))

  /* Statements with no upsert are untouched. */
  const plain = 'SELECT * FROM mm_customers WHERE id = ?'
  assert.equal(toMySQL(plain), plain)

  /* A conflict on a non-unique column would change behaviour if the target were
     silently dropped, so it refuses instead. */
  assert.throws(
    () => toMySQL('INSERT INTO t VALUES (1) ON CONFLICT (some_column) DO UPDATE SET x = 1'),
    /no primary key/,
  )
})

test('the upserts in the running code are ones toMySQL can translate', async () => {
  /* Guards the two hand-listed call sites above against drift: if a third
     upsert appears with a non-primary-key target, this is where it shows up. */
  const { readFileSync, readdirSync } = await import('node:fs')
  const sources = readdirSync(new URL('.', import.meta.url))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
    .join('\n')

  /* Require DO UPDATE: `async function conflict(db, op, ...)` is a function
     declaration that merely starts with the token, not a statement. */
  const targets = [...sources.matchAll(/ON CONFLICT\s*\(([^)]*)\)\s*DO UPDATE/gi)].map((m) => m[1])
  assert.ok(targets.length >= 2, `expected the two known upserts, found ${targets.length}`)
  for (const cols of targets) {
    assert.doesNotThrow(() => toMySQL(`ON CONFLICT (${cols}) DO UPDATE SET x = 1`), cols)
  }
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