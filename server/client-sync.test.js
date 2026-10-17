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
import { listenTest } from './test-listen.js'

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
  ;({ server, base } = await listenTest(app))
  /* Without this the listening socket holds the event loop open and the test
     runner never exits. */
  server.unref()
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

/* Sessions slide: validating renews. Without this the client keeps a token that
   the server has already aged out, and a device that is used every day still
   lands on the sign-in screen — the exact "app forgot me" complaint. */
test('auth/me reissues a working token', async () => {
  const first = await transport.me(token)
  assert.ok(first.token, 'validation returns a replacement token')
  assert.equal(first.employee.role, 'admin')

  const second = await transport.me(first.token)
  assert.equal(second.employee.id, first.employee.id, 'the replacement token is accepted')
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

test('a second device writing the same rows does not conflict with itself', async () => {
  /* A row created on two devices before either has synced is the same edit
     arriving twice. The second must recognise the first's work rather than
     push a stale rev and manufacture a conflict. */
  await idb.wipe()
  await idb.setMeta('cursor', 0)

  await idb.putAndQueue('customers', { id: 'c-seed', name: 'Seeded Person', city: 'Comox', version: 0 })
  const first = await transport.drain(token, 'dev-A')
  assert.equal(first.applied, 1)

  /* Device B writes the same row and then pulls before pushing. */
  await idb.putAndQueue('customers', { id: 'c-seed', name: 'Seeded Person', city: 'Comox', version: 0 })
  await transport.pullAll(token, 'dev-B')

  const remaining = (await idb.pendingOps()).filter((o) => o.entity_id === 'c-seed')
  assert.equal(remaining.length, 0, 'the duplicate op was dropped')

  const result = await transport.drain(token, 'dev-B')
  assert.equal(result.conflicts, 0, 'no conflict manufactured against its own work')
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

test('rows this device creates are queued once each, and converge after a joining pull', async () => {
  const store = await import('../src/engines/store/localStore.js')
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.reload()

  /* Nothing queued itself on boot — the store seeds nothing — so the rows in
     play are the ones this device creates, one op each. */
  assert.equal((await idb.pendingOps()).length, 0, 'a boot queues nothing of its own')

  const customer = await store.createCustomer({ name: 'Round Trip', city: 'Comox' })
  const card = await store.createCard({ boat_id: 'b-1', work_order_no: 'WO-ONCE', season_year: 2026 })

  const queued = await idb.pendingOps()
  assert.equal(queued.length, 2)
  const seen = new Set()
  for (const op of queued) {
    const key = `${op.entity}:${op.entity_id}`
    assert.equal(seen.has(key), false, `duplicate op queued for ${key}`)
    seen.add(key)
  }
  assert.deepEqual(
    queued.map((o) => o.entity_id).sort(),
    [card.id, customer.id].sort(),
  )

  /* A joining device pulls first: the pull brings the server's version of
     anything it already holds and dropSuperseded discards the duplicate local
     ops. */
  await transport.pullAll(token, 'dev-fresh')
  const result = await transport.drain(token, 'dev-fresh')
  assert.equal(result.conflicts, 0, `a fresh device produced ${result.conflicts} conflicts against its own rows`)
  assert.equal((await idb.pendingOps()).length, 0)
  assert.equal(store.getCustomer(customer.id).customer.name, 'Round Trip')
})

/* One page is not one marina. The server caps a page and reports has_more; a
   client that ignores it stores a fragment and reports success, which is how a
   device ends up "up to date" holding 200 of 1100 rows with no error anywhere. */
test('a pull follows has_more to exhaustion instead of keeping only the first page', async () => {
  const store = await import('../src/engines/store/localStore.js')
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.hydrate()

  /* Enough rows that one page cannot hold them. The client asks for PULL_LIMIT
     (200) per pull, so the count has to clear that for paging to happen at
     all — which is the point: the old client stopped at one page whatever the
     size of the log. */
  const MANY = 210
  for (let i = 0; i < MANY; i += 1) {
    store.createCustomer({ name: `Paged ${i}`, city: 'Comox' })
  }
  await transport.drain(token, 'dev-paged')

  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.reload()

  const out = await transport.pullAll(token, 'dev-paged-2')
  assert.ok(out.pages > 1, `expected more than one page, took ${out.pages}`)
  assert.equal(out.caughtUp, true, 'the client must reach the end of the log, not stop short of it')

  /* The projection reads IndexedDB, and the sync cycle rebuilds it after the
     pull — not before it. Asserting on the store without this reload would be
     asserting on the page we loaded, not on what the pull wrote. */
  await store.reload()
  const names = store.listCustomers().map((c) => c.name).filter((n) => n.startsWith('Paged '))
  assert.equal(names.length, MANY, `device holds ${names.length} of ${MANY} rows the server has`)
})

test('a pull reports rows it could not store instead of warning into a console nobody opens', async () => {
  const store = await import('../src/engines/store/localStore.js')
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.hydrate()
  store.createCustomer({ name: 'Reportable', city: 'Comox' })
  await transport.drain(token, 'dev-report')

  const out = await transport.pullAll(token, 'dev-report-2')
  assert.ok(Array.isArray(out.applyErrors), 'applyErrors must reach the caller, not just console.warn')
  assert.equal(typeof out.caughtUp, 'boolean', 'and so must whether the log was drained')
  assert.ok(out.pages >= 1, 'and how many pages it took')
})

test('a work log survives the round trip as its own entity', async () => {
  const store = await import('../src/engines/store/localStore.js')
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.hydrate()

  /* Nothing is seeded, so the card under test is one this device created. It is
     drained first, so the assertion below is about the log and nothing else. */
  const card = await store.createCard({ boat_id: 'b-1', work_order_no: 'WO-LOG', season_year: 2026 })
  await transport.drain(token, 'dev-create')
  assert.equal((await idb.pendingOps()).length, 0)

  const before = store.getCard(card.id).card.logs.length

  /* A mechanic writes a log entry with no signal. */
  store.addLog(card.id, { id: 'test-1', employee_id: 'emp-1', name: 'Bo', date: '2026-10-03', description: 'Lower unit drained' })

  const withLog = store.getCard(card.id).card
  assert.equal(withLog.logs.length, before + 1)

  /* It is queued against the work_logs entity, not the card. */
  const queued = await idb.pendingOps()
  const logOps = queued.filter((o) => o.entity === 'work_logs')
  assert.equal(logOps.length, 1, 'queued as its own entity')
  assert.equal(logOps[0].payload.description, 'Lower unit drained')
  assert.equal(logOps[0].payload.card_id, card.id)
  assert.equal(logOps[0].entity_id, logOps[0].payload.id)

  const result = await transport.drain(token, 'dev-log')
  assert.equal(result.applied, 1)

  /* And a second device pulls it. */
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await transport.pullAll(token, 'dev-reader')
  const pulled = await idb.all('work_logs')
  assert.ok(pulled.some((r) => r.description === 'Lower unit drained'), 'the log reached the server and came back')
})

test('ticking the same task twice updates one row, not two', async () => {
  const store = await import('../src/engines/store/localStore.js')
  /* Self-contained: nothing is seeded, so this device creates the card it ticks. */
  const card = await store.createCard({ boat_id: 'b-1', work_order_no: 'WO-TICK', season_year: 2026 })
  await store.reload()

  const rows = () => (store.getCard(card.id).card.authorized_work ?? []).filter((w) => w.key === 'tune_up').length
  const start = rows()

  store.setAuthorizedWork(card.id, 'tune_up', { authorized: true })
  store.setAuthorizedWork(card.id, 'tune_up', { completed: true })

  assert.equal(rows(), start + 1, 'still exactly one row for that service')
  const entry = store.getCard(card.id).card.authorized_work.find((w) => w.key === 'tune_up')
  assert.equal(entry.authorized, true)
  assert.equal(entry.completed, true)
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

test('an employees change arrives via the reference store and does not wedge the pull', async () => {
  /* Regression: reference entities (employees, products, templates) have no
     store of their own. Routing them to idb.put threw, aborted the page
     before the cursor advanced, and hid every later change — including all
     service cards. The cursor must advance past the whole page regardless. */
  await transport.addStaff(token, { name: 'Pull Probe', role: 'mechanic', pin: '90210' })
  await idb.putAndQueue('customers', { id: 'c-pull-probe', name: 'Probe Customer', city: 'Comox', version: 0 })
  await transport.drain(token, await idb.deviceId(), new Date())

  await idb.wipe()
  await idb.setMeta('cursor', 0)
  const out = await transport.pullAll(token, await idb.deviceId(), new Date())

  assert.deepEqual(out.applyErrors, [])
  const roster = await idb.getReference('employees')
  const probe = roster.find((s) => s.name === 'Pull Probe')
  assert.ok(probe, 'staffer arrived via the reference store')
  assert.ok(!('pin_hash' in (probe ?? {})), 'no credential travels')
  assert.ok(await idb.get('customers', 'c-pull-probe'), 'later entities still land')
  assert.ok(Number(await idb.getMeta('cursor', 0)) > 0, 'cursor advanced past the page')
})

/*
 * A conflict is raised by a version that moved, not by a change. A device that
 * pushes the same rows twice — the old sample-data bootstrap did exactly that,
 * 41 rows at a time — produced one conflict per row, all identical, and each
 * asked a worker to choose between two versions with nothing between them.
 */
/*
 * A per-field merged resolution is the main path now: the worker taps This
 * device or Server beside each differing field, and one button commits the
 * combination. It must land as an ordinary convergent write at
 * server_version + 1, carrying the chosen fields from each side.
 */
/* The server caps a pull at one page and says so with has_more. A test reading
   "the latest change for X" off a single `pull(token, 0)` is asserting on the
   first page and only passes while the shared log happens to fit in one — which
   is the very defect the client had. Page until the server says it is done. */
async function pullAllChanges(cursor = 0, deviceId = '') {
  const changes = []
  let at = cursor
  for (;;) {
    const res = await transport.pull(token, at, deviceId)
    changes.push(...res.changes)
    at = res.cursor
    if (!res.has_more) return changes
  }
}

test('a per-field merged resolution keeps the chosen field from each side', async () => {
  const ID = 'c-merge-probe'
  await idb.putAndQueue('customers', { id: ID, name: 'Merge Person', city: 'Comox', version: 0 })
  await transport.drain(token, 'dev-1')

  const starting = await idb.get('customers', ID)
  assert.equal(starting.version, 1)

  /* Two devices diverge, each on a different field. */
  await idb.putAndQueue('customers', { ...starting, city: 'Courtney' })
  await idb.putAndQueue('customers', { ...starting, name: 'Merge Person Jr' })

  const queued = await idb.pendingOps()
  await transport.push(token, 'dev-2', [toOp(queued[0])])
  await idb.ackOps([queued[0].op_id])

  const [conflict] = await transport.push(token, 'dev-1', [toOp(queued[1])])
  assert.equal(conflict.result, 'conflict')
  await idb.ackOps([queued[1].op_id])

  const remote = await pullAllChanges()
  const latest = remote
    .filter((c) => c.entity === 'customers' && c.entity_id === ID)
    .pop()

  /* Take the name from this device, keep the city the server holds. */
  const merged = { ...latest.payload, name: 'Merge Person Jr' }
  const out = await transport.resolveConflict(token, conflict.conflict_id, {
    resolution: 'merged',
    payload: merged,
    deviceId: 'dev-1',
  })
  assert.equal(out.results[0].result, 'applied')
  assert.equal(out.results[0].version, latest.version + 1, 'an ordinary convergent write')

  const after = await pullAllChanges()
  const final = after
    .filter((c) => c.entity === 'customers' && c.entity_id === ID)
    .pop()
  assert.equal(final.payload.name, 'Merge Person Jr', 'the chosen field came from this device')
  assert.equal(final.payload.city, 'Courtney', 'the untouched field kept the server value')
})

test('a conflict with nothing to decide closes itself; a real one does not', async () => {
  const at = new Date().toISOString()

  await idb.addConflict({
    id: 'cf-same',
    entity: 'received_items',
    entity_id: 'ri-same',
    local_payload: { id: 'ri-same', card_id: 'k-x', item: 'paddles', present: 1 },
    server_payload: { id: 'ri-same', card_id: 'k-x', item: 'paddles', present: 1 },
    status: 'open',
    detected_at: at,
  })

  await idb.addConflict({
    id: 'cf-real',
    entity: 'received_items',
    entity_id: 'ri-real',
    local_payload: { id: 'ri-real', card_id: 'k-x', item: 'keys', present: 1 },
    server_payload: { id: 'ri-real', card_id: 'k-x', item: 'keys', present: 0 },
    status: 'open',
    detected_at: at,
  })

  /* No server side yet. "Not comparable" is not "agrees", and closing this
     would silently discard the only copy of a version we have not seen. */
  await idb.addConflict({
    id: 'cf-waiting',
    entity: 'customers',
    entity_id: 'c-waiting',
    local_payload: { id: 'c-waiting', name: 'Someone' },
    server_payload: null,
    status: 'open',
    detected_at: at,
  })

  const out = await transport.pullAll(token, 'dev-sweep')
  assert.ok(out.settled >= 1, 'the pull reports what it closed')

  const openIds = (await idb.openConflicts()).map((c) => c.id)
  assert.ok(!openIds.includes('cf-same'), 'two identical versions are not a decision')
  assert.ok(openIds.includes('cf-real'), 'a real disagreement stays in the queue')
  assert.ok(openIds.includes('cf-waiting'), 'not comparable yet is not agreement')

  const closed = (await idb.all('conflicts')).find((c) => c.id === 'cf-same')
  assert.equal(closed.status, 'resolved')
  /* A distinct value, so the record says it closed itself rather than claiming
     a person looked at it. */
  assert.equal(closed.resolution, 'identical')
  /* Merged, not replaced: the entity and both payloads survive resolution. */
  assert.equal(closed.entity, 'received_items')
  assert.ok(closed.local_payload && closed.server_payload)
  assert.equal(closed.detected_at, at)
})