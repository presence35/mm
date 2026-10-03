import { ALL_TABLES } from './entities.js'

/*
 * Schema. Every mutable table carries the same metadata block so the sync
 * engine can treat them uniformly:
 *
 *   id           TEXT pk   client-generated ULID — the server never allocates
 *   rev          INTEGER  version the author based this edit on
 *   version      INTEGER  current authoritative version, server-incremented
 *   updated_at   TEXT     ISO-8601 UTC, set on accept
 *   updated_by   TEXT     employee ULID
 *   device_id    TEXT     which device wrote it
 *   deleted_at   TEXT     tombstone; never a hard delete
 */

const META_DDL = `
  rev          INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT    NOT NULL,
  updated_by   TEXT,
  device_id    TEXT,
  deleted_at   TEXT
`

/* Existing installations need these rebuilt — SQLite cannot alter a column's
   type, and the wrong affinity is what produced the "3.0" readings. */
export const REBUILD_IF_TYPE_WRONG = ['boathouse_no', 'slip_no', 'storage_row', 'season_year']

function columnDdl(name) {
  const n = name.toLowerCase()
  if (n === 'id') return '  id           TEXT PRIMARY KEY'
  if (n.endsWith('_at') || n === 'log_date' || n === 'date_in' || n === 'date_out' || n === 'changed_at' || n === 'completed_at')
    return `  ${name.padEnd(12)} TEXT`
  if (['created_by', 'completed_by', 'employee_id', 'uploaded_by', 'assigned_by', 'customer_id', 'boat_id', 'card_id', 'work_log_id'].includes(n))
    return `  ${name.padEnd(12)} TEXT`
  /* Domain columns stay nullable. The sync layer always writes every column,
     so a NOT NULL here would turn "absent" into an explicit NULL and defeat
     the DEFAULT. Constraints that matter live in the metadata block, where
     the server always supplies the value. */
  /* Numeric identifiers must be declared numeric. As TEXT, SQLite's affinity
   stores 3 and reads back "3.0" after a round trip, which then renders as
   "BH 3.0" and, once pulled onto a client, keeps re-seeding that value. */
  if (['version', 'sort_order', 'quantity', 'total', 'active', 'is_fake', 'is_scanned', 'wrap_required', 'unwrap_done', 'authorized', 'completed', 'present', 'boathouse_no', 'slip_no', 'storage_row', 'season_year'].includes(n))
    return `  ${name.padEnd(12)} INTEGER DEFAULT 0`
  if (['length_ft', 'tax_rate', 'unit_price', 'gps_lat', 'gps_lng'].includes(n))
    return `  ${name.padEnd(12)} REAL`
  return `  ${name.padEnd(12)} TEXT`
}

export function domainDdl() {
  const out = []
  for (const [entity, spec] of Object.entries(ALL_TABLES)) {
    const cols = [spec.pk, ...spec.columns.filter((c) => c !== spec.pk)].map(columnDdl)
    out.push(`CREATE TABLE IF NOT EXISTS ${spec.table} (\n${[...cols, META_DDL].join(',\n')}\n);`)
  }
  return out.join('\n\n')
}

/* SQLite and MySQL both accept this verbatim. */
export const SYNC_DDL = `
CREATE TABLE IF NOT EXISTS change_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id      TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  op         TEXT NOT NULL,
  version    INTEGER NOT NULL,
  payload    TEXT,
  changed_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  device_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_entity ON change_log(entity, entity_id);

CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,
  result     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_devices (
  device_id    TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  platform     TEXT NOT NULL,
  employee_id  TEXT NOT NULL,
  last_cursor  INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS card_conflicts (
  id               TEXT PRIMARY KEY,
  entity           TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  local_payload    TEXT NOT NULL,
  server_payload   TEXT NOT NULL,
  local_rev        INTEGER NOT NULL,
  server_version   INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',
  resolution       TEXT,
  resolved_payload TEXT,
  detected_at      TEXT NOT NULL,
  resolved_by      TEXT,
  resolved_at      TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  employee_id TEXT NOT NULL,
  source      TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (employee_id, source)
);
`

export const FULL_DDL = `${domainDdl()}\n\n${SYNC_DDL}`