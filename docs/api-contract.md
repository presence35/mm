# Marina Manager — Sync & API Contract

**Status:** binding. Backend spec. Client and server are written independently against this file.

**Design premise:** the server is a *sync peer*, not an authority the UI waits on. Every UI read is served from the local store. These endpoints exist to converge devices and to host the public QR view.

---

## 1. Identity rules

**All entity IDs are client-generated ULIDs (26-char Crockford base32, string).**
The server never allocates an ID. This is what makes offline creation work: a card written on a boat with no signal has a real, final ID before it ever reaches the server. There is no remapping step and therefore no remapping bug.

Consequences: IDs are strings everywhere in JSON; the client never uses `lastInsertRowid`.

---

## 2. Row metadata

Every mutable row carries:

| Column | Type | Owner | Meaning |
|---|---|---|---|
| `id` | TEXT PK | client | ULID, generated at creation |
| `rev` | INTEGER | server | Version the **author** based this edit on. Client sends it, server increments. `0` on create. |
| `version` | INTEGER | server | Current authoritative version. Increments on every accepted write. |
| `updated_at` | TEXT | server | ISO-8601 UTC, set on accept. Never client-supplied. |
| `updated_by` | TEXT | server | Employee ULID who wrote it. |
| `device_id` | TEXT | server | Which device wrote it. |
| `deleted_at` | TEXT NULL | server | Tombstone timestamp. Deletion is **never** a hard delete while devices may be offline. |

`rev` vs `version` is the whole concurrency story: the client says "I saw version 7 and I am writing version 8". If the server is still at 7, apply. Otherwise conflict.

### Immutable rows
`change_log` and `sync_ops` are append-only and carry only `id` + `seq`. They are never pulled into the local store as entities.

---

## 3. Sync endpoint

### `GET /api/sync/pull?cursor=<seq>&limit=<n>`
Delta. Returns every change since `cursor`.

```json
{
  "changes": [
    { "seq": 1041, "entity": "service_cards", "entity_id": "01J…",
      "op": "upsert", "version": 3, "payload": { … }, "changed_at": "2026-10-02T14:03:11Z" }
  ],
  "cursor": 1041,
  "has_more": false
}
```
`op` ∈ `upsert` | `delete`. For `delete`, `payload` is `null` and only `entity_id`, `seq`, `version` matter.

Client stores the highest `seq` it has applied. Poll interval: on app foreground, on network regain, and every 60s while visible.

### `POST /api/sync/push`
Batch. All-or-nothing at the batch level; each op gets its own result.

```json
{
  "device_id": "01J…",
  "ops": [
    { "op_id": "01J…", "entity": "work_logs", "entity_id": "01J…",
      "op": "upsert", "rev": 0, "payload": { … } }
  ]
}
```

Per-op result:
```json
{ "op_id": "01J…", "result": "applied",  "version": 1, "seq": 1042 }
{ "op_id": "01J…", "result": "applied",  "version": 9, "seq": 1050 }
{ "op_id": "01J…", "result": "conflict", "conflict_id": "01J…", "server_version": 11 }
{ "op_id": "01J…", "result": "rejected", "reason": "unauthorized_role" }
{ "op_id": "01J…", "result": "rejected", "reason": "entity_not_found" }
```

**Batch semantics:** one op failing must not roll back the others. Each is independent and individually idempotent.

### Idempotency
`op_id` is client-generated per mutation attempt and retried unchanged. The server records `(op_id → result)` in `sync_ops` and returns the *original* result on any repeat. A retried push must never double-apply. `op_id` is consumed even for rejections, so a rejected op cannot be replayed into acceptance by a stale retry.

---

## 4. Conflicts

**Trigger:** server `version != op.rev` on an upsert.

**Resolution: keep both. Never silent last-write-wins.** A worker's field notes must never vanish because someone else synced first.

Server behaviour on conflict:
1. Do **not** apply the incoming payload to the entity.
2. Write both versions to `card_conflicts`:

