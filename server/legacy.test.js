import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sqliteDriver } from './db/driver.js'
import { FULL_DDL } from './schema.js'
import { readTables, splitRows, splitValues, unquote, readInsertBlocks } from './legacy/reader.js'
import { plan, legacyId, toIso, ORDER } from './legacy/plan.js'
import { applyPlan, verify } from './legacy/apply.js'
import { importInto } from './legacy/import.js'
import { pull, push } from './sync.js'
import { T } from './entities.js'

const NOW = '2026-10-03T12:00:00.000Z'

function freshDb() {
  const file = join(mkdtempSync(join(tmpdir(), 'mm-mig-')), 't.db')
  const db = sqliteDriver(file)
  db.exec(FULL_DDL)
  return db
}

/* A miniature export in the legacy INSERT-only form. Small enough to reason
   about, shaped exactly like the real one. */
const DUMP = `
INSERT INTO \`employees\` (\`id\`, \`name\`, \`role\`, \`initials\`, \`pin_hash\`, \`active\`, \`created_at\`, \`pin_salt\`) VALUES
  (1, 'Admin', 'admin', 'AD', 'hash1', 1, '2026-06-16 19:36:40', 'salt1'),
  (2, 'Steven ', 'mechanic', 'ST', 'hash2', 1, '2026-06-17 14:08:07', NULL);

INSERT INTO \`customers\` (\`id\`, \`name\`, \`address\`, \`city\`, \`postal_code\`, \`phone\`, \`email\`, \`created_at\`, \`deleted_at\`) VALUES
  (1, 'Marcus Reyes', NULL, 'Campbell River', NULL, '250-555-0142', NULL, '2026-06-17 11:00:00', NULL),
  (2, 'Dana O''Brien', NULL, 'Campbell River', NULL, NULL, NULL, '2026-06-18 09:30:00', NULL);

INSERT INTO \`boats\` (\`id\`, \`customer_id\`, \`name\`, \`motor_type\`, \`serial_no\`, \`model\`, \`licence\`, \`trailer_licence\`, \`rate_type\`, \`length_ft\`, \`deleted_at\`) VALUES
  (1, 1, 'Sea Breeze', 'Yamaha 200', NULL, 'Sea Ray 240', 'Fgh', NULL, 'SW', '24.0', NULL),
  (2, 1, 'Kicker', 'Mercury I/O', '', 'Crownline', NULL, NULL, 'IN', '22.0', NULL);

INSERT INTO \`boat_serials\` (\`id\`, \`boat_id\`, \`type\`, \`serial_number\`, \`notes\`, \`created_at\`) VALUES
  (1, 1, 'engine', '3B120222', NULL, '2026-09-24 20:28:01');

INSERT INTO \`service_cards\` (\`id\`, \`work_order_no\`, \`boat_id\`, \`season_year\`, \`status\`, \`storage_type\`, \`storage_location\`, \`wrap_required\`, \`remarks\`, \`other_work\`, \`date_in\`, \`date_out\`, \`invoice_number\`, \`invoice_status\`, \`tax_rate\`, \`unwrap_done\`, \`storage_building\`, \`storage_row\`, \`storage_col\`, \`boathouse_no\`, \`slip_no\`, \`customer_token\`, \`pickup_delivery\`, \`created_by\`, \`created_at\`, \`updated_at\`, \`is_fake\`, \`is_scanned\`) VALUES
  (1, 'WO-1000', 1, 2026, 'invoiced', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, 'draft', '13.0', 0, NULL, NULL, NULL, NULL, NULL, 'VPrVMcbv', NULL, 1, '2026-06-17 11:49:00', '2026-06-20 08:00:00', 0, 0),
  (2, 'WO-1001', 2, 2026, 'intake', 'storage', 'Metal 2', 1, 'Needs a call', NULL, NULL, NULL, NULL, 'draft', '13.0', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, '2026-07-01 10:00:00', '2026-07-01 10:00:00', 0, 0);

INSERT INTO \`authorized_work\` (\`id\`, \`card_id\`, \`service_type\`, \`authorized\`, \`completed\`, \`notes\`, \`completed_by\`, \`completed_at\`, \`products_used\`) VALUES
  (1, 1, 'oil_change', 1, 1, 'done', 2, '2026-06-17 11:49:51', ''),
  (2, 2, 'Water intake hose leaking', 1, 0, NULL, NULL, NULL, '');

INSERT INTO \`received_items\` (\`id\`, \`card_id\`, \`item\`, \`present\`, \`notes\`) VALUES
  (1, 1, 'Life jacket', 1, NULL),
  (2, 1, 'Anchor', 0, 'left on dock');

INSERT INTO \`condition_assessment\` (\`id\`, \`card_id\`, \`area\`, \`rating\`, \`notes\`) VALUES
  (1, 1, 'hull', 'fair', 'scuff port side');

INSERT INTO \`work_logs\` (\`id\`, \`card_id\`, \`employee_id\`, \`log_date\`, \`description\`, \`transcription\`, \`voice_url\`, \`created_at\`) VALUES
  (1, 1, 2, '2026-06-17', 'Replaced impeller', NULL, NULL, '2026-06-17 15:00:00');

INSERT INTO \`photos\` (\`id\`, \`card_id\`, \`work_log_id\`, \`filename\`, \`photo_type\`, \`caption\`, \`uploaded_by\`, \`uploaded_at\`, \`gps_lat\`, \`gps_lng\`) VALUES
  (1, 1, NULL, '1781711335474-471507247.jpg', 'service_work', 'Service: oil_change', 2, '2026-06-17 15:48:55', NULL, NULL);

INSERT INTO \`status_history\` (\`id\`, \`card_id\`, \`from_status\`, \`to_status\`, \`employee_id\`, \`note\`, \`changed_at\`) VALUES
  (1, 1, 'intake', 'service', 2, NULL, '2026-06-17 12:00:00');

INSERT INTO \`invoice_items\` (\`id\`, \`card_id\`, \`description\`, \`quantity\`, \`unit_price\`, \`total\`, \`sort_order\`) VALUES
  (1, 1, 'Impeller', 1, '45.00', '45.00', 1);

INSERT INTO \`products\` (\`id\`, \`name\`, \`part_number\`, \`unit\`, \`category\`, \`unit_price\`, \`active\`, \`created_at\`) VALUES
  (1, 'Impeller', 'IMP-1', 'each', 'engine', '45.00', 1, '2026-06-16 10:00:00');

INSERT INTO \`service_item_templates\` (\`id\`, \`item_key\`, \`label\`, \`category\`, \`cleaning_cat\`, \`sort_order\`, \`unit_price\`, \`active\`, \`created_at\`) VALUES
  (1, 'oil_change', 'Oil change', 'engine', NULL, 1, NULL, 1, '2026-06-16 10:00:00');

INSERT INTO \`device_tokens\` (\`token\`, \`employee_id\`, \`created_at\`) VALUES
  ('abc', 2, '2026-06-20 10:00:00');
`

