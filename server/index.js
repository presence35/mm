import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createDb, bootstrap, hashPin, verifyPin, issueToken, readToken } from './db/index.js'
import { push, pull, registerDevice, touchDevice, collectGarbage } from './sync.js'
import { referenceSnapshot } from './reference.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PIN_MAX_ATTEMPTS = 5
const PIN_WINDOW_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export async function createServer({ db, quiet = false } = {}) {
  const database = db ?? createDb()
  if (!db) await bootstrap(database, quiet ? () => {} : console.log)

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  const log = quiet ? () => {} : console.log

  /* ------------------------------------------------------------- session */

  function authenticate(req, res, next) {
    const header = req.get('authorization') ?? ''
    const payload = readToken(header.replace(/^Bearer\s+/i, ''))
    if (!payload?.employee_id) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    req.employee = payload
    next()
  }

  app.post('/api/auth/login', async (req, res) => {
    const { pin, employee_id: employeeId } = req.body ?? {}
    const source = req.ip ?? 'unknown'

    if (!pin) {
      res.status(400).json({ error: 'pin_required' })
      return
    }

    const employee = employeeId
      ? await database.get('SELECT * FROM employees WHERE id = ? AND active = 1', [employeeId])
      : await database.get('SELECT * FROM employees WHERE active = 1 ORDER BY created_at ASC LIMIT 1')

    if (!employee) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }

    const attempt = await database.get('SELECT * FROM login_attempts WHERE employee_id = ? AND source = ?', [employee.id, source])
    if (attempt && attempt.count >= PIN_MAX_ATTEMPTS) {
      res.status(429).json({ error: 'too_many_attempts' })
      return
    }

    if (!verifyPin(pin, employee.pin_salt, employee.pin_hash)) {
      await database.run(
        `INSERT INTO login_attempts (employee_id, source, count, last_at) VALUES (?, ?, 1, ?)
         ON CONFLICT (employee_id, source) DO UPDATE SET count = count + 1, last_at = ?`,
        [employee.id, source, new Date().toISOString(), new Date().toISOString()],
      )
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }

    await database.run('DELETE FROM login_attempts WHERE employee_id = ? AND source = ?', [employee.id, source])
    const token = issueToken({ employee_id: employee.id, role: employee.role }, SESSION_TTL_MS)

    res.json({
      token,
      employee: { id: employee.id, name: employee.name, role: employee.role, initials: employee.initials },
      expires_at: Date.now() + SESSION_TTL_MS,
    })
  })

  app.get('/api/auth/me', authenticate, async (req, res) => {
    const e = await database.get('SELECT id, name, role, initials, active FROM employees WHERE id = ?', [req.employee.employee_id])
    if (!e || !e.active) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    res.json(e)
  })

  /* --------------------------------------------------------------- sync */

  app.post('/api/sync/register', authenticate, async (req, res) => {
    const { device_id: deviceId, label = 'Device', platform = 'web' } = req.body ?? {}
    if (!deviceId) {
      res.status(400).json({ error: 'device_id_required' })
      return
    }
    res.json(await registerDevice(database, { deviceId, label, platform, employeeId: req.employee.employee_id }))
  })

  app.get('/api/sync/pull', authenticate, async (req, res) => {
    const cursor = Number(req.query.cursor ?? 0)
    const limit = Number(req.query.limit ?? 200)
    const result = await pull(database, { cursor, limit })
    const deviceId = req.query.device_id
    if (deviceId) await touchDevice(database, deviceId, result.cursor)
    res.json(result)
  })

  app.post('/api/sync/push', authenticate, async (req, res) => {
    const { device_id: deviceId, ops = [] } = req.body ?? {}
    if (!deviceId) {
      res.status(400).json({ error: 'device_id_required' })
      return
    }
    const results = await push(database, {
      deviceId,
      actorId: req.employee.employee_id,
      role: req.employee.role,
      ops,
    })
    res.json({ results })
  })

  app.get('/api/sync/reference', authenticate, async (req, res) => {
    res.json(await referenceSnapshot(database))
  })

  app.get('/api/sync/conflicts', authenticate, async (req, res) => {
    const rows = await database.all('SELECT * FROM card_conflicts WHERE status = ? ORDER BY detected_at DESC', ['open'])
    res.json({ conflicts: rows.map(decodeConflict) })
  })

  app.post('/api/sync/conflicts/:id/resolve', authenticate, async (req, res) => {
    const { resolution, payload } = req.body ?? {}
    if (!['kept_local', 'kept_server', 'merged'].includes(resolution)) {
      res.status(400).json({ error: 'invalid_resolution' })
      return
    }
    const row = await database.get('SELECT * FROM card_conflicts WHERE id = ?', [req.params.id])
    if (!row) {
      res.status(404).json({ error: 'not_found' })
      return
    }

    /* Resolving as kept_local or merged is an ordinary write at
       server_version + 1 — convergent, not a special case. */
    const results = await push(database, {
      deviceId: req.body.device_id ?? 'server',
      actorId: req.employee.employee_id,
      role: req.employee.role,
      ops: [
        {
          op_id: `resolve-${req.params.id}`,
          conflict_id: req.params.id,
          entity: row.entity,
          entity_id: row.entity_id,
          op: 'upsert',
          rev: Number(row.server_version),
          payload: resolution === 'kept_server' ? JSON.parse(row.server_payload ?? 'null') : payload ?? JSON.parse(row.local_payload ?? '{}'),
        },
      ],
    })

    await database.run(
      "UPDATE card_conflicts SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
      [resolution, req.employee.employee_id, new Date().toISOString(), req.params.id],
    )

    res.json({ results })
  })

  /* ------------------------------------------------------------- public */

  /* Unauthenticated. Narrow projection — see docs/behaviors-public-view.md.
     Never SELECT *: the exclusion list is enforced by the query shape. */
  app.get('/api/public/card/:token', async (req, res) => {
    res.set('Cache-Control', 'no-store')

    const generic = () => res.status(404).json({ error: 'not_found' })

    if (!/^[A-Za-z0-9_-]{16,64}$/.test(req.params.token)) return generic()

    const card = await database.get(
      `SELECT c.id, c.boat_id, c.work_order_no, c.season_year, c.status, c.updated_at, c.is_fake
       FROM service_cards c WHERE c.customer_token = ? AND c.deleted_at IS NULL`,
      [req.params.token],
    )
    if (!card) return generic()

    const boat = await database.get('SELECT name, model, length_ft FROM boats WHERE id = ?', [card.boat_id])
    const customer = boat
      ? await database.get('SELECT cu.name FROM boats b JOIN customers cu ON cu.id = b.customer_id WHERE b.id = ?', [card.boat_id])
      : null
    const services = await database.all(
      `SELECT t.label, w.authorized, w.completed
       FROM authorized_work w LEFT JOIN service_item_templates t ON t.item_key = w.service_type
       WHERE w.card_id = ? AND w.deleted_at IS NULL`,
      [card.id],
    )

    res.json({
      customer_name: customer?.name ?? null,
      boat: { name: boat?.name ?? null, model: boat?.model ?? null, length_ft: boat?.length_ft ?? null },
      work_order_no: card.work_order_no,
      season_year: card.season_year,
      status_label: card.status,
      services: services.map((s) => ({ label: s.label ?? 'Service', authorized: !!s.authorized, completed: !!s.completed })),
      updated_at: card.updated_at,
      fake: !!card.is_fake,
    })
  })

  /* ---------------------------------------------------------------- gc */

  app.post('/api/sync/gc', authenticate, async (req, res) => {
    if (req.employee.role !== 'admin') {
      res.status(403).json({ error: 'admin_only' })
      return
    }
    res.json(await collectGarbage(database))
  })

  /* ------------------------------------------------------------- static */

  app.use(express.static(join(ROOT, 'dist')))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(join(ROOT, 'dist', 'index.html'), (err) => (err ? next() : null))
  })

  app.use((err, req, res, _next) => {
    log('unhandled', err?.message)
    res.status(500).json({ error: 'internal' })
  })

  return { app, db: database }
}

function decodeConflict(row) {
  return {
    id: row.id,
    entity: row.entity,
    entity_id: row.entity_id,
    local_payload: JSON.parse(row.local_payload),
    server_payload: row.server_payload ? JSON.parse(row.server_payload) : null,
    local_rev: Number(row.local_rev),
    server_version: Number(row.server_version),
    detected_at: row.detected_at,
  }
}

async function db_singleAdminId() {
  return null
}

export { bootstrap }