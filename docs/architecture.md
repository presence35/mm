# Marina Manager — Architecture

Technical map and binding contract. Read this first so you can jump straight to the file you need instead of re-deriving the structure.

**Status:** binding. Deviations require a written amendment here first.
**Supersedes:** everything in `D:\Desktop\marine`. That project is a *reference for features and screens only*. No legacy data, no legacy imports.

| Document | Read it when |
|---|---|
| `docs/architecture.md` (this file) | Before any work. Structure, ownership, rules. |
| `docs/behaviors-sync.md` | Before any sync, store, or persistence work. |
| `docs/behaviors-auth.md` | Before any auth, login, offline-unlock, or role work. |
| `docs/behaviors-public-view.md` | Before touching the unauthenticated QR card endpoint. |

## Quick facts

- Single Vite + React app, installable PWA. Primary device is a **phone in the field**; desktop is a real second surface (list-detail), never a stretched phone.
- **Local-first.** The phone holds the truth; the server is a peer that eventually agrees. Offline is the default assumption, not an error path.
- Material Design 3, semantic tokens, **light and dark both first-class**.
- Three roles: `admin`, `office`, `mechanic`.
- Service card fields mirror the marina's **paper intake card**. Workers already know that form.
- Backend: Express + MySQL on GoDaddy. SQLite for local dev.

## Non-Negotiable Constraints

Treat these as a contract. If you change one, update **every** place that relies on it.

