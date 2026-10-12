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
import { importInto, legacyImportState, markMigrationComplete, targetCounts } from './import.js'
import { bootstrap } from '../db/index.js'
import { PREFIX, T } from '../entities.js'

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

async function listTables(database) {
  return database.dialect === 'mysql'
    ? (await database.all('SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()')).map((r) => r.n)
    : (await database.all(`SELECT name AS n FROM sqlite_master WHERE type = 'table'`)).map((r) => r.n)
}

async function readLiveTables(database, warnings) {
  const tables = new Map()
  const names = await listTables(database)
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

function countByEntity(rows) {
  const out = {}
  for (const r of rows) out[r.entity] = (out[r.entity] ?? 0) + 1
  return out
}

/*
 * Is the target already holding what this plan would write?
 *
 * "Rows present and no marker" is not evidence that a run failed — the first
 * one finished before the marker table existed. Counting cannot tell those
 * apart either, but comparing the two sides can: if every entity the plan would
 * write is already at or above the planned count, the target holds this
 * migration. Above, not equal, because the bootstrap seeds rows the plan never
 * mentions (the admin employee) and those are expected.
 *
 * A partial run leaves at least one entity short, which is the fact worth
 * reporting and the only one that needs acting on.
 */
export function verdictFor(sourceCounts, targetCounts) {
  const entities = [...new Set([...Object.keys(sourceCounts), ...Object.keys(targetCounts)])].sort()
  const total = entities.reduce((sum, e) => sum + (targetCounts[e] ?? 0), 0)
  if (total === 0) return { verdict: 'empty', missing: [] }

  const missing = entities
    .filter((e) => (sourceCounts[e] ?? 0) > (targetCounts[e] ?? 0))
    .map((e) => ({ entity: e, want: sourceCounts[e] ?? 0, have: targetCounts[e] ?? 0 }))

  return { verdict: missing.length ? 'partial' : 'complete', missing }
}

async function photosDirExists(dir) {
  try {
    await readdir(dir)
    return true
  } catch {
    return false
  }
}

/*
 * Drops every table under our own prefix and re-bootstraps the schema, so a
 * blocked first import (seed/sample rows tripping already_imported) can
 * restart clean. Legacy tables never start with the prefix, so the source
 * data is unreachable by construction — the filter below is the whole safety
 * argument, plus admin-only routing and a UI confirm. Exported for testing.
 */
export async function resetMmTables(database, log = () => {}) {
  const names = (await listTables(database)).filter((n) => n.startsWith(PREFIX))
  if (database.dialect === 'mysql') await database.exec('SET FOREIGN_KEY_CHECKS=0')
  try {
    for (const name of names) {
      await database.exec(`DROP TABLE IF EXISTS \`${name}\``)
    }
  } finally {
    if (database.dialect === 'mysql') await database.exec('SET FOREIGN_KEY_CHECKS=1')
  }
  log(`legacy-import reset: dropped ${names.length} tables`)
  await bootstrap(database, () => {})
  return names
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

      const state = await legacyImportState(database)
      const sourceCounts = countByEntity(p.rows)
      const targetCountsNow = await targetCounts(database)
      const verdict = verdictFor(sourceCounts, targetCountsNow)

      log(`legacy-import plan staged: ${p.rows.length} rows, ${photoPlan.copies.length} photos`)
      res.json({
        id,
        state: { ...state, ...verdict },
        targetHasCustomers: await targetCustomerCount(database),
        sourceCounts,
        targetCounts: targetCountsNow,
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
      res.status(500).json({ error: 'plan_failed', detail: e?.message ?? 'unknown' })    }
  })

  app.post('/api/admin/legacy-import/reset', authenticate, adminOnly, async (req, res) => {
    try {
      if (req.body?.reset !== 'mm-tables') {
        res.status(400).json({ error: 'confirm_required' })
        return
      }
      /* Staged plans reference pre-reset ids; force a fresh plan afterwards. */
      SESSIONS.clear()
      const dropped = await resetMmTables(database, log)
      res.json({ ok: true, dropped: dropped.length, tables: dropped })
    } catch (e) {
      log(`legacy-import reset failed: ${e?.message}`)
      res.status(500).json({ error: 'reset_failed', detail: e?.message ?? 'unknown' })
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
      /* Both refusals are 409 with the reason in `detail`: one means "finished",
         the other means "started and did not finish". They need different
         actions, so they cannot share a status without sharing a message. */
      if (!result.ok && (result.reason === 'already_imported' || result.reason === 'partial_import')) {
        res.status(409).json({ error: result.reason, detail: result.message })
        return
      }
      log(`legacy-import applied: ${JSON.stringify(result.counts)} copied=${result.copied}`)
      res.json(result)
    } catch (e) {
      log(`legacy-import apply failed: ${e?.message}`)
      res.status(500).json({ error: 'apply_failed', detail: e?.message ?? 'unknown' })
    }
  })

  /*
   * Record an import that has already happened.
   *
   * The first run finished before the marker table existed, so a completed
   * target is indistinguishable from a half-written one. Refusing to record it
   * would leave a re-import as the only way out — which is the thing the guard
   * exists to prevent — so the operator can record what is already true.
   *
   * Refused unless the target really holds what the staged plan would write,
   * so "record as complete" cannot become a way to bless a migration that lost
   * half the marina.
   */
  app.post('/api/admin/legacy-import/complete', authenticate, adminOnly, async (req, res) => {
    try {
      if (req.body?.confirm !== 'record-complete') {
        res.status(400).json({ error: 'confirm_required' })
        return
      }
      const session = SESSIONS.get(req.body?.id)
      if (!session) {
        res.status(410).json({ error: 'plan_expired' })
        return
      }

      const sourceCounts = countByEntity(session.plan.rows)
      const { verdict, missing } = verdictFor(sourceCounts, await targetCounts(database))
      if (verdict !== 'complete') {
        res.status(409).json({
          error: 'not_complete',
          detail:
            verdict === 'empty'
              ? 'This database is empty, so there is nothing to record as complete.'
              : `The target is short: ${missing.map((m) => `${m.entity} ${m.have}/${m.want}`).join(', ')}. Run the import instead.`,
          missing,
        })
        return
      }

      SESSIONS.delete(req.body.id)
      const out = await markMigrationComplete(database, { counts: sourceCounts })
      log(`legacy-import recorded complete: ${out.ok}`)
      res.json(out)
    } catch (e) {
      log(`legacy-import complete failed: ${e?.message}`)
      res.status(500).json({ error: 'complete_failed', detail: e?.message ?? 'unknown' })
    }
  })
}