```sql
CREATE TABLE card_conflicts (
  id              TEXT PRIMARY KEY,          -- client-generated ULID
  entity          TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  local_payload   TEXT NOT NULL,             -- what the worker wrote
  server_payload  TEXT NOT NULL,             -- what the server holds
  local_rev       INTEGER NOT NULL,
  server_version  INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',   -- open | resolved
  resolution      TEXT,                      -- kept_local | kept_server | merged
  resolved_payload TEXT,
  detected_at     TEXT NOT NULL,
  resolved_by     TEXT,
  resolved_at     TEXT
);
```

3. Return `result: "conflict"` with the `conflict_id`.

Client behaviour:
- Applies the server's payload (server stays authoritative for the entity itself).
- Surfaces a **"Needs review"** badge on the card.
- The conflict is resolvable in-app: keep mine, keep theirs, or edit-and-merge.
- Resolution is itself a queued write — it can be made offline.

Resolving as `kept_local` re-writes the entity at `server_version + 1`, so it is a normal, convergent write, not a special case.

---

## 5. Change log & garbage collection

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
```

`seq` is the only sync cursor. Never use a timestamp for delta sync — clock skew and identical timestamps break it.

```sql
CREATE TABLE sync_devices (
  device_id   TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  platform    TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  last_cursor INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  revoked_at  TEXT
);
```

**GC rule:** a `change_log` row may be deleted only when `seq < MIN(last_cursor)` across all non-revoked devices, **and** `seq` is older than 90 days. The 90-day floor protects devices that have been dark — including a phone that iOS evicted and the employee has not yet re-synced.

**A returning device with a cursor below the GC floor triggers full rehydrate:** respond to `pull` with a `full_sync: true` flag and a complete entity dump instead of a delta. The client wipes and rebuilds local state. This path must be exercised in testing — it is the one users hit after an iOS eviction.

---

## 6. Reference data

Delivered through the same sync stream, not bundled in the app.

| Entity | Why it is server-owned |
|---|---|
| `products` | Catalogue changes without an app release. |
| `service_item_templates` | Admin-editable labels and pricing. |
| `storage_layout` | Building names, boathouse numbers, slip numbers, rows, columns, storage types. The marina's physical layout changes; the app should not need a release to learn a new building. |
| `checklist_templates` | Fall/Spring/Storage checklist item sets. |
| `employees` | Name, role, active. PIN hashes never leave the server. |

---

## 7. Photos — online only, by decision

`POST /api/photos` (multipart) requires a live connection. There is no photo queue.

This is intentional: phone storage is bounded, and iOS may evict offline app data after ~7 days of disuse, taking queued photos with it.

Client behaviour when offline:
- The camera action is available — a worker must not lose the ability to *look at* a boat.
- The shutter produces a clear, non-dismissible **`Waiting for signal`** state with the count of pending photos and a manual retry. It must not look like a successful save.

---

## 8. Auth

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | PIN → JWT + employee record |
| `GET /api/auth/me` | Validate token, return fresh permissions |

**Offline unlock is entirely client-side and never contacts this server.** It requires a prior successful login plus a local PIN gate. The client caches the permission snapshot; see `architecture.md` §2 for staleness rules and why office/admin actions refuse to queue offline.

PINs are hashed with a per-employee salt. Rate-limit login attempts.

---

## 9. Public customer view

`GET /api/public/card/:token` — **no authentication.** Reached by scanning the QR on the customer's copy of the card.

Serves a deliberately narrow projection: customer name, boat, current status, and the customer's own visible service history. **Never** employee names, internal notes, `other_work`, condition assessments, or invoice line items. A leaked public URL is a real risk; treat this endpoint as a security surface, not a convenience.

---

## 10. Change log — this file is the record

Any change to endpoints, row metadata, conflict semantics, or GC rules lands here **before** code, on both sides. Client and server are written against this document independently; if they disagree, this file is wrong and gets fixed first.