/* --------------------------------------------------------------- reader */

test('the reader parses INSERT-only dumps without a database', () => {
  const tables = readTables(DUMP)
  assert.equal(tables.get('customers').rows.length, 2)
  assert.equal(tables.get('service_cards').rows.length, 2)
  assert.ok(tables.has('device_tokens'))
})

test("an apostrophe in a name survives, and does not shift the columns", () => {
  const tables = readTables(DUMP)
  const dana = tables.get('customers').rows.find((r) => r.id === '2')
  assert.equal(unquote(dana.name), "Dana O'Brien")
  assert.equal(unquote(dana.city), 'Campbell River', 'later columns are unaffected')
})

test('a comma inside a quoted value does not split the row', () => {
  assert.deepEqual(splitValues("(1, 'a, b', 'c')"), ['1', "'a, b'", "'c'"])
  assert.equal(splitRows("(1, 'x'), (2, 'y')").length, 2)
})

test('a row whose arity does not match its columns is refused, not guessed', () => {
  const bad = "INSERT INTO `t` (`a`, `b`) VALUES\n  (1);\n"
  assert.throws(() => [...readInsertBlocks(bad)], /1 values for 2 columns/)
})

/* ------------------------------------------------------------------ ids */

test('migrated ids are ULID-shaped and stable across runs', () => {
  const a = legacyId('customers', '7')
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/)
  assert.equal(a, legacyId('customers', '7'), 'deterministic, so a re-run is safe')
  assert.notEqual(a, legacyId('boats', '7'), 'unique per table, not per value')
})

