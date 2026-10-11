/*
 * TEMPORARY boot diagnostic. Run on the host via the package `diag` script.
 * Prints env presence (never secret values) and attempts one MySQL
 * connection. Read-only: SELECT 1 plus a table count. Delete after use.
 */

import mysql from 'mysql2/promise'
import './env.js'

const present = (v) => (v ? `set(len=${v.length})` : 'MISSING')

console.log('APP_SECRET:', present(process.env.APP_SECRET))
console.log('DB_HOST:', process.env.DB_HOST ?? 'MISSING')
console.log('DB_PORT:', process.env.DB_PORT ?? '(default 3306)')
console.log('DB_NAME:', process.env.DB_NAME ?? 'MISSING')
console.log('DB_USER:', process.env.DB_USER ?? 'MISSING')
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? 'set' : 'MISSING')

if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.log('RESULT: incomplete DB env — server would fall back to SQLite')
  process.exit(2)
}

try {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 8000,
  })
  const [[v]] = await conn.query('SELECT VERSION() AS v')
  console.log('RESULT: mysql OK, server', v.v)
  const [tables] = await conn.query('SHOW TABLES')
  console.log('RESULT: tables visible:', tables.length)
  await conn.end()
  process.exit(0)
} catch (e) {
  console.log('RESULT: mysql FAILED:', e.code ?? e.name, '-', (e.message ?? '').slice(0, 160))
  process.exit(1)
}
