# Marina Manager — Architecture & Behaviour Contract

**Status:** binding. Deviations require a written amendment here first.
**Supersedes:** everything in `D:\Desktop\marine`. The old project is a *reference for features and screens only*. No legacy data. No legacy imports.

---

## 1. Product

| | |
|---|---|
| **Goal** | Let a marina worker record and progress a boat's service card from intake to invoice, on a phone, in the field, with or without signal. |
| **Primary user** | Mechanic / office staff, standing, one-handed, often gloved or wet. |
| **Primary action** | Advance the card: tick a task, write a log, change status. |
| **Primary device** | Phone. **Desktop is a real second surface**, not a stretched phone — it becomes a list-detail workstation. |
| **Trust model** | The phone holds the truth. The server is a peer that eventually agrees. |

### Non-negotiables

1. Every screen works with **zero network** for read and for data writes.
2. Light **and** dark theme, both first-class.
3. The service card's field set, order and grouping mirror the marina's **paper intake card**. Workers already know that form. Do not "improve" it by removing fields.

---

## 2. Roles

Exactly three. Source of truth: `role` on the employee record.

| Role | Can |
|---|---|
| `admin` | Everything, including employee management, product catalogue, template editing, backup. |
| `office` | Create/edit customers, boats, cards. Build and issue invoices. Cannot manage employees or the catalogue. |
| `mechanic` | Do work on cards: tasks, checklists, condition, logs, photos. Cannot create customers, cannot invoice, cannot edit Setup. |

> The old `constants.js` defined five (`cleaner`, `wrapper`). Those are gone — cleaning and wrapping are *tasks*, not jobs.

**Offline permission staleness.** Cached permissions may be out of date if someone was demoted while a phone was offline. Therefore:
- Permission snapshot is re-validated on every successful reconnect.
- **Admin-only and office-only actions do not queue offline.** They refuse, with a clear reason. Offline queuing is limited to work a `mechanic` could do.

---

## 3. Information architecture

Five top-level destinations. M3 caps a navigation bar at five — we are at the limit, so nothing else may be promoted into it.

| Destination | Contents | Primary action |
|---|---|---|
| **Cards** | The work queue. Filter by status, boat, customer. | Open a card |
| **People** | Customers and their boats. | Open a customer |
| **Map** | Where the boat physically is, by storage type. | Locate a slip/row/col |
| **Setup** | Theme, offline state, sync queue, account. | — |
| **Scan** | Camera → intake card creation, or QR customer link. | Scan |

**Not in navigation**, reached contextually only:
- **Card detail** — the heart of the app
- **New card** — 3-step wizard (customer → boat → card)
- **New log**
- **Invoice**
- **Admin** — behind Setup, `admin` role only
- **Customer public view** — unauthenticated, reached by QR link

### Navigation form by window size

| Width | Navigation | Card detail layout |
|---|---|---|
| Compact (<600) | Navigation bar, bottom | Single column, scroll |
| Medium (600–839) | Navigation rail, left | Single column, wider measure |
| Expanded (840+) | Navigation rail, left | **List-detail**: card list stays visible in a supporting pane |

Wider space must add context or throughput. Stretching a phone layout is a bug, not a breakpoint.

---

## 4. Domain model

Field set transcribed from the paper intake card via the legacy screens. **Keep these names.**

### Customer
`id`, `name`*, `address`, `city`, `postal_code`, `phone`, `email`

*Dedup rule:* email or phone match on create → offer the existing record instead of creating a duplicate.

### Boat
`id`, `customer_id`*, `name`, `motor_type`, `model`, `licence`, `trailer_licence`, `rate_type`, `length_ft`

### BoatSerial
`id`, `boat_id`*, `type`, `serial_number`, `notes` — `type` ∈ `engine` | `hull` | `transmission` | `bellhousing`

### Card — header fields (paper card order)
`id`, `boat_id`*, `season_year`, `work_order_no`, `storage_type`, `date_in`, `date_out`

`storage_type` ∈ `customer_boathouse` | `marina_boathouse` | `storage_building` | `dry_land` | `covered` | `water`

**Location detail is conditional — it is part of the paper card's shape, not optional data:**

| `storage_type` | Shows |
|---|---|
| `customer_boathouse`, `marina_boathouse` | `boathouse_no` (1–8), `slip_no` (1–10) |
| `storage_building` | `storage_building` (Metal 1–4), `storage_row` (1–5), `storage_col` (A–Z) |
| `dry_land`, `covered`, `water` | nothing |

Selecting a different `storage_type` clears the previous type's location fields. Invalid combinations must be unrepresentable, not merely hidden.

### Card — remaining header fields
`wrap_required`, `unwrap_done`, `remarks`, `other_work`, `pickup_delivery`, `invoice_number`, `invoice_status`, `tax_rate`, `status`, `customer_token`, `is_fake`, `is_scanned`

### Card — child collections

| Collection | Purpose |
|---|---|
| `received_items` | Items handed over at intake. 9 known keys: battery, keys, cover, paddles, life_jackets, cushions, gas_cans, tie_ropes, lights |
| `authorized_work` | What the customer approved. 5 known services: oil_change, outdrive_service, tune_up, lower_unit_drain, prop_rebuild. Each: authorized, completed, notes, completed_by, completed_at, products_used |
| `condition_assessment` | Per-area rating. 6 areas: top, hull, upholstery, motor, propeller, lower_unit |
| `checklist_completions` | Fall / Spring / Storage checklists, keyed by type + employee |
| `work_logs` + `parts_used` | Dated notes. Optional OCR transcription. Parts: part_number, description, quantity |
| `photos` | filename, photo_type, caption, gps_lat, gps_lng |
| `invoice_items` | description, quantity, unit_price, total, sort_order |
| `status_history` | from_status, to_status, employee_id, changed_at |

