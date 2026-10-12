/*
 * Legacy import.
 *
 * Runs the three phases in the only order that cannot leave a mess:
 *
 *   1. plan     — pure. Decides every new id and reports what it will not carry.
 *   2. photos   — copy bytes. Independent of the database, and the slow part.
 *   3. rows     — insert, with change_log entries so history reaches a phone.
 *
 * Dry run is the default. Writing to a database that holds a marina's history
 * is not something to do because someone forgot a flag, so --apply is required
 * and the plan is printed in both modes.
 *
 * Refuses to run twice. A second run would double every row and, worse, leave
 * two ids for the same customer's boat with no way to tell which is real.
 */

import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createDb, bootstrap } from '../db/index.js'
import { ALL_TABLES, T } from '../entities.js'
import { readTables } from './reader.js'
import { plan } from './plan.js'
import { applyAndVerify, DanglingReferences } from './apply.js'
import { planPhotoCopies, copyPhotos } from './photos.js'

const USAGE = `
Import the legacy marina export into the current schema.

  node server/legacy/import.js --dump <backup.sql> [options]

  --dump <path>       the backup.sql from the legacy app's export zip (required)
  --photos <dir>      directory holding the exported photo files
  --uploads <dir>     where this app serves photos from (default ./uploads)
  --apply             actually write. Without this, nothing is modified.
  --now <iso>         timestamp for migrated rows. Defaults to the current time;
                      pass it to make a rehearsal and the real run identical.

Prints a report either way: what migrated, what was dropped, and what it could
not resolve. Read the report before using --apply.
`

/*
 * Has this database already been imported?
 *
 * Answered by a completion marker, not by counting rows. Counting customers
 * cannot tell a finished import from one that died halfway — both leave rows
 * behind — so a partial run was refused forever by a guard that believed it was
 * looking at a completed one. The mark is written only after verify() passes.
 *
 * The legacy tables are expected to be present and full; only our own prefixed
 * tables are counted.
 */
export const MIGRATION = 'legacy-import'

export async function completedMigration(db) {
  return db.get(`SELECT * FROM ${T('migrations')} WHERE name = ?`, [MIGRATION]).catch(() => null)
}

/* Every row this app owns, one table at a time. One number cannot describe
   "some of it is already here" when the failure happened before that table was
   reached, and it cannot describe "all of it is here, only the marker is
   missing" either — which is the state a first import leaves behind when it
   predates the marker table. */
export async function targetCounts(db) {
  const out = {}
  for (const [entity, spec] of Object.entries(ALL_TABLES)) {
    const row = await db.get(`SELECT COUNT(*) AS n FROM ${T(spec.table)}`).catch(() => null)
    out[entity] = row ? Number(row.n) : null
  }
  return out
}

export async function targetRowTotal(db) {
  return Object.values(await targetCounts(db)).reduce((a, b) => a + (b ?? 0), 0)
}

