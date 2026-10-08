import express from 'express'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import multer from 'multer'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createDb, bootstrap, hashPin, verifyPin, issueToken, readToken, assertProductionReady } from './db/index.js'
import { push, pull, registerDevice, touchDevice, collectGarbage } from './sync.js'
import { referenceSnapshot } from './reference.js'
import { storePhoto } from './photos.js'
import { listStaff, createStaff, setStaffActive, resetPin, changeOwnPin } from './staff.js'
import { T } from './entities.js'
/* TEMPORARY legacy import over HTTP — delete with server/legacy/import-live.js after the one production import. */
import { registerLegacyImportRoutes } from './legacy/import-live.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const PIN_MAX_ATTEMPTS = 21
const PIN_WINDOW_MS = 420 * 1000

/*
 * Brute-force throttle, counted per person rather than per connection.
 *
 * GoDaddy puts every phone in the marina behind one shared address, so a
 * per-IP limit is a per-marina limit: 21 wrong guesses by anyone pauses sign-in
 * for the whole crew. That is the lockout this replaced, only seven minutes
 * instead of forever.
 *
 * The allowance is high enough that a person who fumbles a PIN twice still gets
 * in, and it clears on its own. `now` is injected so the window can be tested
 * without waiting seven minutes for it.
 *
 * The counter is in memory on purpose. It is a rate limit, not an audit trail:
 * a deploy or restart resetting it costs an attacker a fresh allowance and loses
 * nothing worth keeping, and it keeps sign-in from taking a write on the failure
 * path.
 */
export function makePinThrottle({ max = PIN_MAX_ATTEMPTS, windowMs = PIN_WINDOW_MS, now = Date.now } = {}) {
  const hits = new Map()

  return {
    /* true when this person may try again. Records the attempt when they may,
       so the count starts at one rather than at zero. */
    take(employeeId) {
      const at = now()
      const rec = hits.get(employeeId)
      if (!rec || at >= rec.reset) {
        hits.set(employeeId, { count: 1, reset: at + windowMs })
        return true
      }
      if (rec.count >= max) return false
      rec.count += 1
      return true
    },
    /* A success clears the person's history, so a legit user who fat-fingered
       the first two digits is not serving out the rest of the window. */
    clear(employeeId) {
      hits.delete(employeeId)
    },
  }
}

