/*
 * Client <-> server integration.
 *
 * Runs the REAL client transport and the REAL store against the REAL server.
 * The only substitution is IndexedDB, which does not exist in Node — the shim
 * installs a global so no production module gains a port for testing.
 *
 * This is the test that proves local-first actually converges.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installIndexedDB } from './shim-indexeddb.js'

installIndexedDB()

/* A real temporary database. Sharing the dev one makes these tests depend on
   whatever was left behind by a previous run. */
process.env.DB_FILE = join(mkdtempSync(join(tmpdir(), 'mm-client-')), 'test.db')

const { createServer } = await import('./index.js')
const transport = await import('../src/engines/sync/transport.js')
const idb = await import('../src/engines/store/idb.js')

let base
let token
let server

test.after(() => {
  server?.close()
})

test('setup: server up, session in', async () => {
  const { app } = await createServer({ quiet: true })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  /* Without this the listening socket holds the event loop open and the test
     runner never exits. */
  server.unref()
  base = `http://127.0.0.1:${server.address().port}`
  transport.configureTransport({ base: `${base}/api` })

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '1234' }),
  })
  const body = await res.json()
  assert.equal(res.status, 200)
  token = body.token
  assert.equal(body.employee.role, 'admin')
})

test('a local write queues an op and does not need the network', async () => {
  await idb.putAndQueue('customers', { id: 'c-1', name: 'Marcus Reyes', city: 'Comox', version: 0 })
  const queued = await idb.pendingOps()
  assert.equal(queued.length, 1)
  assert.equal(queued[0].entity, 'customers')
  assert.equal(queued[0].rev, 0)
})

test('drain applies it to the server and empties the outbox', async () => {
  const result = await transport.drain(token, 'dev-1')
  assert.equal(result.applied, 1)
  assert.equal(result.conflicts, 0)

  const left = await idb.pendingOps()
  assert.equal(left.length, 0, 'acknowledged ops leave the outbox')

  const row = await fetch(`${base}/api/public/card/aaaaaaaaaaaaaaaa`)
  assert.equal(row.status, 404)

  const after = await idb.get('customers', 'c-1')
  assert.equal(after.version, 1, 'the client learns the new version')
  assert.equal(after.local_pending, false)
})

test('a second device pulling sees the change', async () => {
  await idb.wipe()
  await idb.setMeta('cursor', 0)

  const out = await transport.pullAll(token, 'dev-2')
  assert.equal(out.full, false)
  assert.ok(out.applied >= 1)

  const row = await idb.get('customers', 'c-1')
  assert.ok(row, 'the remote row arrived')
  assert.equal(row.city, 'Comox')
})

test('two devices editing offline: both survive, conflict is flagged', async () => {
  /* Device 2 already has the row at version 1. */
  const starting = await idb.get('customers', 'c-1')

  /* Two devices go offline and each edit the same field. */
  await idb.putAndQueue('customers', { ...starting, city: 'Courtney' })
  await idb.putAndQueue('customers', { ...starting, city: 'Nanaimo' })

  const queued = await idb.pendingOps()
  assert.equal(queued.length, 2)

  /* Device 2 reconnects first and takes the row. */
  const win = await transport.push(token, 'dev-2', [toOp(queued[0])])
  assert.equal(win[0].result, 'applied')
  assert.equal(win[0].version, 2)
  await idb.ackOps([queued[0].op_id])

  /* Device 1 now pushes with a rev the server has moved past. */
  const lose = await transport.push(token, 'dev-1', [toOp(queued[1])])
  assert.equal(lose[0].result, 'conflict')
  assert.ok(lose[0].conflict_id)
})

test('the conflict is recorded with both payloads and nothing is lost', async () => {
  /* Draining is what turns a conflict response into a stored, reviewable
     conflict. A bare push does not — it is the drain that owns that rule. */
  const result = await transport.drain(token, 'dev-1')
  assert.equal(result.conflicts, 1)

  const open = await idb.openConflicts()
  assert.equal(open.length, 1)
  const c = open[0]
  assert.equal(c.local_payload.city, 'Nanaimo', 'the losing edit is preserved locally')
  assert.equal(c.server_version, 2)

  /* The server still holds device 2's value, not the stale one. */
  const remote = await transport.pull(token, 0, '')
  const hit = remote.changes.filter((x) => x.entity === 'customers' && x.entity_id === 'c-1').pop()
  assert.equal(hit.payload.city, 'Courtney')

  /* And the stale op is out of the outbox, so it cannot loop forever. */
  assert.equal((await idb.pendingOps()).filter((o) => o.entity_id === 'c-1').length, 0)
})

test('resolving a conflict converges instead of forking', async () => {
  const open = await idb.openConflicts()
  const c = open[0]

  await transport.resolveConflict(token, c.id, {
    resolution: 'kept_local',
    payload: { ...c.local_payload, city: 'Nanaimo' },
    deviceId: 'dev-1',
  })
  await idb.resolveConflict(c.id, 'resolved', 'kept_local')

  assert.equal((await idb.openConflicts()).length, 0)

  const remote = await transport.pull(token, 0, '')
  const latest = remote.changes.filter((x) => x.entity === 'customers' && x.entity_id === 'c-1').pop()
  assert.equal(latest.payload.city, 'Nanaimo')
})

