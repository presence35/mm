# Behaviours — Sync Engine

**Status:** binding. Read before any sync, store, or persistence work.

**Premise:** the server is a *sync peer*, not an authority the UI waits on. Every UI read is served from the local store. These endpoints exist to converge devices and to host the public QR view.

## Non-Negotiable Constraints

1. **Client-allocated IDs.** All entity IDs are client-generated ULIDs. The server never allocates one. This is what makes offline creation work — a card written with no signal has a final ID before it ever reaches the server, so there is no remapping step and therefore no remapping bug. The client never reads a generated id back.
2. **`seq` is the only cursor.** Never a timestamp. Client clocks are wrong and timestamps collide.
3. **Idempotent push.** `op_id` is generated per mutation attempt and retried unchanged. A repeat returns the *original* result. A push must never double-apply.
4. **Per-op independence.** One op failing must not roll back the others in the batch. There is no batch-level transaction.
5. **Keep both on conflict.** The server never silently last-write-wins, and never discards the incoming payload. See §Conflicts.
6. **No hard delete.** Deletion is a versioned tombstone while devices may be offline.
7. **Explicit `now`.** Retention windows, staleness, GC eligibility and conflict age take the current time as a parameter. No `Date.now()` inside an engine function.
8. **Server owns time.** `updated_at` is server-set on accept, never client-supplied. A wrong phone clock cannot corrupt ordering.
9. **Full rehydrate is a supported path**, not an error case. See §Garbage collection.

## Identity

All entity IDs are 26-char Crockford base32 ULID strings. IDs are strings everywhere in JSON. No integer primary keys anywhere in the public contract.

## Row metadata

Every mutable row carries:

| Column | Type | Owner | Meaning |
|---|---|---|---|
| `id` | TEXT PK | client | ULID, generated at creation |
| `rev` | INTEGER | server | Version the **author** based this edit on. Client sends it, server increments. `0` on create. |
| `version` | INTEGER | server | Current authoritative version. Increments on every accepted write. |
| `updated_at` | TEXT | server | ISO-8601 UTC, set on accept. |
| `updated_by` | TEXT | server | Employee ULID who wrote it. |
| `device_id` | TEXT | server | Which device wrote it. |
| `deleted_at` | TEXT NULL | server | Tombstone timestamp. |

`rev` versus `version` is the whole concurrency story: the client says *"I saw version 7 and I am writing version 8."* If the server is still at 7, apply. Otherwise it is a conflict.

Immutable tables — `change_log` and `sync_ops` carry only `id` + `seq`, and are never pulled into the local store as entities.

## `GET /api/sync/pull?cursor=<seq>&limit=<n>`

Delta. Every change since `cursor`.

```json
{
  "changes": [
    { "seq": 1041, "entity": "service_cards", "entity_id": "01J…",
      "op": "upsert", "version": 3, "payload": { }, "changed_at": "2026-10-02T14:03:11Z" }
  ],
  "cursor": 1041,
  "has_more": false,
  "full_sync": false
}
```

`op` ∈ `upsert` | `delete`. On `delete`, `payload` is `null` and only `entity_id`, `seq` and `version` matter.

Client stores the highest `seq` applied. Polls on app foreground, on network regain, and every 60s while visible.

## `POST /api/sync/push`

```json
{
  "device_id": "01J…",
  "ops": [
    { "op_id": "01J…", "entity": "work_logs", "entity_id": "01J…",
      "op": "upsert", "rev": 0, "payload": { } }
  ]
}
```

Per-op results:

```json
{ "op_id": "01J…", "result": "applied",  "version": 1, "seq": 1042 }
{ "op_id": "01J…", "result": "conflict", "conflict_id": "01J…", "server_version": 11 }
{ "op_id": "01J…", "result": "rejected", "reason": "unauthorized_role" }
{ "op_id": "01J…", "result": "rejected", "reason": "entity_not_found" }
```