export async function createServer({ db, quiet = false, throttle = makePinThrottle() } = {}) {
  const database = db ?? createDb()
  if (!db) await bootstrap(database, quiet ? () => {} : console.log)

  /* Runs on every boot, not only the createDb() path, so the refusal cannot be
     bypassed by whichever entry point starts the server. It is a no-op for
     SQLite, which is the local development database. */
  const unsafe = await assertProductionReady(database)
  if (unsafe.length) {
    throw new Error(
      `Refusing to start: ${unsafe.length} production ${unsafe.length === 1 ? 'problem' : 'problems'}.\n` +
        unsafe.map((p) => `  - ${p}`).join('\n') +
        '\n\nFix these before serving. See README "Before this touches production".',
    )
  }

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

  /* Wrong PINs are throttled per person, not locked out per account. The window
     clears on its own and a success clears it immediately, so a mechanic who
     fumbles a digit twice is never stuck. `login_attempts` is left in the schema
     so a row written by the old lockout is inert rather than a failed migration. */
  app.post('/api/auth/login', async (req, res) => {
    const { pin, employee_id: employeeId } = req.body ?? {}

    if (!pin) {
      res.status(400).json({ error: 'pin_required' })
      return
    }

    const employee = employeeId
      ? await database.get(`SELECT * FROM ${T('employees')} WHERE id = ? AND active = 1`, [employeeId])
      : await database.get(`SELECT * FROM ${T('employees')} WHERE active = 1 ORDER BY created_at ASC LIMIT 1`)

    if (!employee) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }

    if (!throttle.take(employee.id)) {
      res.set('Retry-After', String(Math.ceil(PIN_WINDOW_MS / 1000)))
      res.status(429).json({ error: 'too_many_attempts' })
      return
    }

    if (!verifyPin(pin, employee.pin_salt, employee.pin_hash)) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }

    throttle.clear(employee.id)
    const token = issueToken({ employee_id: employee.id, role: employee.role }, SESSION_TTL_MS)

    res.json({
      token,
      employee: { id: employee.id, name: employee.name, role: employee.role, initials: employee.initials },
      expires_at: Date.now() + SESSION_TTL_MS,
    })
  })

  app.get('/api/auth/me', authenticate, async (req, res) => {
    const e = await database.get(`SELECT id, name, role, initials, active FROM ${T('employees')} WHERE id = ?`, [req.employee.employee_id])
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
    const rows = await database.all(`SELECT * FROM ${T('card_conflicts')} WHERE status = ? ORDER BY detected_at DESC`, ['open'])
    res.json({ conflicts: rows.map(decodeConflict) })
  })

  app.post('/api/sync/conflicts/:id/resolve', authenticate, async (req, res) => {
    const { resolution, payload } = req.body ?? {}
    if (!['kept_local', 'kept_server', 'merged'].includes(resolution)) {
      res.status(400).json({ error: 'invalid_resolution' })
      return
    }
    const row = await database.get(`SELECT * FROM ${T('card_conflicts')} WHERE id = ?`, [req.params.id])
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
      `UPDATE ${T('card_conflicts')} SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
      [resolution, req.employee.employee_id, new Date().toISOString(), req.params.id],
    )

    res.json({ results })
  })

  /* ------------------------------------------------------------- photos */

  /* Online only. There is no upload queue: the client refuses rather than
     queueing, because queued photos can be evicted from a phone. */
  app.post('/api/photos', authenticate, upload.single('photo'), async (req, res) => {
    const { card_id: cardId, caption, photo_type: photoType, work_log_id: workLogId } = req.body ?? {}
    if (!req.file) {
      res.status(400).json({ error: 'photo_required' })
      return
    }
    let gps
    if (req.body.gps_lat && req.body.gps_lng) {
      gps = { lat: Number(req.body.gps_lat), lng: Number(req.body.gps_lng) }
    }
    const out = await storePhoto(database, {
      root: ROOT,
      file: req.file,
      cardId,
      employeeId: req.employee.employee_id,
      deviceId: req.body.device_id ?? null,
      workLogId,
      caption,
      photoType,
      gps,
    })
    if (!out.ok) {
      res.status(out.status).json({ error: out.reason })
      return
    }
    res.json({ photo: out.photo })
  })

  /* ------------------------------------------------------------- public */

  /* Unauthenticated. Narrow projection — see docs/behaviors-public-view.md.
     Never SELECT *: the exclusion list is enforced by the query shape. */
  app.get('/api/public/card/:token', async (req, res) => {
    res.set('Cache-Control', 'no-store')

    const generic = () => res.status(404).json({ error: 'not_found' })

    /* Eight characters is the floor, and it is set by the oldest real token rather
     than by taste: the legacy app issued 8-character tokens ('VPrVMcbv') and
     those cards exist. Requiring 16 meant every migrated card and every seeded
     card returned 404 — the customer view had never worked for a single card,
     which is why it looked unreachable rather than broken.

     Unguessability is carried by the indistinguishable 404 below, not by the
     length: base32 over 8 characters is ~40 bits, and a caller cannot tell a
     miss from a wrong shape. New cards get 33-character tokens from newId(). */
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.params.token)) return generic()

    const card = await database.get(
      `SELECT c.id, c.boat_id, c.work_order_no, c.season_year, c.status, c.updated_at, c.is_fake
       FROM ${T('service_cards')} c WHERE c.customer_token = ? AND c.deleted_at IS NULL`,
      [req.params.token],
    )
    if (!card) return generic()

    const boat = await database.get(`SELECT name, model, length_ft FROM ${T('boats')} WHERE id = ?`, [card.boat_id])
    const customer = boat
      ? await database.get(
          `SELECT cu.name FROM ${T('boats')} b JOIN ${T('customers')} cu ON cu.id = b.customer_id WHERE b.id = ?`,
          [card.boat_id],
        )
      : null
    const services = await database.all(
      `SELECT t.label, w.authorized, w.completed
       FROM ${T('authorized_work')} w LEFT JOIN ${T('service_item_templates')} t ON t.item_key = w.service_type
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

  /* Admin-only, declared next to authenticate so no route can reach an
     admin action without it. */
  function adminOnly(req, res, next) {
    if (req.employee.role !== 'admin') {
      res.status(403).json({ error: 'admin_only' })
      return
    }
    next()
  }

  /* ---------------------------------------------------------------- staff */

  /* Writes the employees row directly, never through sync: the PIN columns are
     secret and employees is not a syncable entity. All of it needs a live
     connection — see server/staff.js for why that is the right trade. */

  app.get('/api/employees', authenticate, async (req, res) => {
    res.json({ employees: await listStaff(database) })
  })

  app.post('/api/employees', authenticate, adminOnly, async (req, res) => {
    const out = await createStaff(database, {
      name: req.body?.name,
      role: req.body?.role,
      pin: req.body?.pin,
      actorId: req.employee.employee_id,
    })
    if (!out.ok) {
      res.status(out.status).json({ error: out.reason })
      return
    }
    res.status(201).json(out)
  })

  app.post('/api/employees/:id/active', authenticate, adminOnly, async (req, res) => {
    const out = await setStaffActive(database, {
      id: req.params.id,
      active: req.body?.active === true,
      actorId: req.employee.employee_id,
    })
    if (!out.ok) {
      res.status(out.status).json({ error: out.reason })
      return
    }
    res.json(out)
  })

  app.post('/api/employees/:id/pin', authenticate, adminOnly, async (req, res) => {
    const out = await resetPin(database, {
      id: req.params.id,
      pin: req.body?.pin,
      actorId: req.employee.employee_id,
    })
    if (!out.ok) {
      res.status(out.status).json({ error: out.reason })
      return
    }
    res.json(out)
  })

  /* Available to anyone signed in, not just admins. Your own PIN is yours. */
  app.post('/api/auth/pin', authenticate, async (req, res) => {
    const out = await changeOwnPin(database, {
      employeeId: req.employee.employee_id,
      currentPin: req.body?.current_pin,
      newPin: req.body?.new_pin,
    })
    if (!out.ok) {
      res.status(out.status).json({ error: out.reason })
      return
    }
    res.json({ ok: true })
  })

  /* ------------------------------------------------------------- version */

  /* Unauthenticated on purpose: this is the first thing to check when a deploy
     looks stale, and making it need a session defeats that. It exposes nothing
     sensitive — no host, no database name, no employee. It answers two
     questions the README asks: is this the new code, and is it pointed at the
     database we think it is. */
  const bootedAt = new Date().toISOString()

  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({
      name: 'marina-manager',
      version: readFileSync(join(ROOT, 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? 'unknown',
      /* Set by the host if it exposes one. Absent locally, which is honest. */
      build: process.env.BUILD_ID ?? null,
      booted_at: bootedAt,
      /* Confirming the prefix is the point: a wrong one silently reads the
         legacy tables instead of ours. */
      dialect: database.dialect,
      prefix: T(''),
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

  /* TEMPORARY legacy import over HTTP — delete with server/legacy/import-live.js after the one production import. */
  registerLegacyImportRoutes(app, {
    database,
    authenticate,
    adminOnly,
    uploadsRoot: join(ROOT, 'uploads'),
    log,
  })

  /* Legacy app (the previous marina manager) mounted at /legacy. It reads
     the same shared MySQL database through its unprefixed tables; our own
     API, client, and sync are untouched. Must precede the static section so
     our catch-all does not swallow its routes. */
  try {
    const requireLegacy = createRequire(import.meta.url)
    const createLegacyApp = requireLegacy('../legacy-app/server.js')
    app.use('/legacy', await createLegacyApp())
    log('legacy app mounted at /legacy')
  } catch (e) {
    log(`legacy app NOT mounted: ${e?.message}`)
  }

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