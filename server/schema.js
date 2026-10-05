import { ALL_TABLES, T } from './entities.js'

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

/*
 * The type for a column that may end up in a key or an index.
 *
 * Bounded on purpose, and bounded in the source rather than corrected afterwards
 * by a dialect rewrite. MySQL refuses to index a TEXT column without a key
 * length (ER_WRONG_KEY_SPECIFICATION), so every primary key and every indexed
 * column has to say how long it is.
 *
 * SQLite accepts VARCHAR(255) and gives it TEXT affinity, so one declaration
 * serves both engines and the schema stops needing to be rewritten per dialect —
 * which is the arrangement that let this reach a deploy unnoticed.
 *
 * 255 is far above what any id here needs: ULIDs are 26 characters, a UUID is
 * 36, a customer token is 33.
 */
const KEY_TEXT = 'VARCHAR(255)'

function columnDdl(name) {
  const n = name.toLowerCase()
  if (n === 'id') return `  id           ${KEY_TEXT} PRIMARY KEY`
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
    out.push(`CREATE TABLE IF NOT EXISTS ${T(spec.table)} (\n${[...cols, META_DDL].join(',\n')}\n);`)
  }
  return out.join('\n\n')
}

/*
 * SQLite and MySQL both accept this verbatim.
 *
 * Every column that is a key, or that an index names, is VARCHAR(255) rather
 * than TEXT. MySQL will not index an unbounded TEXT column, and two of these
 * were easy to miss: login_attempts declares its primary key separately from the
 * columns, and the index on change_log names entity and entity_id rather than
 * declaring them. Both are bounded now, and driver.test.js asserts the property
 * rather than trusting that nobody adds another one.
 */
export const SYNC_DDL = `
CREATE TABLE IF NOT EXISTS ${T('change_log')} (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id      TEXT NOT NULL,
  /* Both are indexed below, so both must be bounded. */
  entity     VARCHAR(255) NOT NULL,
  entity_id  VARCHAR(255) NOT NULL,
  op         TEXT NOT NULL,
  version    INTEGER NOT NULL,
  payload    TEXT,
  changed_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  device_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ${T('idx_change_entity')} ON ${T('change_log')}(entity, entity_id);

CREATE TABLE IF NOT EXISTS ${T('sync_ops')} (
  op_id      VARCHAR(255) PRIMARY KEY,
  result     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${T('sync_devices')} (
  device_id    VARCHAR(255) PRIMARY KEY,
  label        TEXT NOT NULL,
  platform     TEXT NOT NULL,
  employee_id  TEXT NOT NULL,
  last_cursor  INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS ${T('card_conflicts')} (
  id               VARCHAR(255) PRIMARY KEY,
  entity           TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  local_payload    TEXT NOT NULL,
  server_payload   TEXT NOT NULL,
  local_rev        INTEGER NOT NULL,
  server_version   INTEGER NOT NULL,
  /* VARCHAR, not TEXT: MySQL refuses a DEFAULT on a TEXT column. The default is
     what makes an unrouted conflict open rather than invisible, so the type
     gives way, not the default. */
  status           VARCHAR(255) NOT NULL DEFAULT 'open',
  resolution       TEXT,
  resolved_payload TEXT,
  detected_at      TEXT NOT NULL,
  resolved_by      TEXT,
  resolved_at      TEXT
);

CREATE TABLE IF NOT EXISTS ${T('sessions')} (
  token      VARCHAR(255) PRIMARY KEY,
  employee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${T('login_attempts')} (
  employee_id VARCHAR(255) NOT NULL,
  source      VARCHAR(255) NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (employee_id, source)
);
`

export const FULL_DDL = `${domainDdl()}\n\n${SYNC_DDL}`