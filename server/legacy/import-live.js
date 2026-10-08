/*
 * TEMPORARY — legacy import over HTTP. Delete this file, its registration in
 * server/index.js, and the Setup screen panel after the one production import
 * has run. The CLI (import.js) remains the rehearsal path; this reuses its
 * plan/apply/verify verbatim.
 *
 * Why live tables instead of the export zip: both apps share one MySQL
 * database, so the legacy rows are already here. Only the photo bytes may
 * live elsewhere, hence the configurable photos directory.
 */

import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'

import { plan, ORDER } from './plan.js'
import { planPhotoCopies } from './photos.js'
import { importInto } from './import.js'
import { T } from '../entities.js'

export const DEFAULT_PHOTOS_DIR = '/private/data/photos'

/* Staged plans live here between plan and apply. Single-use: apply consumes
   the id, and anything older than the TTL is dropped on the next plan. */
const SESSIONS = new Map()
const SESSION_TTL_MS = 30 * 60 * 1000

/*
 * The planner eats raw dump text (quoted strings, bare NULL, bare numbers),
 * because that is what the dump reader yields. Live driver rows carry JS
 * values instead — Date objects, real nulls, booleans — and feeding those in
 * raw crashes unquote() or poisons timestamps. This converts each value to
 * the exact text the legacy exporter would have written for it.
 */
function toDumpText(value, table, column, warnings) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      warnings.push(`${table}.${column}: non-finite number dropped`)
      return 'NULL'
    }
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Date) {
    /* The legacy exporter wrote UTC wall-clock for Date objects. */
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    if (value.length === 1) return String(value[0])
    warnings.push(`${table}.${column}: binary value dropped`)
    return 'NULL'
  }
  return `'${String(value).replace(/'/g, "''")}'`
}

async function readLiveTables(database, warnings) {
  const tables = new Map()
  const names =
    database.dialect === 'mysql'
      ? (await database.all('SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()')).map((r) => r.n)
      : (await database.all(`SELECT name AS n FROM sqlite_master WHERE type = 'table'`)).map((r) => r.n)
  for (const name of names) {
    const rows = await database.all(`SELECT * FROM \`${name}\``)
    const columns = rows.length ? Object.keys(rows[0]) : []
    tables.set(name, {
      columns,
      rows: rows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([c, v]) => [c, toDumpText(v, name, c, warnings)])),
      ),
    })
  }
  /* plan() only walks ORDER, but the dropped/unmapped report walks the map,
     so every table must be present exactly as the dump reader would leave it. */
  void ORDER
  return tables
}

function sweepSessions() {
  const now = Date.now()
  for (const [id, s] of SESSIONS) {
    if (now - s.createdAt > SESSION_TTL_MS) SESSIONS.delete(id)
  }
}

async function targetCustomerCount(database) {
  const probe = await database.get(`SELECT COUNT(*) AS n FROM ${T('customers')}`).catch(() => null)
  return probe ? Number(probe.n) : 0
}

async function photosDirExists(dir) {
  try {
    await readdir(dir)
    return true
  } catch {
    return false
  }
}

export function registerLegacyImportRoutes(app, { database, authenticate, adminOnly, uploadsRoot, log }) {
  app.post('/api/admin/legacy-import/plan', authenticate, adminOnly, async (req, res) => {
    try {
      sweepSessions()
      const photosDir = req.body?.photos_dir || DEFAULT_PHOTOS_DIR
      const adapterWarnings = []
      const tables = await readLiveTables(database, adapterWarnings)

      const now = new Date().toISOString()
      const p = plan(tables, { now })
      p.warnings.unshift(...adapterWarnings)

      const planned = p.rows
        .filter((r) => r.entity === 'photos' && r.row.card_id)
        .map((r) => ({ filename: r.row.filename, cardId: r.row.card_id }))
      const dirFound = await photosDirExists(photosDir)
      const photoPlan = dirFound
        ? await planPhotoCopies(planned, { legacyDir: photosDir, uploadsRoot })
        : { copies: [], missing: planned.map((r) => r.filename), available: 0 }

      const id = randomUUID()
      SESSIONS.set(id, { plan: p, copies: photoPlan.copies, createdAt: Date.now() })

      log(`legacy-import plan staged: ${p.rows.length} rows, ${photoPlan.copies.length} photos`)
      res.json({
        id,
        targetHasCustomers: await targetCustomerCount(database),
        rows: p.rows.length,
        entities: [...new Set(p.rows.map((r) => r.entity))],
        notes: p.notes,
        warnings: p.warnings.slice(0, 40),
        warningTotal: p.warnings.length,
        photosDir,
        photosDirFound: dirFound,
        photosToCopy: photoPlan.copies.length,
        photosMissing: photoPlan.missing.slice(0, 10),
        photosMissingTotal: photoPlan.missing.length,
        photosAvailable: photoPlan.available,
      })
    } catch (e) {
      log(`legacy-import plan failed: ${e?.message}`)
      res.status(500).json({ error: 'plan_failed', detail: e?.message ?? 'unknown' })
    }
  })

  app.post('/api/admin/legacy-import/apply', authenticate, adminOnly, async (req, res) => {
    try {
      const session = SESSIONS.get(req.body?.id)
      if (!session) {
        res.status(410).json({ error: 'plan_expired' })
        return
      }
      /* Single-use before any write, so a double-tap cannot double the rows. */
      SESSIONS.delete(req.body.id)
      const result = await importInto(database, session.plan, { photosCopies: session.copies })
      if (!result.ok && result.reason === 'already_imported') {
        res.status(409).json({ error: 'already_imported', detail: result.message })
        return
      }
      log(`legacy-import applied: ${JSON.stringify(result.counts)} copied=${result.copied}`)
      res.json(result)
    } catch (e) {
      log(`legacy-import apply failed: ${e?.message}`)
      res.status(500).json({ error: 'apply_failed', detail: e?.message ?? 'unknown' })
    }
  })
}
