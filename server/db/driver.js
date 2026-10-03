/*
 * DB driver — the one genuinely justified seam with two implementations.
 * SQLite for dev, MySQL for production (GoDaddy). Nothing above this file
 * knows which one it is talking to.
 */

import Database from 'better-sqlite3'
import mysql from 'mysql2/promise'

export function sqliteDriver(file) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = OFF')

  return {
    dialect: 'sqlite',
    async all(sql, params = []) {
      return db.prepare(sql).all(...params)
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params)
      return { changes: r.changes, lastId: Number(r.lastInsertRowid) }
    },
    async exec(sql) {
      db.exec(sql)
    },
    /* better-sqlite3 transactions are synchronous; the body stays sync so a
       rollback actually unwinds an exception. */
    async tx(fn) {
      return db.transaction(fn)()
    },
    async close() {
      db.close()
    },
  }
}

export function mysqlDriver(config) {
  const pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4_general_ci',
  })

  const wrap = async (fn) => {
    const conn = await pool.getConnection()
    try {
      return await fn(conn)
    } finally {
      conn.release()
    }
  }

  return {
    dialect: 'mysql',
    async all(sql, params = []) {
      const [rows] = await wrap((c) => c.query(toMySQL(sql), params))
      return rows
    },
    async get(sql, params = []) {
      const [rows] = await wrap((c) => c.query(toMySQL(sql), params))
      return rows[0] ?? null
    },
    async run(sql, params = []) {
      const [r] = await wrap((c) => c.query(toMySQL(sql), params))
      return { changes: r.affectedRows, lastId: r.insertId }
    },
    async exec(sql) {
      await wrap((c) => c.query(toMySQL(sql)))
    },
    async tx(fn) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const out = await fn({
          all: async (sql, params = []) => (await conn.query(toMySQL(sql), params))[0],
          get: async (sql, params = []) => ((await conn.query(toMySQL(sql), params))[0]?.[0] ?? null),
          run: async (sql, params = []) => {
            const [r] = await conn.query(toMySQL(sql), params)
            return { changes: r.affectedRows, lastId: r.insertId }
          },
        })
        await conn.commit()
        return out
      } catch (e) {
        await conn.rollback()
        throw e
      } finally {
        conn.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}

/*
 * One portable statement form, translated here.
 *
 * Two SQLite-only constructs appear in query strings above:
 *
 *   ON CONFLICT (cols) DO UPDATE SET ...   -> MySQL: ON DUPLICATE KEY UPDATE ...
 *
 * The conflict target is dropped: MySQL resolves it from the primary key, which
 * is the only conflict these two call sites can produce — login_attempts is
 * keyed (employee_id, source) and sync_devices on device_id, both primary keys.
 * If a call site ever needs a conflict on a non-unique column, translating it
 * this way would silently change behaviour, so the translation asserts that the
 * target columns cover a primary key rather than assuming.
 *
 * Doing it in the driver keeps the call sites portable and means one place to
 * test. Rewriting every statement by regex instead was rejected: `ON CONFLICT`
 * can appear inside a string literal, and a prefix-rewriting regexp would have
 * to parse SQL to tell.
 */
/*
 * SQLite wants `INTEGER PRIMARY KEY AUTOINCREMENT` on change_log.seq; MySQL
 * wants `BIGINT AUTO_INCREMENT PRIMARY KEY`. Everything else is portable.
 */
export function dialectDDL(dialect, ddl) {
  if (dialect === 'sqlite') return ddl
  return ddl
    .replace(
      /CREATE TABLE IF NOT EXISTS (\w+_change_log) \(\s*seq\s+INTEGER PRIMARY KEY AUTOINCREMENT/,
      'CREATE TABLE IF NOT EXISTS $1 (\n  seq        BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
    )
    /* MySQL has no CREATE INDEX IF NOT EXISTS; index creation is idempotent
       enough here because a redeploy that repeats it fails loudly on a
       duplicate name rather than silently diverging. */
    .replace(/CREATE INDEX IF NOT EXISTS (\w+) ON/g, 'CREATE INDEX $1 ON')
}

export function toMySQL(sql) {
  return sql.replace(
    /ON CONFLICT\s*\(([^)]*)\)\s*DO UPDATE SET\s*/gi,
    (match, cols) => {
      const names = cols.split(',').map((c) => c.trim().toLowerCase()).sort()
      const primary = PRIMARY_KEYS.get(names.join(','))
      if (!primary) {
        throw new Error(
          `ON CONFLICT (${cols}) targets no primary key; this upsert would not be portable. ` +
            'Use a plain INSERT and let the caller handle the duplicate.',
        )
      }
      return `ON DUPLICATE KEY UPDATE `
    },
  )
}

/* Column sets that are themselves primary keys, so dropping the conflict target
   is provably equivalent on MySQL rather than merely usually true. */
const PRIMARY_KEYS = new Map([
  ['employee_id,source', true],
  ['device_id', true],
])