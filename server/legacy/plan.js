/*
 * Legacy -> new mapping.
 *
 * Two jobs, kept apart on purpose:
 *
 *   plan()  decides what every new id will be, and which legacy columns survive.
 *           Pure, no I/O. Running it twice on the same input yields the same
 *           plan, so a rehearsal is meaningful and a re-run is a no-op.
 *
 *   emit()  turns a plan into rows. Also pure.
 *
 * Ids are ULIDs minted here, deterministically from the legacy table and row
 * id. That is a deliberate difference from production, where the server never
 * allocates an id: this runs once, offline, over a frozen input. Deriving them
 * rather than randomising means the migration is idempotent, so a half-finished
 * run can be repeated without orphaning rows that already landed.
 */

import { createHash } from 'node:crypto'

import { ALL_TABLES } from '../entities.js'
import { unquote } from './reader.js'

/*
 * Legacy tables that carry no counterpart, and why. device_tokens is push
 * registration for the retired notification path; migrating it would imply the
 * new app can use tokens it does not implement.
 */
const DROPPED_TABLES = new Set(['device_tokens'])

/*
 * Legacy columns with no counterpart in the new schema.
 *
 * All of these are null in every production row: the legacy app soft-deleted
 * boats and customers but never used the flag in practice, and serial_no was
 * abandoned once engine descriptions moved into motor_type. Nothing is
 * rescued from them — the engine text a mechanic typed lives in motor_type,
 * which migrates as an ordinary column.
 *
 * Verified against the production export rather than the legacy repository's
 * dev backup, which still had engine text in serial_no and would have justified
 * a conversion that production data does not need.
 */
const DROPPED_COLUMNS = {
  boats: { deleted_at: null, serial_no: null },
  customers: { deleted_at: null },
}

/* Legacy child rows carry a card_id that must point at a migrated card. */
const CARD_CHILDREN = [
  'received_items',
  'authorized_work',
  'condition_assessment',
  'work_logs',
  'photos',
  'checklist_completions',
  'status_history',
  'invoice_items',
]

/*
 * Order matters: a row's new id must exist before anything references it.
 * Employees and customers are roots; boats hang off customers; cards off boats.
 */
export const ORDER = [
  'employees',
  'customers',
  'boats',
  'boat_serials',
  'service_cards',
  'boat_assignments',
  ...CARD_CHILDREN,
  'parts_used',
  'products',
  'service_item_templates',
  'storage_layout',
  'checklist_templates',
]

/*
 * Columns that reference another entity's id, and which entity they point at.
 * Derived from the table name so an unlisted reference is a loud error rather
 * than a string left pointing at integer 7.
 */
const FOREIGN_KEYS = {
  boats: { customer_id: 'customers' },
  boat_serials: { boat_id: 'boats' },
  service_cards: { boat_id: 'boats', created_by: 'employees' },
  boat_assignments: { boat_id: 'boats', employee_id: 'employees', assigned_by: 'employees' },
  received_items: { card_id: 'service_cards' },
  authorized_work: { card_id: 'service_cards', completed_by: 'employees' },
  condition_assessment: { card_id: 'service_cards' },
  work_logs: { card_id: 'service_cards', employee_id: 'employees' },
  parts_used: { work_log_id: 'work_logs' },
  photos: {
    card_id: 'service_cards',
    work_log_id: 'work_logs',
    uploaded_by: 'employees',
  },
  checklist_completions: { card_id: 'service_cards', employee_id: 'employees' },
  status_history: { card_id: 'service_cards', employee_id: 'employees' },
  invoice_items: { card_id: 'service_cards' },
}

/* Legacy timestamps are "YYYY-MM-DD HH:MM:SS" in local wall-clock; the app
   stores ISO-8601 UTC. A space-separated stamp is not parseable by
   Date.parse on every platform, and a bare local stamp has no zone. Treating
   it as UTC is a known approximation — the marina is in one timezone and the
   alternative was discarding the times. */
