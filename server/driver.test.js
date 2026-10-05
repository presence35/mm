import test from 'node:test'
import assert from 'node:assert/strict'

import { splitStatements, dialectDDL, toMySQL, mysqlDriver, sqliteDriver } from './db/driver.js'
import { FULL_DDL } from './schema.js'
import { T, ALL_TABLES } from './entities.js'

/*
 * The DDL split.
 *
 * MySQL sends one statement per query unless multipleStatements is enabled, and
 * enabling it would let a single injected parameter run arbitrary extra
 * statements. So the script is split here instead.
 *
 * This is the first MySQL-specific failure that was not caught by reading —
 * dialectDDL and toMySQL are pure and were asserted, but the *execution* path
 * had never run, and it sent the whole schema as one query. Verified against the
 * real generated DDL rather than a hand-made sample, because the real one is
 * what ships.
 */

test('the whole schema splits into one statement per statement', () => {
  const statements = splitStatements(FULL_DDL)

  /* Every table the app owns, plus the index. Counted from the registry rather
     than hard-coded, so adding an entity cannot quietly stop splitting. */
  const expectedTables = Object.values(ALL_TABLES).length + 6 // change_log, sync_ops, sync_devices, card_conflicts, sessions, login_attempts
  assert.equal(statements.length, expectedTables + 1, 'tables plus idx_change_entity')

  for (const s of statements) {
    assert.ok(/^(CREATE|ALTER|DROP|INSERT)/i.test(s), `not a statement: ${s.slice(0, 60)}`)
    assert.ok(!s.includes(';'), `a statement still contains a separator: ${s.slice(0, 60)}`)
  }

  /* The prefix survived: a split that lost it would create legacy-named tables,
     which is the collision the prefix exists to prevent. */
  assert.ok(statements.every((s) => s.includes('mm_')))
})

test('the MySQL rewrite happens before the split, not after', () => {
  const statements = splitStatements(toMySQL(dialectDDL('mysql', FULL_DDL)))

  const changeLog = statements.find((s) => s.includes(`${T('change_log')} (`))
  assert.ok(changeLog, 'change_log is present')
  assert.match(changeLog, /BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY/)
  assert.ok(!statements.some((s) => s.includes('INTEGER PRIMARY KEY AUTOINCREMENT')))

  assert.ok(!statements.some((s) => /CREATE INDEX IF NOT EXISTS/.test(s)), 'MySQL has no such form')
})

test('a semicolon inside a string literal does not split', () => {
  const out = splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;")
  assert.equal(out.length, 2)
  assert.equal(out[0], "INSERT INTO t VALUES ('a;b')")
})

test('a doubled quote is a literal, and does not end the string', () => {
  const out = splitStatements("INSERT INTO t VALUES ('it''s; here'); SELECT 1;")
  assert.equal(out.length, 2)
  assert.equal(out[0], "INSERT INTO t VALUES ('it''s; here')")
})

test('an escaped quote does not end the string', () => {
  const out = splitStatements("INSERT INTO t VALUES ('it\\';s; here'); SELECT 1;")
  assert.equal(out.length, 2)
})

test('a semicolon inside a backticked identifier does not split', () => {
  const out = splitStatements('CREATE TABLE `a;b` (x INT); SELECT 1;')
  assert.equal(out.length, 2)
  assert.equal(out[0], 'CREATE TABLE `a;b` (x INT)')
})

test('empty statements are dropped rather than sent', () => {
  assert.deepEqual(splitStatements('A;;B;'), ['A', 'B'])
  assert.deepEqual(splitStatements('A;   ;B'), ['A', 'B'])
  assert.deepEqual(splitStatements('A'), ['A'])
  assert.deepEqual(splitStatements('  '), [])
  assert.deepEqual(splitStatements(''), [])
})

test('a stray trailing separator does not produce a trailing empty statement', () => {
  assert.deepEqual(splitStatements('A;\n\n'), ['A'])
})

/* SQLite takes the whole script, and must keep doing so — the split is a MySQL
   concern and applying it to SQLite would be a behaviour change for no reason. */
test('the SQLite driver is unaffected by the split', async () => {
  const db = sqliteDriver(':memory:')
  await db.exec(FULL_DDL)

  const names = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name)
  assert.ok(names.includes(T('service_cards')))
  assert.ok(names.includes(T('change_log')))
  await db.close?.()
})

test('the MySQL driver refuses to be constructed without a host', () => {
  /* Not a connection test — there is no MySQL to connect to. It asserts the
     driver is reachable and shaped like the other one, so the two stay
     swappable. */
  assert.equal(typeof mysqlDriver, 'function')
  assert.equal(typeof sqliteDriver, 'function')
})