test('legacy timestamps become parseable ISO instants', () => {
  assert.equal(toIso('2026-06-17 11:49:00'), '2026-06-17T11:49:00.000Z')
  assert.equal(toIso('2026-06-17'), '2026-06-17')
  assert.equal(toIso('2026-06-17T10:00:00Z'), '2026-06-17T10:00:00Z')
  assert.equal(toIso(null), null)
  assert.equal(toIso('NULL'), null)
})

/* ----------------------------------------------------------------- plan */

test('every legacy row is migrated and every id is remapped', () => {
  const p = plan(readTables(DUMP), { now: NOW })
  const counts = {}
  for (const { entity } of p.rows) counts[entity] = (counts[entity] ?? 0) + 1

  assert.equal(counts.employees, 2)
  assert.equal(counts.customers, 2)
  assert.equal(counts.boats, 2)
  assert.equal(counts.service_cards, 2)
  assert.equal(counts.authorized_work, 2)
  assert.equal(counts.received_items, 2)

  /* No integer survives as an id: a leftover 7 would point at nothing. */
  for (const { entity, row } of p.rows) {
    assert.match(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/, `${entity}.id`)
  }
})

test('foreign keys are rewritten to the new ids, not left as integers', () => {
  const p = plan(readTables(DUMP), { now: NOW })
  const boats = p.rows.filter((r) => r.entity === 'boats')
  const customers = p.rows.filter((r) => r.entity === 'customers')
  const marcus = customers.find((r) => r.row.name === 'Marcus Reyes')

  assert.equal(boats[0].row.customer_id, marcus.row.id)
  assert.ok(!boats.some((b) => /^\d+$/.test(String(b.row.customer_id))), 'no numeric customer_id')

  const cards = p.rows.filter((r) => r.entity === 'service_cards')
  const sea = boats[0].row.id
  assert.equal(cards.find((c) => c.row.work_order_no === 'WO-1000').row.boat_id, sea)

  /* Children point at the card, not at legacy card id 1. */
  const work = p.rows.find((r) => r.entity === 'work_logs').row
  assert.equal(work.card_id, cards.find((c) => c.row.work_order_no === 'WO-1000').row.id)
  assert.ok(!/^\d+$/.test(String(work.employee_id)), 'employee_id remapped too')
})

test('engine descriptions survive in motor_type, and dropped columns are reported', () => {
  const p = plan(readTables(DUMP), { now: NOW })
  const boats = p.rows.filter((r) => r.entity === 'boats')
  const sea = boats.find((b) => b.row.name === 'Sea Breeze')

  /* The production dump keeps engine text in motor_type; serial_no is empty.
     That text is what a mechanic typed, so it must arrive as a real value. */
  assert.equal(sea.row.motor_type, 'Yamaha 200')

  /* Serials come from boat_serials and migrate unchanged. */
  const serials = p.rows.filter((r) => r.entity === 'boat_serials')
  assert.equal(serials.length, 1)
  assert.equal(serials[0].row.serial_number, '3B120222')
  assert.equal(serials[0].row.type, 'engine')

  /* A dropped column is named in the report whether or not it held data, so a
     silent loss cannot hide behind a clean run. */
  assert.ok(p.notes.some((n) => n.startsWith('boats.serial_no: dropped')), 'serial_no reported')
  assert.ok(p.notes.some((n) => n.startsWith('boats.deleted_at: dropped')), 'deleted_at reported')
})

test('the retired push-token table is dropped and reported', () => {
  const p = plan(readTables(DUMP), { now: NOW })
  assert.ok(!p.rows.some((r) => r.entity === 'device_tokens'))
  assert.ok(p.notes.some((n) => n.includes('device_tokens')))
})

test('rows carry the metadata block a device expects', () => {
  const p = plan(readTables(DUMP), { now: NOW })
  for (const { entity, row } of p.rows) {
    assert.equal(row.rev, 0, `${entity}: never edited by a device`)
    assert.equal(row.version, 1, `${entity}: baseline for later edits`)
    assert.equal(row.device_id, 'legacy', `${entity}: distinguishable from typed data`)
    assert.equal(row.deleted_at, null)
    assert.ok(row.updated_at, `${entity}: has a timestamp`)
  }
})

test('planning is a pure function of its input', () => {
  const tables = readTables(DUMP)
  const a = plan(tables, { now: NOW })
  const b = plan(tables, { now: NOW })
  assert.deepEqual(a.rows, b.rows, 'a rehearsal and the real run must agree')
  assert.equal(a.rows.length, b.rows.length)
})

