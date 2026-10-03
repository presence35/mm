import { randomBytes, scryptSync, timingSafeEqual, createHmac, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { sqliteDriver, mysqlDriver, dialectDDL } from './driver.js'
import { FULL_DDL } from '../schema.js'
import { T } from '../entities.js'

export function createDb() {
  if (process.env.DB_HOST) {
    return mysqlDriver({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: Number(process.env.DB_PORT ?? 3306),
    })
  }
  const file = process.env.DB_FILE ?? './data/marina.db'
  mkdirSync(dirname(file), { recursive: true })
  return sqliteDriver(file)
}

export async function bootstrap(db, log = () => {}) {
  await db.exec(dialectDDL(db.dialect, FULL_DDL))
  log('schema ensured')
  const seeded = await seedAdmin(db)
  if (seeded) log('seeded admin employee')
  return seeded
}

/* One admin so a fresh install is usable. PIN 1234, and it says so out loud
   rather than being discoverable by guesswork in production. */
async function seedAdmin(db) {
  const existing = await db.get(`SELECT id FROM ${T('employees')} LIMIT 1`)
  if (existing) return false
  const { salt, hash } = hashPin('1234')
  const now = new Date().toISOString()
  await db.run(
    `INSERT INTO ${T('employees')} (id, name, role, initials, pin_salt, pin_hash, active, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
    ['emp-admin', 'Admin', 'admin', 'AD', salt, hash, now, now],
  )
  return true
}

/* -------------------------------------------------------------- passwords */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT).toString('hex')
  return { salt, hash }
}

export function verifyPin(pin, salt, expected) {
  const actual = scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT)
  const want = Buffer.from(expected, 'hex')
  return actual.length === want.length && timingSafeEqual(actual, want)
}

/* ---------------------------------------------------------------- tokens */

/* HMAC-signed, not a dependency. Signature is compared in constant time. */
const SECRET = () => process.env.APP_SECRET ?? 'dev-only-secret-change-me'

export function issueToken(payload, ttlMs = 12 * 60 * 60 * 1000) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url')
  const sig = createHmac('sha256', SECRET()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function readToken(token) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const want = createHmac('sha256', SECRET()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export { randomUUID }