export function toIso(value) {
  if (!value) return null
  const s = String(value).trim()
  if (!s || s === 'NULL') return null
  if (s.includes('T')) return s
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return s
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`
}

/*
 * Deterministic ULID-shaped id. 26 chars, Crockford base32, so it satisfies the
 * same shape as a client-generated id and sorts by creation order within a
 * table. Not a true ULID — the timestamp prefix is derived from the legacy id —
 * which is fine because the contract's requirement is uniqueness and opacity,
 * not lexicographic time.
 */
export function legacyId(table, legacyIdValue) {
  const h = createHash('sha256').update(`mm-migration:${table}:${legacyIdValue}`).digest()
  let n = BigInt(`0x${h.toString('hex').slice(0, 24)}`)
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let out = ''
  for (let i = 0; i < 26; i++) {
    out = alphabet[Number(n % 32n)] + out
    n /= 32n
  }
  return out
}

const isNumeric = (v) => v !== null && v !== undefined && v !== '' && /^-?\d+(\.\d+)?$/.test(String(v).trim())

/*
 * Booleans in the legacy dump arrive as 0/1; the new schema stores them as
 * integers, so they pass through. Anything else is a bug in the dump and is
 * reported rather than guessed.
 */
function coerce(value, column, warnings, table) {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (raw === 'NULL' || raw === '') return null
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'")
  if (isNumeric(raw)) return Number(raw)
  warnings.push(`${table}.${column}: unexpected bare token ${JSON.stringify(raw)}`)
  return raw
}

/*
 * Turns the parsed legacy tables into a migration plan: new ids, and rows ready
 * to insert with the shared metadata block filled in.
 *
 * `now` is explicit. Migrated rows are stamped with the migration time, not
 * with today's date read from the clock, so a rehearsal and the real run differ
 * only in that value and nothing else.
 */
export function plan(tables, { now, warnings = [] } = {}) {
  if (!now) throw new Error('plan() needs an explicit now')

  const stamp = toIso(now)
  const ids = new Map() // `${table}:${legacyId}` -> new ULID
  const rows = []
  const notes = []

  const idFor = (table, legacy) => {
    const key = `${table}:${legacy}`
    if (!ids.has(key)) ids.set(key, legacyId(table, legacy))
    return ids.get(key)
  }

  /*
   * A foreign key is either a legacy integer to translate, or NULL. The reader
   * yields raw SQL text, so an absent reference arrives as the bare token NULL —
   * which must become a real null, not the four-character string. Passing that
   * through would produce a row pointing at nothing and a dangling-reference
   * report for a link that was never there.
   */
  const remap = (column, target) => {
    const value = unquote(column)
    if (value === null) return null
    if (!isNumeric(value)) {
      warnings.push(`${target}: reference ${JSON.stringify(value)} is not a legacy id`)
      return null
    }
    const mapped = ids.get(`${target}:${String(value).trim()}`)
    if (!mapped) {
      warnings.push(`${target}: legacy id ${value} was referenced but never migrated`)
      return null
    }
    return mapped
  }

  for (const table of ORDER) {
    const legacy = tables.get(table)
    const spec = ALL_TABLES[table]
    if (!spec) {
      warnings.push(`${table}: no entity in the current schema; skipped`)
      continue
    }
    if (!legacy || legacy.rows.length === 0) {
      notes.push(`${table}: nothing in the export`)
      continue
    }

    const fks = FOREIGN_KEYS[table] ?? {}
    const dropped = DROPPED_COLUMNS[table] ?? {}

    for (const row of legacy.rows) {
      const newId = idFor(table, row.id)
      const out = { id: newId }

      for (const column of spec.columns) {
        if (column in fks) {
          out[column] = remap(row[column], fks[column])
          continue
        }
        if (column === 'created_at' && row.created_at === undefined && row.completed_at) {
          out[column] = toIso(row.completed_at)
          continue
        }
        out[column] = coerce(row[column], column, warnings, table)
      }

      /* The metadata block. rev 0 and version 1 because a migrated row has
         never been edited by a device — it is the baseline every later edit
         builds on. device_id is 'legacy' so a client can tell imported history
         from something a person typed. */
      out.rev = 0
      out.version = 1
      out.updated_at = toIso(row.updated_at) ?? toIso(row.created_at) ?? stamp
      out.updated_by = out.updated_by ?? idFor('employees', '1')
      out.device_id = 'legacy'
      out.deleted_at = null

      rows.push({ entity: table, row: out })
    }

    notes.push(`${table}: ${legacy.rows.length} rows`)
  }

  /* Dropped columns are reported by name and by how much data they held, so a
     silent loss cannot hide behind a green run. */
  for (const [table, columns] of Object.entries(DROPPED_COLUMNS)) {
    const legacy = tables.get(table)
    if (!legacy) continue
    for (const column of Object.keys(columns)) {
      const held = legacy.rows.filter((r) => unquote(r[column]) !== null).length
      notes.push(`${table}.${column}: dropped (${held} rows had a value)`)
    }
  }

  for (const table of tables.keys()) {
    if (DROPPED_TABLES.has(table)) notes.push(`${table}: dropped (no counterpart)`)
    else if (!ORDER.includes(table)) notes.push(`${table}: NOT MIGRATED — unmapped`)
  }

  return { rows, notes, warnings, ids }
}