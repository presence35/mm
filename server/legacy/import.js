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
import { T } from '../entities.js'
import { readTables } from './reader.js'
import { plan } from './plan.js'
import { applyPlan, verify } from './apply.js'
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
 * Before anything is written: has this database already been imported?
 * Counted against our own tables only. The legacy tables are expected to be
 * present and full — that is the source — so counting those would refuse every
 * run against the production schema.
 */
async function alreadyImported(db) {
  const probe = await db.get(`SELECT COUNT(*) AS n FROM ${T('customers')}`).catch(() => null)
  return probe ? Number(probe.n) : 0
}

export async function importInto(db, p, { photosCopies = [] } = {}) {
  const existing = await alreadyImported(db)
  if (existing > 0) {
    return {
      ok: false,
      reason: 'already_imported',
      message:
        `This database already holds ${existing} customers under our own tables. ` +
        'Importing again would duplicate every row. Use a fresh database, or drop the prefixed tables first.',
    }
  }
  const copied = photosCopies.length ? await copyPhotos(photosCopies) : 0
  const counts = await applyPlan(db, p)
  const problems = await verify(db, p)
  return { ok: problems.length === 0, counts, copied, problems }
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
  if (!result.ok && result.reason === 'already_imported') {
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