1. **Local-first, not local-optional.** Every screen serves reads and data writes from the local store. `fetch` is never on the critical path of a screen render. A component that renders `null` while a network call is in flight is a defect.
2. **Screens are stateless.** A screen importing `fetch`, `indexedDB`, or `localStorage` is a defect. State, effects and persistence live in engines.
3. **Two real implementations or no interface.** One implementation means a plain module, not a port. See [Boundary rules](#boundary-rules).
4. **One sealed state machine per concern, one owner.** `isLoading` sitting next to `isEditing` is a defect. `architecture.md` §State machines is the list.
5. **No mirror rule.** A derived fact — card status, card summary, next legal status — is computed in exactly one place. `CardsScreen` and `CardDetail` must not each derive it. One call site, no duplicated logic in any consumer.
6. **Explicit `now` parameter.** Every time-dependent function takes the current time as a parameter and never calls `Date.now()` internally. Staleness, the 30-day retention window, cursor GC, conflict age and token expiry are all time-dependent, and none of them are testable otherwise.
7. **Pure and deterministic cores.** Engine functions take explicit inputs, hold no hidden state, and produce the same output for the same input. Side effects live outside them.
8. **Semantic tokens only.** A literal hex, radius, shadow or duration inside a screen is a defect.
9. **Colour never carries meaning alone.** Every status pairs colour with a label and a distinct shape or pattern.
10. **Light and dark are both first-class.** Never ship one as an afterthought or derive one from the other by inversion.
11. **Paper card fields are frozen.** Do not remove, rename, or reorder fields because they look redundant. Workers know the paper form.
12. **No invalid combinations.** A `storage_type` and a location detail that disagree must be unrepresentable, not merely hidden.
13. **No silent data loss.** Conflicts preserve both versions. A retry never double-applies. Nothing is silently discarded.
14. **Photos need signal.** Data queues; photos do not. Do not "improve" this with an offline photo queue.
15. **Office and admin actions do not queue offline.** They refuse with a stated reason.
16. **Backwards compatibility is not a concern.** We are in beta. Write the correct schema, not a migration.

## Core ownership

| Concern | Source of truth | Consumers |
|---|---|---|
| Persistence | local store module | engines |
| Sync protocol + conflict detection | sync engine | all screens (via sync provider) |
| Sync cursor, outbox, connectivity | `SyncProvider` | UI, badge counts |
| Auth session, permission snapshot | auth engine | all screens (via auth provider) |
| Roles and capability checks | `auth/permissions.js` | every gated action |
| Card status + legal transitions | `domain/cardStatus.js` | Cards list, Card detail, Map, public view |
| Storage layout (buildings, slips, rows) | server reference data | card wizard, Map, filters |
| Checklist + cleaning item sets | server reference data | Card detail |
| Product catalogue | server reference data | log composer, invoice builder |
| Design tokens | `src/theme/tokens.css` | everything |
| UI primitives | `src/ui/` | every screen |

## Roles

Exactly three.

| Role | Can |
|---|---|
| `admin` | Everything: employees, catalogue, templates, backup. |
| `office` | Create/edit customers, boats, cards. Build and issue invoices. No employees, no catalogue. |
| `mechanic` | Work on cards: tasks, checklists, condition, logs, photos. No customer creation, no invoicing, no Setup. |

The old `constants.js` defined five (`cleaner`, `wrapper`). Those are gone — cleaning and wrapping are *tasks on a card*, not jobs someone holds.

## Information architecture

Five top-level destinations. M3 caps a navigation bar at five; we are at the limit, so nothing else is promoted into it.

| Destination | Contents | Primary action |
|---|---|---|
| **Cards** | The work queue, filtered by status, boat, customer. | Open a card |
| **People** | Customers and their boats. | Open a customer |
| **Map** | Where a boat physically is, by storage type. | Locate a slip / row / column |
| **Setup** | Theme, offline state, sync queue, account. | — |
| **Scan** | Camera → new card, or QR customer link. | Scan |

Contextual only, never in navigation: Card detail · New card wizard · New log · Invoice · **Needs review (conflicts)** · Admin (`admin` only) · Customer public view.

### Navigation by window size

| Width | Navigation | Card detail |
|---|---|---|
| Compact (<600) | Navigation bar, bottom | Single column, scroll |
| Medium (600–839) | Navigation rail, left | Single column, wider measure |
| Expanded (840+) | Navigation rail, left | **List-detail** — card list stays in a supporting pane |

Wider space must add context or throughput. Stretching a phone layout is a bug, not a breakpoint.

## Domain model

Field set transcribed from the paper intake card via the legacy screens. **Keep these names.**

### Customer
`id`, `name`*, `address`, `city`, `postal_code`, `phone`, `email`

*Dedup:* email or phone match on create offers the existing record instead of creating a duplicate.

### Boat
`id`, `customer_id`*, `name`, `motor_type`, `model`, `licence`, `trailer_licence`, `rate_type`, `length_ft`

### BoatSerial
`id`, `boat_id`*, `type`, `serial_number`, `notes` — `type` ∈ `engine` | `hull` | `transmission` | `bellhousing`

### Card — header fields, in paper-card order
`id`, `boat_id`*, `season_year`, `work_order_no`, `storage_type`, `date_in`, `date_out`

`storage_type` ∈ `customer_boathouse` | `marina_boathouse` | `storage_building` | `dry_land` | `covered` | `water`

**Location detail is conditional — it is part of the paper card's shape, not optional data.** See constraint 12.

| `storage_type` | Shows |
|---|---|
| `customer_boathouse`, `marina_boathouse` | `boathouse_no` (1–8), `slip_no` (1–10) |
| `storage_building` | `storage_building`, `storage_row`, `storage_col` |
| `dry_land`, `covered`, `water` | nothing |

Selecting a different `storage_type` clears the previous type's location fields.

### Card — remaining header fields
`wrap_required`, `unwrap_done`, `remarks`, `other_work`, `pickup_delivery`, `invoice_number`, `invoice_status`, `tax_rate`, `status`, `customer_token`, `is_fake`, `is_scanned`

### Card — child collections

| Collection | Purpose |
|---|---|
| `received_items` | Items handed over at intake. 9 keys: battery, keys, cover, paddles, life_jackets, cushions, gas_cans, tie_ropes, lights |
| `authorized_work` | Customer-approved work. 5 services: oil_change, outdrive_service, tune_up, lower_unit_drain, prop_rebuild. Each: authorized, completed, notes, completed_by, completed_at, products_used |
| `condition_assessment` | Per-area rating. 6 areas: top, hull, upholstery, motor, propeller, lower_unit |
| `checklist_completions` | Fall / Spring / Storage checklists, keyed by type + employee |
| `work_logs` + `parts_used` | Dated notes, optional OCR transcription. Parts: part_number, description, quantity |
| `photos` | filename, photo_type, caption, gps_lat, gps_lng |
| `invoice_items` | description, quantity, unit_price, total, sort_order |
| `status_history` | from_status, to_status, employee_id, changed_at |

### Card lifecycle
`intake` → `fall_checklist` → `storage` → `spring_checklist` → `service` → `cleaning` → `ready` → `invoiced` → `archived`

Not every transition is legal from every state. The legal set lives in `domain/cardStatus.js` — one place, per constraint 5.

### Reference data
`products` · `service_item_templates` · `storage_layout` · `checklist_templates` · `employees`

Storage layout is server-owned on purpose: the marina's physical layout changes, and that must not require an app release. See `behaviors-sync.md` §Reference data.

## State machines

Sealed. One owner each. See constraint 4.

### Sync — `SyncProvider`
```
idle ──online──▶ syncing ──ok──▶ synced ──▶ idle
                    │
                    ├──conflict──▶ conflict ──resolve──▶ syncing
                    ├──offline───▶ offline ──online──▶ syncing
                    └──error────▶ error ──retry───────▶ syncing
```

### Auth — `AuthProvider`
```
anonymous ──pin online──▶ online ──token expired──▶ expired
                              │                         │
                              ├──network lost──▶ unlocked (local pin)
                              └──logout────────▶ anonymous
```
`unlocked` carries a cached permission snapshot with an expiry; `online` re-validates it. See `behaviors-auth.md`.

### Card form
`clean` | `editing` | `saving` | `saved` | `failed` — one value, not five flags.

## Boundary rules

**Two real implementations or no interface.** One implementation means a plain module.

Justified seams — exactly three:

| Seam | Implementations | Why |
|---|---|---|
| DB driver | SQLite (dev) / MySQL (prod) | Already two, genuinely different SQL. |
| Auth | Online session / offline local PIN | Different flows, different failure modes. |
| Sync transport | Online delta-push / offline outbox-drain | Different code paths, not a flag. |

**Not** seams — plain modules: local store (IndexedDB is the only option in a browser), router, photo queue, formatting, validation.

## Design tokens

Semantic roles only, defined in `src/theme/tokens.css`. No literal values in screens.

**Colour** — `surface` · `surfaceDim` · `surfaceBright` · `surfaceContainerLowest` · `surfaceContainerLow` · `surfaceContainer` · `surfaceContainerHigh` · `surfaceContainerHighest` · `onSurface` · `onSurfaceVariant` · `outline` · `outlineVariant` · `primary` · `onPrimary` · `primaryContainer` · `onPrimaryContainer` · `secondary` · `onSecondary` · `secondaryContainer` · `onSecondaryContainer` · `tertiary` · `onTertiary` · `error` · `onError` · `errorContainer` · `onErrorContainer` · `scrim` · `inverseSurface` · `inverseOnSurface` · `inversePrimary`

> M3 has no `success` role. The READY and archived card states need one. Define it as a **deliberate extension**, documented here — not smuggled in as a raw green.

**Type** — `displayL/M/S` · `headlineL/M/S` · `titleL/M/S` · `bodyL/M/S` · `labelL/M/S`. Fluid via `clamp()`, capped so desktop does not balloon.

**Shape** — `cornerNone/S/M/L/XL/Full`
**Spacing** — `space1`(4) `space2`(8) `space3`(12) `space4`(16) `space5`(24) `space6`(32) `space7`(40) `space8`(48) `space9`(64)
**Elevation** — `level0`…`level5`
**Motion** — `durationShort1-4`, `durationMedium1-4`, `durationLong1-4`; `easingStandard`, `easingEmphasized`, `easingDecelerate`. All gated behind `prefers-reduced-motion`.

## States — every screen

A screen missing any of these is incomplete.

| State | Requirement |
|---|---|
| Loading | Skeleton matching final layout. Never a spinner over a blank screen. |
| Empty | Explains what would be here, plus the action that creates it. |
| Error | Says what failed, plus a retry that can actually work. |
| Offline | Surfaces the pending-write count. Reads still succeed from local store. |
| Success | Transient snackbar. Never a blocking dialog. |
| Disabled | Visible, with a reason available. |
| Selected | Non-colour indicator. |
| Focus | Visible ring, logical tab order. |

## Failure modes

| Failure | Behaviour | Owner |
|---|---|---|
| No signal at the dock | All reads serve from local store. Data writes queue. Offline badge shows pending count. | sync engine |
| Photo taken offline | Clear non-dismissible **Waiting for signal** state with pending count and manual retry. Must not look like a saved photo. | photo queue |
| Phone storage full | Write is refused at the point of entry, naming the free space needed. Never a silent failure at sync time. | local store |
| Token expires mid-shift | Falls to `unlocked` if a cached session exists, else `expired` with a stated reason. Work in progress stays queued, not lost. | auth engine |
| iOS evicts offline data | On next launch the client detects an empty store with a stale cursor and requests a full rehydrate. | sync engine |
| Cursor below the GC floor | Server answers with `full_sync: true` and a complete dump. Client wipes and rebuilds. | sync engine |
| Conflict on reconnect | Both versions preserved, card badged **Needs review**, resolvable in-app and offline. | sync engine |
| Sync never converges | After N failed attempts the engine enters `error` and stops retrying on a timer. Setup shows the reason and a manual retry. | sync engine |
| Two devices, one account | Both sync independently. Last write to *different* fields converges. Same field raises a conflict. `office`/`admin` actions refuse offline, so the risky case cannot occur offline. | sync engine |
| Phone clock is wrong | Sync cursors are server monotonic `seq`, never client time. `updated_at` is server-set. A wrong phone clock cannot corrupt ordering. | sync engine |
| Public QR link leaked | `behaviors-public-view.md` defines a narrow field projection. This is a security surface, not a convenience. | public endpoint |

## Deliberate tradeoffs / risks

### Phone holds the truth, not the server
- **Why:** the primary use case happens on a boat with no signal. A server-authoritative design would make the app unusable exactly where it matters.
- **Mitigation:** every entity is a ULID allocated client-side, so an offline write needs no server round-trip and no ID remapping. Conflicts are visible and manually resolved rather than auto-merged, which trades convenience for the guarantee that no one's field notes vanish.
- **Cost:** the backend is a sync peer, not a CRUD API. More server code than a normal app needs.

### Photos are online-only
- **Why:** phone storage is bounded and iOS may evict offline app data after ~7 days of disuse, taking queued photos with it.
- **Mitigation:** a blocked, explicit state instead of a silent queue. Data still queues.
- **Cost:** a worker who photographs damage with no signal must re-shoot later. Accepted deliberately.

### Office and admin actions refuse offline
- **Why:** cached permissions can be stale — someone may have been demoted while the phone was dark. Queuing an invoicing action under stale permissions is the worst case in the app.
- **Mitigation:** permission snapshot re-validated on every reconnect; permission-gated actions blocked offline with a reason.
- **Cost:** an admin cannot invoice from a dead spot.

### MySQL retained rather than SQLite
- **Why:** GoDaddy redeploys can wipe local files, taking a SQLite database with them.
- **Cost:** SQL dialect differences between dev and prod. Contained behind the one justified DB seam.

### Reference data is server-owned
- **Why:** storage layout and checklists change physically, not on a release schedule.
- **Cost:** the app cannot render a fully cold, never-synced first launch. Mitigation: ship a bundled bootstrap snapshot for first run only.

### Conflicts resolve offline
- **Why:** a worker who spots a conflict in the yard should not have to find signal to settle it.
- **Cost:** a conflict resolution is itself a queued write and can itself conflict. Accepted — it converges the same way.

## Security surfaces

`GET /api/public/card/:token` is unauthenticated by design. Its field projection, brute-force surface and cache headers are specified in `docs/behaviors-public-view.md`. Read that file before changing anything it serves.

PIN hashes never leave the server. Photo filenames are not customer-supplied.

## Accessibility — release gate

48px minimum touch target. Body text 4.5:1; large text and non-text 3:1. Semantic elements, real labels, keyboard operable, screen-reader-announced state changes. Text scaling to 200% must not truncate or overlap. Motion respects `prefers-reduced-motion`. Sunlight legibility is a field requirement, not a preference.

## Out of scope

Adding any of these requires an amendment here first.

- Multi-marina / multi-tenant
- Customer accounts, login, or messaging
- Payments, card processing
- Scheduling, appointments, bay reservation
- Parts inventory or purchasing
- Bulk operations across cards
- Analytics, dashboards, reporting
- Offline photo upload
- Renaming the domain vocabulary

## Module map

Grows as code lands. Grouped by subsystem; every file with its responsibility; a terse *Note:* flags detail that matters when editing that file.

```
src/
  theme/     tokens.css, global.css, ThemeProvider.jsx
  ui/        Icon, Button, Surface, Chip, TextField, Feedback, StateViews,
             ui.css, index.js               — stateless, token-driven
  shell/     RouterProvider.jsx, AppShell.jsx, useWindowClass.js
  engines/
    store/   localStore.js (sync read API over a hydrated projection),
             idb.js (IndexedDB), seed.js
    sync/    SyncProvider.jsx (state machine), transport.js (the only module
             that does network I/O)
    auth/    AuthProvider.jsx, permissions.js
  domain/    cardStatus.js, storageLocation.js — pure, deterministic
  features/
    card/    CardDetail.jsx, ConditionEditor.jsx, TaskList.jsx,
             LogComposer.jsx, PhotoStrip.jsx, useCard.js
  screens/   composition only:
             Cards, CardDetail, NewCard, Invoice, People, PeopleDetail,
             Map, Setup, Scan, Admin, Conflicts, Login, PublicCard
```

Not yet built: `engines/media/` (photo capture, HEIC, OCR), and the billing/multi-marina surfaces that are out of scope entirely.

`server/` is the sync peer. It is a peer, not a CRUD API: the client never waits on it, and it never allocates an ID.

## Build order

1. **Foundation** — tokens, theme switching, primitives, shell, router.
2. **Look checkpoint** — Card detail rebuilt end-to-end as the reference screen. **Stop and review.**
3. **Remaining screens**, each with its full state matrix.
4. **Sync engine + backend**, built last against a working local-first client.
5. **Audit** — accessibility pass, M3 self-audit. Any `0` in component semantics, states, or accessibility blocks sign-off.