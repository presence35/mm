import { randomUUID } from 'node:crypto'

const BASE = 'http://localhost:3000'
const H = { 'Content-Type': 'application/json' }

const now = 1794854892521
const ts = new Date(now).toISOString()
const mk = (id, extra) => ({ id, version: 1, updated_at: ts, updated_by: 'emp-admin', ...extra })

const ops = [
  { op_id: 'op-card-2001', entity: 'service_cards', entity_id: 'card-wo-2001', op: 'upsert', rev: 0, payload: mk('card-wo-2001', { boat_id: 'boat-1', customer_id: 'cust-1', status: 'OPEN', stage: 'INTAKE', work_order_no: 'WO-2001', season_year: 2026, opened_at: now, opened_by: 'emp-admin', title: 'Battery', description: 'Slow charge', stage_history: [], photos: [], logs: [], condition: [], checklist: [], parts: [], closed_at: null, closed_by: null }) },
  { op_id: 'op-card-2002', entity: 'service_cards', entity_id: 'card-wo-2002', op: 'upsert', rev: 0, payload: mk('card-wo-2002', { boat_id: 'boat-2', customer_id: 'cust-2', status: 'OPEN', stage: 'DIAGNOSE', work_order_no: 'WO-2002', season_year: 2026, opened_at: now, opened_by: 'emp-admin', title: 'Rough idle', description: 'Runs hot', stage_history: [], photos: [], logs: [], condition: [], checklist: [], parts: [], closed_at: null, closed_by: null }) },
  { op_id: 'op-cust-1', entity: 'customers', entity_id: 'cust-1', op: 'upsert', rev: 0, payload: mk('cust-1', { name: 'Reef Marina', phone: '', email: '', address: '' }) },
  { op_id: 'op-cust-2', entity: 'customers', entity_id: 'cust-2', op: 'upsert', rev: 0, payload: mk('cust-2', { name: 'Cove Yacht', phone: '', email: '', address: '' }) },
  { op_id: 'op-boat-1', entity: 'boats', entity_id: 'boat-1', op: 'upsert', rev: 0, payload: mk('boat-1', { customer_id: 'cust-1', name: 'Bluefin', model: 'Ranger 24' }) },
  { op_id: 'op-boat-2', entity: 'boats', entity_id: 'boat-2', op: 'upsert', rev: 0, payload: mk('boat-2', { customer_id: 'cust-2', name: 'Marlin', model: 'Bay 27' }) },
]

const DEVICE = 'dev-verify5'

async function j(path, init) {
  const r = await fetch(`${BASE}${path}`, init)
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { _status: r.status, _text: t.slice(0, 300) } }
}

const login = await j('/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ employee_id: 'emp-admin', pin: '1234', device_id: DEVICE }) })
console.log('login:', login)
const token = login.token
if (!token) { console.log('no token — aborting'); process.exit(1) }

const reg = await j('/api/sync/register', { method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` }, body: JSON.stringify({ device_id: DEVICE, label: 'verify5', platform: 'win32' }) })
console.log('register:', reg)

const push = await j('/api/sync/push', { method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` }, body: JSON.stringify({ device_id: DEVICE, ops }) })
console.log('push:', push)