/* What the Setup panel needs to say which state this target is in. */
export async function legacyImportState(db) {
  const marker = await completedMigration(db)
  return {
    imported: Boolean(marker),
    completedAt: marker?.completed_at ?? null,
    record: marker?.detail ? safeParse(marker.detail) : null,
    targetRows: await targetRowTotal(db),
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/*
 * Mark a migration complete without running one.
 *
 * The first import ran before the marker table existed, so a finished target
 * looks exactly like a half-written one — rows present, no marker — and the
 * only way out was a re-import, which is precisely what the guard exists to
 * prevent. This is the way out: it records what is already true.
 *
 * It does not verify anything itself. Deciding whether the target really holds
 * what the plan would write is the caller's job, because the caller is the one
 * holding the plan.
 */
export async function markMigrationComplete(db, { counts = null, now = new Date().toISOString() } = {}) {
  const done = await completedMigration(db)
  if (done) return { ok: false, reason: 'already_imported', completedAt: done.completed_at }

  await db.run(`INSERT INTO ${T('migrations')} (name, completed_at, detail) VALUES (?, ?, ?)`, [
    MIGRATION,
    now,
    JSON.stringify({ recorded: 'marked complete without re-importing', counts }),
  ])

  return { ok: true, completedAt: now }
}

export async function importInto(db, p, { photosCopies = [], now = new Date().toISOString() } = {}) {
  const done = await completedMigration(db)
  if (done) {
    return {
      ok: false,
      reason: 'already_imported',
      message:
        `This database was already migrated on ${done.completed_at}. ` +
        'Importing again would duplicate every row. Use a fresh database, or drop the prefixed tables first.',
    }
  }

  const existing = await targetRowTotal(db)
  if (existing > 0) {
    return {
      ok: false,
      reason: 'partial_import',
      message:
        `This database holds ${existing} rows under our own tables and no completed migration. ` +
        'Either a previous run did not finish, or a device seeded its sample data here. ' +
        'Nothing has been written. Drop the prefixed tables (Setup → Legacy import → Reset mm tables) and re-plan.',
    }
  }

  /* Photos first: the copy is independent of the database, and a file that
     cannot be written should stop the import before any row claims a card. */
  const copied = photosCopies.length ? await copyPhotos(photosCopies) : 0

  let counts
  try {
    ;({ counts } = await applyAndVerify(db, p))
  } catch (e) {
    if (e instanceof DanglingReferences) {
      return { ok: false, reason: 'dangling_references', message: e.message, counts: null, copied, problems: e.problems }
    }
    throw e
  }

  /* Written last, and only here. Everything before this point can be retried
     from a clean state; this is the line that makes it not. */
  await db.run(`INSERT INTO ${T('migrations')} (name, completed_at, detail) VALUES (?, ?, ?)`, [
    MIGRATION,
    now,
    JSON.stringify(counts),
  ])

  return { ok: true, counts, copied, problems: [] }
}

export async function main(argv = process.argv) {
  const apply = argv.includes('--apply')
  const dumpPath = argv.includes('--dump') ? argv[argv.indexOf('--dump') + 1] : null
  const photosDir = argv.includes('--photos') ? argv[argv.indexOf('--photos') + 1] : null
  const uploadsRoot = argv.includes('--uploads') ? argv[argv.indexOf('--uploads') + 1] : './uploads'
  const now = argv.includes('--now') ? argv[argv.indexOf('--now') + 1] : new Date().toISOString()

  if (!dumpPath) {
    console.log(USAGE)
    return 2
  }
  if (!existsSync(dumpPath)) {
    console.error(`No such dump: ${dumpPath}`)
    return 2
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'}  dump=${basename(dumpPath)}`)
  if (!apply) console.log('Nothing will be written. Re-run with --apply to migrate.')

  const tables = readTables(readFileSync(dumpPath, 'utf8'))
  const p = plan(tables, { now })

  console.log(`\n${p.rows.length} rows across ${new Set(p.rows.map((r) => r.entity)).size} entities`)
  for (const note of p.notes) console.log(`  ${note}`)

  if (p.warnings.length) {
    console.log(`\n${p.warnings.length} warnings`)
    for (const w of p.warnings.slice(0, 40)) console.log(`  ! ${w}`)
    if (p.warnings.length > 40) console.log(`  ... and ${p.warnings.length - 40} more`)
  }

  /* Resolve each photo row to its new card id, so a file lands in the directory
     its row will look in. Planning the copies is separate from making them:
     the count is reported in a dry run, and the bytes move only under --apply. */
  let photosCopies = []
  if (photosDir) {
    const planned = p.rows
      .filter((r) => r.entity === 'photos' && r.row.card_id)
      .map((r) => ({ filename: r.row.filename, cardId: r.row.card_id }))

    const plannedCopies = await planPhotoCopies(planned, { legacyDir: photosDir, uploadsRoot })
    photosCopies = plannedCopies.copies
    console.log(`\nphotos: ${photosCopies.length} to copy, ${plannedCopies.missing.length} without a file`)
    if (plannedCopies.missing.length) {
      console.log('  These import as a row with no image, rather than a dead link:')
      for (const m of plannedCopies.missing.slice(0, 10)) console.log(`    ${m}`)
      if (plannedCopies.missing.length > 10) {
        console.log(`    ... and ${plannedCopies.missing.length - 10} more`)
      }
    }
  } else if (tables.get('photos')?.rows.length) {
    console.log('\nphotos: no --photos directory given, so no image files will be copied.')
  }

  if (!apply) {
    console.log('\nDry run complete. Nothing was written.')
    return 0
  }

  const db = createDb()
  await bootstrap(db, () => {})

  const result = await importInto(db, p, { photosCopies: photosCopies ?? [] })
  if (!result.ok && (result.reason === 'already_imported' || result.reason === 'partial_import')) {
    console.error(`\nRefusing to import: ${result.message}`)
    await db.close?.()
    return 1
  }

  console.log('\ninserted')
  for (const [entity, n] of Object.entries(result.counts)) console.log(`  ${entity}: ${n}`)
  if (result.copied) console.log(`\nphotos copied: ${result.copied}`)

  if (result.problems.length) {
    console.error('\nDANGLING REFERENCES — the import is not trustworthy:')
    for (const x of result.problems) console.error(`  ${x}`)
    await db.close?.()
    return 1
  }
  console.log('\nno dangling references')

  await db.close?.()
  console.log('Import complete.')
  return 0
}



/* pathToFileURL rather than string concatenation: on Windows the drive letter
   needs a third slash, and a wrong comparison here means the script silently
   does nothing and exits 0. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}