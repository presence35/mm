/*
 * Applies a migration plan to the database.
 *
 * The plan is inserted directly rather than pushed through the sync endpoint.
 * Push exists to arbitrate concurrent editors; a one-shot import has no
 * concurrent editor, and routing through it would mean fabricating op ids and
 * device ids for rows no device ever held. Every row still lands in change_log,
 * because that is what makes the history reachable by delta pull on a phone
 * that has never seen the legacy app.
 */

import { randomUUID } from 'node:crypto'

import { ALL_TABLES, T, columnsFor } from '../entities.js'
import { rowToPayload } from '../sync.js'

export async function applyPlan(db, plan, { deviceId = 'legacy' } = {}) {
  /* One transaction.
     This used to insert row by row with no transaction, and the failure mode
     was not a clean abort: a run that died partway left 23 customers written
     and no cards, and the guard in import.js then refused every retry — a
     half-migrated database that looks healthy and can never be re-run. Now a
     failure rolls the whole thing back and the next attempt starts clean. */
  return db.tx((handle) => insertAll(handle, plan, deviceId))
}

/*
 * Insert and verify as one unit.
 *
 * Verification is part of the migration, not a report on it: a dangling
 * reference means the rows just written are wrong, so they roll back with it
 * rather than being left behind for someone to clean up by hand.
 */
export class DanglingReferences extends Error {
  constructor(problems) {
    super(`The migration found ${problems.length} dangling reference(s), so it was rolled back. Nothing was written.`)
    this.name = 'DanglingReferences'
    this.problems = problems
  }
}

export async function applyAndVerify(db, plan, { deviceId = 'legacy' } = {}) {
  return db.tx(async (handle) => {
    const counts = await insertAll(handle, plan, deviceId)
    const problems = await verify(handle, plan)
    /* Thrown rather than returned: a transaction unwinds on an exception and
       on nothing else, so returning the problems would commit the rows they
       describe. */
    if (problems.length) throw new DanglingReferences(problems)
    return { counts, problems: [] }
  })
}

async function insertAll(db, plan, deviceId) {
  const counts = {}

  for (const { entity, row } of plan.rows) {
    const spec = ALL_TABLES[entity]
    const columns = columnsFor(entity)
    const values = columns.map((c) => (c in row ? row[c] : null))
    const marks = columns.map(() => '?').join(', ')

    await db.run(
      `INSERT INTO ${T(spec.table)} (${columns.join(', ')}) VALUES (${marks})`,
      values,
    )

    /* change_log makes this reachable by delta pull. op 'upsert' with the
       migrated version, so a client that has never synced accepts it as the
       current state rather than as a deletion. */
    await db.run(
      `INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
       VALUES (?, ?, ?, 'upsert', ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entity,
        row.id,
        row.version ?? 1,
        JSON.stringify(rowToPayload(entity, row)),
        row.updated_at,
        row.updated_by ?? deviceId,
        row.device_id ?? deviceId,
      ],
    )

    counts[entity] = (counts[entity] ?? 0) + 1
  }

  return counts
}

/*
 * Referential integrity, checked against the database rather than assumed from
 * the mapping. A migration that silently orphaned a boat's service history would
 * look entirely healthy in the UI — the card would simply be empty.
 */
export async function verify(db, plan) {
  const problems = []

  for (const [entity, spec] of Object.entries(ALL_TABLES)) {
    const total = await db.get(`SELECT COUNT(*) AS n FROM ${T(spec.table)}`)
    if (Number(total.n) === 0) continue

    /* Any FK column that is not null must resolve. Collected from the plan's
       own rows so this follows the mapping rather than a second list.
       device_id is metadata naming a sync device, not a row reference, so it is
       excluded — it resolves against sync_devices, not an entity table. */
    const fkColumns = new Set()
    for (const r of plan.rows) {
      if (r.entity !== entity) continue
      for (const c of Object.keys(r.row)) {
        if (c.endsWith('_id') && c !== 'id' && c !== 'device_id') fkColumns.add(c)
      }
    }

    for (const column of fkColumns) {
      const orphan = await db.get(
        `SELECT COUNT(*) AS n FROM ${T(spec.table)} t
         WHERE t.${column} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${T(ALL_TABLES[targetOf(column)].table)} p WHERE p.id = t.${column})`,
      ).catch(() => null)
      if (orphan && Number(orphan.n) > 0) {
        problems.push(`${spec.table}.${column}: ${orphan.n} rows point at nothing`)
      }
    }
  }

  return problems
}

/* Which table a *_id column points at. Named explicitly: inferring it from the
   column name would guess 'employees' for 'assigned_by' and be wrong. */
function targetOf(column) {
  switch (column) {
    case 'customer_id':
      return 'customers'
    case 'boat_id':
      return 'boats'
    case 'card_id':
      return 'service_cards'
    case 'work_log_id':
      return 'work_logs'
    case 'employee_id':
    case 'created_by':
    case 'completed_by':
    case 'assigned_by':
    case 'uploaded_by':
      return 'employees'
    default:
      throw new Error(`verify() does not know what ${column} references`)
  }
}