Rejection reasons are a closed set: `unauthorized_role`, `unauthorized_entity`, `entity_not_found`, `validation_failed`, `payload_too_large`.

`op_id` is consumed even for rejections, so a rejected op cannot be replayed into acceptance by a stale retry.

## Conflicts

**Trigger:** server `version != op.rev` on an upsert.

Server behaviour:
1. Do **not** apply the incoming payload to the entity.
2. Write both versions to `card_conflicts`.
3. Return `result: "conflict"`.

```sql
CREATE TABLE card_conflicts (
  id               TEXT PRIMARY KEY,       -- client-generated ULID
  entity           TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  local_payload    TEXT NOT NULL,          -- what the worker wrote
  server_payload   TEXT NOT NULL,          -- what the server holds
  local_rev        INTEGER NOT NULL,
  server_version   INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',   -- open | resolved
  resolution       TEXT,                   -- kept_local | kept_server | merged
  resolved_payload TEXT,
  detected_at      TEXT NOT NULL,
  resolved_by      TEXT,
  resolved_at      TEXT
);
```

Client behaviour:
- Applies the server payload — the server stays authoritative for the entity itself.
- Surfaces a **Needs review** badge on the card.
- Resolution offers keep mine / keep theirs / edit-and-merge.
- **Resolution is itself a queued write** and can be performed offline.
- Resolving as `kept_local` or `merged` re-writes the entity at `server_version + 1` — an ordinary convergent write, not a special case.

## Change log & garbage collection

```sql
CREATE TABLE change_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- strictly increasing, monotonic
  op_id      TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  op         TEXT NOT NULL,                       -- upsert | delete
  version    INTEGER NOT NULL,
  payload    TEXT,                                -- full row JSON on upsert, NULL on delete
  changed_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  device_id  TEXT NOT NULL
);
CREATE INDEX idx_change_entity ON change_log(entity, entity_id);

CREATE TABLE sync_ops (
  op_id      TEXT PRIMARY KEY,
  result     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sync_devices (
  device_id    TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  platform     TEXT NOT NULL,
  employee_id  TEXT NOT NULL,
  last_cursor  INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  revoked_at   TEXT
);
```

**GC rule.** A `change_log` row may be deleted only when `seq < MIN(last_cursor)` across all non-revoked devices **and** `seq` is older than 90 days. The floor protects devices that have been dark — including a phone iOS evicted whose employee has not yet re-synced.

**Full rehydrate.** A device whose cursor sits below the GC floor gets `full_sync: true` and a complete entity dump instead of a delta. The client wipes and rebuilds local state. This is the path a user hits after an iOS eviction and **must be exercised in testing**.

## Reference data

Delivered through the same sync stream, not bundled — except a bootstrap snapshot shipped with the app for the very first launch.

| Entity | Why server-owned |
|---|---|
| `products` | Catalogue changes without an app release. |
| `service_item_templates` | Admin-editable labels and pricing. |
| `storage_layout` | Building names, boathouse numbers, slips, rows, columns, storage types. The marina's physical layout changes; the app must not need a release to learn a new building. |
| `checklist_templates` | Fall / Spring / Storage item sets. |
| `employees` | Name, role, active. PIN hashes never leave the server. |

## Photos — online only, by decision

`POST /api/photos` (multipart) requires a live connection. There is no photo queue.

Client behaviour when offline: the camera stays available — a worker must never lose the ability to *look at* a boat — but the shutter produces a clear, non-dismissible **`Waiting for signal`** state with the pending count and a manual retry. It must not resemble a successful save.

## Retention

Device-local retention: entities this device has touched, plus anything changed in the last 30 days. Older untouched records are evicted from the local store, never from the server. Eviction must not delete a row that has pending unsynced writes.

## Change log for this file

Any change to endpoints, row metadata, conflict semantics or GC rules lands here **before** code, on both sides. Client and server are written against this document independently; if they disagree, this file is wrong and gets fixed first.