### Card lifecycle
`intake` → `fall_checklist` → `storage` → `spring_checklist` → `service` → `cleaning` → `ready` → `invoiced` → `archived`

Transitions are recorded in `status_history`. Not all transitions are legal from all states; the legal set is enforced in one place.

### Reference data
`products` (catalogue, for autocomplete + pricing), `service_item_templates` (admin-editable labels), `boat_assignments` (who works which boat).

---

## 5. State machines

Sealed. One owner each. **A boolean flag that shadows one of these is a defect.**

### Sync
```
idle ──online──▶ syncing ──ok──▶ synced ──▶ idle
                    │
                    ├──conflict──▶ conflict ──resolve──▶ syncing
                    ├──offline───▶ offline ──online──▶ syncing
                    └──error────▶ error ──retry───────▶ syncing
```
`SyncProvider` owns this. UI reads it. UI never derives connectivity itself.

### Auth
```
anonymous ──pin online──▶ online ──token expired──▶ expired
                              │                         │
                              ├──network lost──▶ unlocked (local pin)
                              └──logout────────▶ anonymous
```
`unlocked` carries a cached permission snapshot with an expiry; `online` re-validates it.

### Card form
`clean` | `editing` | `saving` | `saved` | `failed` — one value, not five flags.

---

## 6. Boundary rules

**An abstraction needs two real implementations. One implementation means no abstraction.**

Justified seams — exactly three:

| Seam | Implementations | Why it earns its keep |
|---|---|---|
| DB driver | SQLite (dev) / MySQL (prod) | Already two, genuinely different SQL. |
| Auth | Online session / offline local PIN | Different flows, different failure modes. |
| Sync transport | Online delta-push / offline outbox-drain | Different code paths, not a flag. |

**Not** seams — plain modules, no interface: local store (IndexedDB is the only option in a browser), router, photo queue, formatting, validation.

Screens are **stateless presentational components**. State, effects and persistence live in the engines above. A screen importing `indexedDB`, `fetch`, or `localStorage` directly is a defect.

---

## 7. Design tokens

Semantic roles only. Screens never contain a literal colour, radius, or duration. Full definitions live in `src/theme/tokens.css`.

**Colour** — `surface` · `surfaceDim` · `surfaceBright` · `surfaceContainerLowest` · `surfaceContainerLow` · `surfaceContainer` · `surfaceContainerHigh` · `surfaceContainerHighest` · `onSurface` · `onSurfaceVariant` · `outline` · `outlineVariant` · `primary` · `onPrimary` · `primaryContainer` · `onPrimaryContainer` · `secondary` · `onSecondary` · `secondaryContainer` · `onSecondaryContainer` · `tertiary` · `onTertiary` · `error` · `onError` · `errorContainer` · `onErrorContainer` · `scrim` · `inverseSurface` · `inverseOnSurface` · `inversePrimary`

> M3 has no `success` role. READY/archived card states need one. Define it as a **deliberate extension**, documented, not smuggled in as a raw green.
> **Colour never carries meaning alone.** Every status also has a label and a distinct shape/pattern.

**Type** — `displayL/M/S` · `headlineL/M/S` · `titleL/M/S` · `bodyL/M/S` · `labelL/M/S`. Fluid via `clamp()`, capped so desktop does not balloon.

**Shape** — `cornerNone/S/M/L/XL/Full`
**Spacing** — `space1`(4) `space2`(8) `space3`(12) `space4`(16) `space5`(24) `space6`(32) `space7`(40) `space8`(48) `space9`(64)
**Elevation** — `level0`…`level5`
**Motion** — `durationShort1-4`, `durationMedium1-4`, `durationLong1-4`; `easingStandard`, `easingEmphasized`, `easingDecelerate`. All gated behind `prefers-reduced-motion`.

---

## 8. States — every screen

A screen missing any of these is incomplete.

| State | Requirement |
|---|---|
| Loading | Skeleton matching final layout. Never a spinner over a blank screen. |
| Empty | Explains what would be here + the action that creates it. |
| Error | Says what failed + a retry that can actually work. |
| Offline | Surfaces pending-write count. Data reads still succeed from local store. |
| Success | Transient confirmation via snackbar; never a blocking dialog. |
| Disabled | Visible, with a reason on long-press/secondary text. |
| Selected | Non-colour indicator. |
| Focus | Visible ring, logical tab order. |

---

## 9. Accessibility — release gate

48dp minimum touch target. Body text 4.5:1, large text and non-text 3:1. Semantic elements, real labels, keyboard operable, screen-reader announced state changes. Text scaling to 200% must not truncate or overlap. Motion respects `prefers-reduced-motion`. Sunlight legibility is a field requirement, not a preference.

---

## 10. Out of scope

Deliberately not built. Adding these needs an amendment.

- Multi-marina / multi-tenant
- Customer-facing accounts, login, or messaging
- Payments, card processing
- Scheduling, appointments, or bay reservation
- Parts inventory or purchasing
- Recurring/bulk operations across cards
- Analytics, dashboards, reporting
- Offline photo upload
- Any renaming of the domain vocabulary

---

## 11. Build order

1. **Foundation** — tokens, theme switching, primitive components, shell, router.
2. **Look checkpoint** — Card detail rebuilt end-to-end as the reference screen. **Stop and review.**
3. **All remaining screens**, each with its full state matrix.
4. **Sync engine + backend**, built last against a working local-first client.
5. **Audit** — accessibility pass, M3 self-audit. Any `0` in component semantics, states, or accessibility blocks sign-off.