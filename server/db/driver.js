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
      const [rows] = await wrap((c) => c.query(sql, params))
      return rows
    },
    async get(sql, params = []) {
      const [rows] = await wrap((c) => c.query(sql, params))
      return rows[0] ?? null
    },
    async run(sql, params = []) {
      const [r] = await wrap((c) => c.query(sql, params))
      return { changes: r.affectedRows, lastId: r.insertId }
    },
    async exec(sql) {
      await wrap((c) => c.query(sql))
    },
    async tx(fn) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const out = await fn({
          all: async (sql, params = []) => (await conn.query(sql, params))[0],
          get: async (sql, params = []) => ((await conn.query(sql, params))[0]?.[0] ?? null),
          run: async (sql, params = []) => {
            const [r] = await conn.query(sql, params)
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
 * SQLite wants `INTEGER PRIMARY KEY AUTOINCREMENT` on change_log.seq; MySQL
 * wants `BIGINT AUTO_INCREMENT PRIMARY KEY`. Everything else is portable.
 */
export function dialectDDL(dialect, ddl) {
  if (dialect === 'sqlite') return ddl
  return ddl
    .replace(
      /CREATE TABLE IF NOT EXISTS change_log \(\s*seq\s+INTEGER PRIMARY KEY AUTOINCREMENT/,
      'CREATE TABLE IF NOT EXISTS change_log (\n  seq        BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
    )
    .replace(/CREATE INDEX IF NOT EXISTS (\w+) ON/g, 'CREATE INDEX $1 ON')
}