test('plan refuses to guess the clock', () => {
  assert.throws(() => plan(readTables(DUMP), {}), /explicit now/)
})

/* ---------------------------------------------------------------- apply */

test('a migrated database has no dangling references', async () => {
  const db = freshDb()
  const p = plan(readTables(DUMP), { now: NOW })
  const counts = await applyPlan(db, p)

  assert.equal(counts.service_cards, 2)
  assert.deepEqual(await verify(db, p), [])

  /* Spot-check that real values survived rather than merely landing. */
  const card = await db.get(`SELECT * FROM ${T('service_cards')} WHERE work_order_no = ?`, ['WO-1000'])
  assert.equal(card.status, 'invoiced')
  assert.equal(card.season_year, 2026)
  assert.equal(card.tax_rate, 13)
  assert.equal(card.customer_token, 'VPrVMcbv')
  assert.equal(card.version, 1)

  const work = await db.get(`SELECT * FROM ${T('work_logs')} WHERE id = ?`, [
    p.rows.find((r) => r.entity === 'work_logs').row.id,
  ])
  assert.equal(work.description, 'Replaced impeller')

  await db.close?.()
})

test('migrated history reaches a phone by delta pull', async () => {
  const db = freshDb()
  const p = plan(readTables(DUMP), { now: NOW })
  await applyPlan(db, p)

  const { changes, full_sync: full } = await pull(db, { cursor: 0 })
  assert.equal(full, false, 'the change log carries it, so no rehydrate is needed')

  const cards = changes.filter((c) => c.entity === 'service_cards')
  assert.equal(cards.length, 2)
  assert.ok(cards.every((c) => c.version === 1))

  /* A phone editing a migrated card must win, not conflict with history. */
  const card = cards.find((c) => c.payload.work_order_no === 'WO-1000')
  const admin = p.rows.find((r) => r.entity === 'employees').row.id
  assert.ok(admin, 'the plan produced an employee to act as')
  const [result] = await push(db, {
    deviceId: 'dev-1',
    actorId: admin,
    role: 'office',
    ops: [
      {
        op_id: 'op-after-migration',
        entity: 'service_cards',
        entity_id: card.entity_id,
        op: 'upsert',
        rev: 1,
        payload: { ...card.payload, remarks: 'Called customer' },
      },
    ],
  })
  assert.equal(result.result, 'applied', 'rev 1 matches the migrated baseline')

  const after = await db.get(`SELECT remarks, version FROM ${T('service_cards')} WHERE id = ?`, [card.entity_id])
  assert.equal(after.remarks, 'Called customer')
  assert.equal(after.version, 2)

  const conflicts = await db.all(`SELECT * FROM ${T('card_conflicts')}`)
  assert.equal(conflicts.length, 0, 'migration did not manufacture a conflict')
})



test('a second import is refused rather than duplicating every row', async () => {
  const db = freshDb()
  const p = plan(readTables(DUMP), { now: NOW })

  const first = await importInto(db, p)
  assert.equal(first.ok, true)
  assert.equal(first.counts.service_cards, 2)

  const second = await importInto(db, p)
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'already_imported')

  /* Refused means nothing was written, not half-written. */
  const cards = await db.get(`SELECT COUNT(*) AS n FROM ${T('service_cards')}`)
  assert.equal(Number(cards.n), 2)
})

test('a legacy database full of legacy rows is not mistaken for an imported one', async () => {
  /* Production keeps the legacy tables alongside ours. The check must look only
     at our own tables, or it would refuse every real run. */
  const db = freshDb()
  db.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)')
  db.run('INSERT INTO customers (id, name) VALUES (1, ?)', ['legacy row'])

  const result = await importInto(db, plan(readTables(DUMP), { now: NOW }))
  assert.equal(result.ok, true)
  assert.equal(result.counts.customers, 2)
  /* And the legacy row is untouched. */
  const legacy = await db.get('SELECT name FROM customers WHERE id = 1')
  assert.equal(legacy.name, 'legacy row')
})

test('an unmapped legacy table is reported, never silently skipped', () => {
  const dump = `${DUMP}
INSERT INTO \`some_future_table\` (\`id\`, \`x\`) VALUES
  (1, 'y');
`
  const p = plan(readTables(dump), { now: NOW })
  assert.ok(
    p.notes.some((n) => n.includes('some_future_table') && n.includes('NOT MIGRATED')),
    'an unknown table must be visible in the report',
  )
})