test('pull never clobbers a row with unsynced local edits', async () => {
  await idb.putAndQueue('customers', { id: 'c-2', name: 'Priya Anand', city: 'Courtenay', version: 0 })
  await idb.put('customers', { id: 'c-2', name: 'Priya Anand', city: 'LOCAL EDIT', version: 0, local_pending: true })

  await transport.pullAll(token, 'dev-1')

  const row = await idb.get('customers', 'c-2')
  assert.equal(row.city, 'LOCAL EDIT', 'the local edit survived the pull')
  const stillQueued = (await idb.pendingOps()).filter((o) => o.entity_id === 'c-2')
  assert.equal(stillQueued.length, 1)
})

test('a second device seeding the same snapshot does not conflict with itself', async () => {
  /* The bootstrap snapshot is queued, so two fresh devices both try to create
     the same rows. The second must recognise the first's work rather than
     push a stale rev and manufacture a conflict. */
  await idb.wipe()
  await idb.setMeta('cursor', 0)

  await idb.putAndQueue('customers', { id: 'c-seed', name: 'Seeded Person', city: 'Comox', version: 0 })
  const first = await transport.drain(token, 'dev-A')
  assert.equal(first.applied, 1)

  /* Device B seeds the same row and then pulls before pushing. */
  await idb.putAndQueue('customers', { id: 'c-seed', name: 'Seeded Person', city: 'Comox', version: 0 })
  await transport.pullAll(token, 'dev-B')

  const remaining = (await idb.pendingOps()).filter((o) => o.entity_id === 'c-seed')
  assert.equal(remaining.length, 0, 'the duplicate seed op was dropped')

  const result = await transport.drain(token, 'dev-B')
  assert.equal(result.conflicts, 0, 'no conflict manufactured against our own snapshot')
})

test('a conflict gains the server payload after a pull, so it can be compared', async () => {
  await idb.wipe()
  await idb.setMeta('cursor', 0)

  const ID = 'c-conflict-probe'
  await idb.putAndQueue('customers', { id: ID, name: 'Probe Person', city: 'Comox', version: 0 })
  await transport.drain(token, 'dev-1')

  /* Two devices, both at version 1. */
  const starting = await idb.get('customers', ID)
  assert.equal(starting.version, 1)

  await idb.putAndQueue('customers', { ...starting, city: 'Courtney' })
  await idb.putAndQueue('customers', { ...starting, city: 'Nanaimo' })
  const queued = await idb.pendingOps()
  assert.equal(queued.length, 2)

  await transport.push(token, 'dev-2', [toOp(queued[0])])
  await idb.ackOps([queued[0].op_id])

  /* Draining records the conflict; the following pull brings the server's
     side so a worker can actually choose between the two. */
  const res = await transport.drain(token, 'dev-1')
  assert.equal(res.conflicts, 1)
  await transport.pullAll(token, 'dev-1')

  const open = await idb.openConflicts()
  const c = open.find((x) => x.entity_id === ID)
  assert.ok(c, 'the conflict is stored against this row')
  assert.equal(c.local_payload.city, 'Nanaimo')
  assert.ok(c.server_payload, 'the server side was attached')
  assert.equal(c.server_payload.city, 'Courtney')
})

test('a conflict can be resolved offline without a network call', async () => {
  const ID = 'c-conflict-probe'
  const c = (await idb.openConflicts()).find((x) => x.entity_id === ID)
  assert.ok(c, 'a conflict is open from the previous test')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  try {
    /* Resolving writes the chosen version locally and queues it. The push to
       the server is best-effort; the choice is not lost either way. */
    const row = await idb.get(c.entity, c.entity_id)
    await idb.putAndQueue(c.entity, { ...row, ...c.local_payload })
    await idb.resolveConflict(c.id, 'resolved', 'kept_local')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal((await idb.openConflicts()).filter((x) => x.entity_id === ID).length, 0)
  const queued = (await idb.pendingOps()).filter((o) => o.entity_id === ID)
  assert.ok(queued.length >= 1, 'the chosen version is queued for when signal returns')
  const row = await idb.get(c.entity, ID)
  assert.equal(row.city, 'Nanaimo')
})

test('reference data never carries PIN hashes', async () => {
  const ref = await transport.reference(token)
  assert.ok(Array.isArray(ref.employees))
  const serialised = JSON.stringify(ref)
  assert.equal(serialised.includes('pin_hash'), false)
  assert.equal(serialised.includes('pin_salt'), false)
})

test('the transport reports offline rather than failing a write', async () => {
  const before = await idb.pendingOps()
  await idb.putAndQueue('customers', { id: 'c-3', name: 'Joelle T', version: 0 })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  try {
    await assert.rejects(() => transport.drain(token, 'dev-1'), (e) => e.offline === true)
  } finally {
    globalThis.fetch = originalFetch
  }

  const after = await idb.pendingOps()
  assert.equal(after.length, before.length + 1, 'the write is still queued, not lost')
})

function toOp(o) {
  return { op_id: o.op_id, entity: o.entity, entity_id: o.entity_id, op: o.op, rev: o.rev, payload: o.payload, conflict_id: o.conflict_id }
}