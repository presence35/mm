import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'

const dbPath = process.env.DB_FILE
if (!dbPath) { console.log('DB_FILE not set'); process.exit(1) }
mkdirSync(dbPath.replace(/[^\\/]+$/, ''), { recursive: true })
const db = new Database(dbPath)

const now = Date.now()
const ts = new Date(now).toISOString()
const T = (n) => 'mm_' + n

const customers = [
  { id: 'cust-1', name: 'Reef Marina', phone: '', email: '', address: '' },
  { id: 'cust-2', name: 'Cove Yacht', phone: '', email: '', address: '' },
]
const boats = [
  { id: 'boat-1', customer_id: 'cust-1', name: 'Bluefin', model: 'Ranger 24' },
  { id: 'boat-2', customer_id: 'cust-2', name: 'Marlin', model: 'Bay 27' },
]
const cards = [
  { id: 'card-wo-2001', boat_id: 'boat-1', status: 'OPEN', work_order_no: 'WO-2001', season_year: 2026, other_work: 'Battery', remarks: 'Slow charge', is_fake: 0, is_scanned: 0 },
  { id: 'card-wo-2002', boat_id: 'boat-2', status: 'OPEN', work_order_no: 'WO-2002', season_year: 2026, other_work: 'Rough idle', remarks: 'Runs hot', is_fake: 0, is_scanned: 0 },
]

const upsert = (table, row) => {
  const cols = Object.keys(row)
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map((c) => {
    const v = row[c]
    if (typeof v === 'boolean') return v ? 1 : 0
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
    return v
  })
  db.prepare(`INSERT OR REPLACE INTO ${T(table)} (${cols.map((c) => '`' + c + '`').join(', ')}) VALUES (${placeholders})`).run(...values)
}

for (const c of customers) upsert('customers', { ...c, version: 1, updated_at: ts, updated_by: 'emp-admin' })
for (const b of boats) upsert('boats', { ...b, version: 1, updated_at: ts, updated_by: 'emp-admin' })
for (const c of cards) upsert('service_cards', { ...c, version: 1, updated_at: ts, updated_by: 'emp-admin' })

/* The change log is what pull reads. Rows alone are invisible to a client with
   cursor 0, because the sync engine answers "what changed since X", not "what
   exists". Without this the seeded cards never arrive and the page shows
   "No cards yet" forever. */
const log = db.prepare(`INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
let seq = 1
for (const c of cards) {
  const payload = JSON.stringify(db.prepare(`SELECT * FROM ${T('service_cards')} WHERE id = ?`).get(c.id))
  log.run(`op-seed-${c.id}`, 'service_cards', c.id, 'upsert', 1, payload, ts, 'emp-admin', 'seed')
  seq += 1
}
for (const b of boats) {
  const payload = JSON.stringify(db.prepare(`SELECT * FROM ${T('boats')} WHERE id = ?`).get(b.id))
  log.run(`op-seed-${b.id}`, 'boats', b.id, 'upsert', 1, payload, ts, 'emp-admin', 'seed')
}
for (const c of customers) {
  const payload = JSON.stringify(db.prepare(`SELECT * FROM ${T('customers')} WHERE id = ?`).get(c.id))
  log.run(`op-seed-${c.id}`, 'customers', c.id, 'upsert', 1, payload, ts, 'emp-admin', 'seed')
}

console.log('seeded', customers.length, 'customers', boats.length, 'boats', cards.length, 'cards + change_log rows')