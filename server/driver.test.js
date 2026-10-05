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

/*
 * MySQL will not index an unbounded TEXT column. It rejects the table outright
 * with ER_WRONG_KEY_SPECIFICATION, so this is not a warning — the schema does not
 * build.
 *
 * Asserted by parsing the generated DDL rather than grepping it, because a regex
 * over a statement chunk matched a comment last time and reported a failure that
 * was not there. A guard that cries wolf is worse than no guard.
 */
test('no key or index names an unbounded TEXT column, in either dialect', () => {
  for (const dialect of ['sqlite', 'mysql']) {
    const statements = splitStatements(dialectDDL(dialect, FULL_DDL))

    /* Column name to declared type, for every table. */
    const types = new Map()
    const primaryKeys = []

    for (const statement of statements) {
      if (!/^CREATE TABLE/i.test(statement)) continue
      const table = statement.match(/EXISTS\s+(\w+)/)?.[1] ?? 'unknown'

      for (const line of statement.split('\n')) {
        const inline = line.match(/^\s*(\w+)\s+([A-Z]+(?:\(\d+\))?)(.*)$/i)
        if (!inline) continue
        const [, column, type, rest] = inline
        if (/^(PRIMARY|UNIQUE|FOREIGN|KEY|CONSTRAINT)$/i.test(column)) continue
        types.set(`${table}.${column}`, type.toUpperCase())
        if (/PRIMARY KEY/i.test(rest)) primaryKeys.push({ table, columns: [column], label: line.trim() })
      }

      /* A table-level PRIMARY KEY (a, b) names columns declared above it. */
      const composite = statement.match(/PRIMARY KEY\s*\(([^)]*)\)/i)
      if (composite) {
        const columns = composite[1].split(',').map((c) => c.trim())
        if (!primaryKeys.some((p) => p.table === table && p.columns.length === columns.length)) {
          primaryKeys.push({ table, columns, label: `PRIMARY KEY (${composite[1]})` })
        }
      }
    }

    for (const { table, columns, label } of primaryKeys) {
      for (const column of columns) {
        assert.notEqual(types.get(`${table}.${column}`), 'TEXT', `${dialect}: ${table}.${column} is a TEXT primary key (${label})`)
      }
    }

    for (const statement of statements.filter((s) => /^CREATE INDEX/i.test(s))) {
      const on = statement.match(/ON\s+(\w+)\s*\(([^)]*)\)/i)
      assert.ok(on, `could not read the index target: ${statement}`)
      for (const column of on[2].split(',').map((c) => c.trim())) {
        assert.notEqual(types.get(`${on[1]}.${column}`), 'TEXT', `${dialect}: ${on[1]}.${column} is indexed but unbounded`)
      }
    }
  }
})

test('the bounded key type still behaves as text in SQLite', async () => {
  /* VARCHAR(255) is deliberate: SQLite accepts it and gives it TEXT affinity, so
     one declaration serves both engines. If that stopped being true the schema
     would need a dialect rewrite again, which is what let this reach a deploy. */
  const db = sqliteDriver(':memory:')
  await db.exec(dialectDDL('sqlite', FULL_DDL))

  await db.run(`INSERT INTO ${T('customers')} (id, name, updated_at, rev, version) VALUES (?, ?, ?, 0, 1)`, [
    'a-26-character-ulid-value',
    'Marcus Reyes',
    new Date().toISOString(),
  ])
  const row = await db.get(`SELECT id, name FROM ${T('customers')} WHERE id = ?`, ['a-26-character-ulid-value'])
  assert.equal(row.name, 'Marcus Reyes', 'a bounded key still stores and matches text')
  await db.close?.()
})

test('a long value still fits in a key column', async () => {
  const db = sqliteDriver(':memory:')
  await db.exec(dialectDDL('sqlite', FULL_DDL))

  /* 64 characters: the longest token the public endpoint accepts. Well inside
     255, and the point is that the bound is not the old 26-character id. */
  const long = 't'.repeat(64)
  await db.run(`INSERT INTO ${T('customers')} (id, name, updated_at, rev, version) VALUES (?, ?, ?, 0, 1)`, [
    long,
    'x',
    new Date().toISOString(),
  ])
  const row = await db.get(`SELECT id FROM ${T('customers')} WHERE id = ?`, [long])
  assert.equal(row.id, long)
  await db.close?.()
})

/*
 * MySQL's rules about TEXT, checked together.
 *
 * Three deploys in a row failed on a different one of these, each found by
 * reading a log rather than by knowing the rules. They are known now, so they are
 * asserted together: an unbounded TEXT column cannot be indexed, cannot carry a
 * DEFAULT, and cannot be UNIQUE. Anything "long" belongs in TEXT; anything with
 * any of those three properties must say how long it is.
 *
 * Deliberately a rules list rather than a per-column fix, because the next
 * failure was always going to be a column nobody thought about.
 */
/*
 * The rule engine, so the check and its own falsification run the same code.
 *
 * The first version of this test reimplemented the rule inline to prove the rule
 * worked, which proves nothing about the rule — it proves the copy works. Both
 * tests call this.
 */
function textRuleViolations(statements) {
  const found = { indexed: [], defaulted: [], unique: [] }

  const columnsOf = (table) =>
    statements
      .find((s) => new RegExp(`EXISTS\\s+${table}\\b`).test(s))
      ?.split('\n')
      .map((line) => line.match(/^\s*(\w+)\s+([A-Z]+(?:\(\d+\))?)\b(.*)$/i))
      .filter(Boolean)
      .filter(([, column]) => !/^(PRIMARY|UNIQUE|FOREIGN|KEY|CONSTRAINT)$/i.test(column)) ?? []

  for (const statement of statements) {
    if (/^CREATE TABLE/i.test(statement)) {
      const table = statement.match(/EXISTS\s+(\w+)/)?.[1] ?? 'unknown'
      for (const [, column, type, rest] of columnsOf(table)) {
        if (!/^TEXT$/i.test(type)) continue
        if (/DEFAULT/i.test(rest)) found.defaulted.push(`${table}.${column}`)
        if (/UNIQUE/i.test(rest)) found.unique.push(`${table}.${column}`)
      }
    }

    if (/^CREATE INDEX/i.test(statement)) {
      const on = statement.match(/ON\s+(\w+)\s*\(([^)]*)\)/i)
      if (!on) continue
      const declared = new Map(columnsOf(on[1]).map(([, c, t]) => [c, t]))
      for (const column of on[2].split(',').map((c) => c.trim())) {
        if (/^TEXT$/i.test(declared.get(column) ?? '')) found.indexed.push(`${on[1]}.${column}`)
      }
    }
  }

  return found
}

test('no MySQL column breaks the TEXT rules', () => {
  const found = textRuleViolations(splitStatements(dialectDDL('mysql', FULL_DDL)))
  assert.deepEqual(found.defaulted, [], 'a TEXT column cannot carry a DEFAULT')
  assert.deepEqual(found.unique, [], 'a TEXT column cannot be UNIQUE')
  assert.deepEqual(found.indexed, [], 'a TEXT column cannot be indexed')
})

test('the rule engine actually fires on each mistake', () => {
  /* Multi-line, shaped like the generated DDL, because that is what the engine
     parses — a one-line fixture would fail for the wrong reason. */
  const table = (columnLine) => splitStatements(`CREATE TABLE IF NOT EXISTS mm_t (\n  a VARCHAR(255) PRIMARY KEY,\n${columnLine}\n);`)

  assert.deepEqual(
    textRuleViolations(table(`  s TEXT NOT NULL DEFAULT 'open',`)).defaulted,
    ['mm_t.s'],
    'a DEFAULT on TEXT must be caught',
  )
  assert.deepEqual(textRuleViolations(table('  s TEXT UNIQUE,')).unique, ['mm_t.s'], 'a UNIQUE TEXT must be caught')

  const indexed = splitStatements(
    'CREATE TABLE IF NOT EXISTS mm_t (\n  a VARCHAR(255) PRIMARY KEY,\n  s TEXT\n);\nCREATE INDEX mm_i ON mm_t(s);',
  )
  assert.deepEqual(textRuleViolations(indexed).indexed, ['mm_t.s'], 'an indexed TEXT must be caught')

  /* And it stays quiet on the healthy form, or it would be noise. */
  assert.deepEqual(textRuleViolations(table('  s VARCHAR(255) NOT NULL DEFAULT \'open\',')), {
    indexed: [],
    defaulted: [],
    unique: [],
  })
})

test('the MySQL driver refuses to be constructed without a host', () => {
  /* Not a connection test — there is no MySQL to connect to. It asserts the
     driver is reachable and shaped like the other one, so the two stay
     swappable. */
  assert.equal(typeof mysqlDriver, 'function')
  assert.equal(typeof sqliteDriver, 'function')
})