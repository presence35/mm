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
9. **Colour never carries meaning alone.** Every status pairs colour with a label and a second, non-colour signal: a distinct shape for the statuses that have one, and, for card stages, their position along a fixed rail. Nine arbitrary glyphs were not memorisable; a position in a fixed order is.
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
| Stage phases + per-status counts | `domain/cardStatus.js` | Cards list, Card detail |
| Where a customer stands this season | `domain/dockState.js` | People list |
| Appointment legality + shared capacity | `domain/schedule.js` | Schedule board, Card detail |
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
| **Cards** | The work queue, filtered by status, boat, customer. A **Recent** section sits above the list — the cards this worker last opened, on this device. | Open a card |
| **People** | Customers and their boats. | Open a customer |
| **Map** | Where a boat physically is, by storage type. | Locate a slip / row / column |
| **Setup** | Theme, offline state, sync queue, account. | — |
| **Scan** | Camera → new card, or QR customer link. | Scan |

Contextual only, never in navigation: Card detail · New card wizard · New log · **Schedule** · New appointment · Invoice · **Needs review (conflicts)** · Admin (`admin` only) · Customer public view.

**Schedule is contextual, not a sixth destination.** M3 caps a navigation bar at five and we are at the limit, so the schedule board is reached from Cards and from a card, and adopts the Cards destination for navigation highlighting.

**Recents is a section, not a destination.** The same cap keeps it inside Cards: a strip above the list holding the last two cards this worker opened, per worker and per device, gone if the browser clears its storage. It is a shortcut back, not a record — nothing about it is synced.

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

### Appointment
`id`, `card_id`, `boat_id`, `customer_id`, `task_type`, `scheduled_start`, `scheduled_end`, `assigned_employee_id`, `status`, `notes`

`task_type` ∈ `drop_off` | `cleaning` | `repair` | `pickup` | `ramp`

Times are free start/end instants, not fixed slots — a yard works around a tide, not a booking grid. `scheduled_end` is derived from the task's nominal duration but stays editable.

**Capacity is shared, not per-task-type.** `drop_off` and `ramp` consume the same physical resource — the ramp — and a boat dropped off occupies a storage position for its stay. They are therefore one capacity pool, keyed by the overlap window, not five independent calendars. `domain/schedule.js` owns that rule; nothing else decides whether a slot collides.

### Card lifecycle
`intake` → `fall_checklist` → `storage` → `spring_checklist` → `service` → `cleaning` → `ready` → `invoiced` → `archived`

Not every transition is legal from every state. The legal set lives in `domain/cardStatus.js` — one place, per constraint 5.

### Reference data
`products` · `service_item_templates` · `storage_layout` · `checklist_templates` · `employees`

Storage layout is server-owned on purpose: the marina's physical layout changes, and that must not require an app release. See `behaviors-sync.md` §Reference data.

Each storage position carries **imperial** dimensions — `length_ft`, `width_ft`, `height_front_ft`, `height_back_ft` — because the roof slopes and the back of a top spot is shorter than the front. The paper card is imperial and there is no metric toggle; a position's size class is derived from those four numbers, in one place. A position also records its **prior-year occupant**, which is a hint for who is asking for it back, not a reservation.

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

### Appointment — `domain/schedule.js`
```
proposed ──confirm──▶ booked ──start──▶ in_progress ──finish──▶ done
                         │
                         └──cancel──▶ cancelled
```
`proposed` is what `office` writes when a customer asks for a time but has not committed. Capacity is checked on the `booked` transition, not on `proposed`.

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

**Colour** — `surface` · `surfacePage` · `surfaceDim` · `surfaceBright` · `surfaceContainerLowest` · `surfaceContainerLow` · `surfaceContainer` · `surfaceContainerHigh` · `surfaceContainerHighest` · `onSurface` · `onSurfaceVariant` · `outline` · `outlineVariant` · `primary` · `onPrimary` · `primaryContainer` · `onPrimaryContainer` · `secondary` · `onSecondary` · `secondaryContainer` · `onSecondaryContainer` · `tertiary` · `onTertiary` · `error` · `onError` · `errorContainer` · `onErrorContainer` · `scrim` · `inverseSurface` · `inverseOnSurface` · `inversePrimary`

> M3 has no `success` role. The READY and archived card states need one. Define it as a **deliberate extension**, documented here — not smuggled in as a raw green.

**Palettes** — a palette is a hue, its chroma, a tertiary hue and chroma, and how hard the hue tints the neutral family and the page. It never carries lightness: light and dark are the modes' business, so every palette has a version of both and no palette can drag its own contrast out of the shared ramp. `surfacePage` is the page itself — one step below the surfaces that sit on it, and deliberately tinted harder than they are, because the M3 ramp suppresses chroma far too much at 95% lightness for a theme to be visible through it. The theme picker shows each palette's own colours in a mark, and gets them from the palette itself: `ThemeIcon` sets `data-palette` on its own element, so the same tokens are recomputed there. There is no swatch table in the screen — a second copy of five palettes would be wrong the first time a hue was retuned, and the picker would be advertising the old one.

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
| Booking an appointment offline | Refused with a stated reason. Scheduling is an `office`/`admin` action, so it does not queue — two phones booking the one ramp with no signal would both believe they had it. | schedule domain |
| A deployed build never reaches a device | The precached shell hides it: the old worker keeps serving the old `index.html` and the old hashed assets, so every load looks like the previous build. `registerType: 'autoUpdate'` makes a new worker activate and claim open pages at once, and `engines/pwa/update.js` reloads them — held while a form has unsaved work, released when it is saved or abandoned. | PWA |
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
- **Cost:** the app cannot render a fully cold, never-synced first launch. Mitigation: ship a bundled bootstrap snapshot for first run only — the roster (so there is somebody to sign in as), the marina's shape, and the paper card's field sets. Deliberately not sample data: the store invents no customers, boats or cards, because a brand-new device pointed at production would otherwise push them there.

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
- Parts inventory or purchasing
- Bulk operations across cards
- Analytics, dashboards, reporting
- Offline photo upload
- Renaming the domain vocabulary

## Module map

Grows as code lands. Grouped by subsystem; every file with its responsibility; a terse *Note:* flags detail that matters when editing that file.

```
src/
  appVersion.js  — the version string the client shows. Vite injects it from
                   version.js at build time; it carries the commit, so a deploy
                   that only changed code still reads as a different build.
  theme/     tokens.css, global.css, ThemeProvider.jsx
  ui/        Icon, ThemeIcon, ModeIcon, Button, Checkbox, Surface, Chip,
             TextField, Feedback, StateViews, StageStrip, ProgressMeter,
             Collapsible, SlotGrid, ui.css, index.js — stateless,
             token-driven
             *Note:* a list's filter is a panel of chips under the search row,
             not a sheet: several stages can be on at once, and the funnel that
             opens it is solid exactly while any of them is. The field's own
             clear button is the same action as Escape.
             *Note:* ThemeIcon is the one primitive that sets `data-palette` on
             itself, so the palette blocks in tokens.css resolve again inside
             it and each mark is drawn in the colours of the palette it
             advertises. That is why those blocks are `[data-palette='x']` and
             not `:root[data-palette='x']`, and why the derived colour roles
             live under `[data-palette], :root`. ModeIcon deliberately does not
             do this: it answers "which lightness", so it draws in the palette
             currently in use. `theme-grid`/`theme-option` is the tile shape
             both pickers use.
  shell/     RouterProvider.jsx, AppShell.jsx, useWindowClass.js
             *Note:* AppShell.NAV is the only list of destinations. The router
             used to export a second one; nothing imported it, and a new tab had
             to be added in two places.
  engines/
    pwa/     update.js (reloads an open page when a new worker takes over;
             held while a form has unsaved work)
    store/   localStore.js (sync read API over a hydrated projection),
             idb.js (IndexedDB), seed.js, devFixture.js
             *Note:* seed.js holds studio defaults only — the roster, the marina's
             shape, and the paper card's field sets. It deliberately holds no
             sample marina: a cold device queues what the store holds, so invented
             customers, boats or cards would be pushed into the real database.
             devFixture.js is the exception and is development-only: App.jsx
             reaches it through a dead `import.meta.env.DEV` branch, so a build
             has no path to it. It writes one of each stage through localStore's
             own create calls so a laptop has a list to look at, and skips a store
             that already holds cards.
             boat_serials and boat_assignments are entities, not columns on
             `boats`. getStorageShape() reads the marina's buildings, rows,
             columns, boathouses and slips out of the storage_layout reference
             rows, with the shape above as the snapshot for a device that has never
             synced — a new building from the server must not need a release.
    sync/    SyncProvider.jsx (state machine), transport.js (the only module
             that does network I/O)
    auth/    AuthProvider.jsx, permissions.js, permissions.test.js (role matrix + offline-refusal)
    recents.js — the two cards this worker last opened, on this device: two
             entries, keyed by employee so a shared phone does not mix two
             people's lists. A list rather than a scalar only so an older stored
             value is capped instead of discarded. localStorage, not the card
             store, because it is a fact about this phone and must never reach
             the outbox, a push or a conflict.
             Recorded in the router's navigate, the one place that knows a card
             was actually opened. recents.test.js pins the cap, the per-worker
             key and the behaviour on corrupt storage.
    collapseState.js — which sections are open, on this phone. Per phone rather
             than per worker or per card: a section you always open is a fact
             about how you read a card, and a per-card key would grow with every
             work order the marina has ever had. Keys are literals at the
             Collapsible's call site, so the stored set is bounded by the
             sections that exist. No key means no memory, which is what a
             section that only exists while something is true wants.
             collapseState.test.js pins the fallback, the per-key isolation and
             the behaviour on corrupt or unwritable storage.
    media/   photos.js                       — capture, compress, upload
  domain/    cardStatus.js, storageLocation.js, dockState.js, schedule.js,
             conflictDiff.js, photoPick.js — pure, deterministic
             *Note:* storageLocation.js also builds the Map's views —
             groupByStorageType, buildingsToDraw, buildingGrid, boathouseGrid.
             The grid is a rule about position codes, not a layout detail, so
             the list and the grid cannot disagree about who is in Metal 2 row 3.
             It takes the marina's shape as an argument: it never reads the seed.
             A building is drawn the way the shed is stencilled — the letters run
             down the side and the numbers across — while the cell code stays
             "building/row/column", so nothing downstream knows which axis it is
             drawn on.
             cardStatus.js owns activeCardFor — a boat's row opens the card that
             is neither invoiced nor archived, and the owner when there is none.
             dockState.js answers where a customer stands this season — Docked,
             Ashore, Lapsed, None — in one place and with `now` explicit, so the
             People rows, its filter counts and its filter all read one answer.
             photoPick.js answers which photo represents a card — intake first,
             then the newest — because the card header's watermark and any later
             "main picture" flag must not disagree about which image is THE image.
             cardStatus.test.js, storageLocation.test.js, dockState.test.js,
             schedule.test.js, conflictDiff.test.js — beat tests pinning the
             lifecycle, the unrepresentable-combination rule, the label+tone
             pairing and the stage rail (oko ThreatEngineTest pattern), the shared
             ramp/drop-off capacity pool and the season boundary
  features/
    card/    CardDetail.jsx, ConditionEditor.jsx, TaskList.jsx,
             LogComposer.jsx, PhotoStrip.jsx, useCard.js
    boat/    BoatEdit.jsx — a boat's own record: fields, serials, assignments.
             Editing and assigning are office/admin capabilities and refuse
             offline rather than queueing (behaviours-auth.md constraint 5).
    schedule/ ScheduleBoard.jsx, useSchedule.js
    conflicts/useConflicts.js — joins an open conflict to the record it
              belongs to, and decorates it. The comparison itself lives in
              domain/conflictDiff.js, because the store's settled-conflict
              sweep needs the same rule
  screens/   composition only:
             Cards, CardDetail, NewCard, NewBoat, Invoice, People,
             PeopleDetail, Boats, Boat, Map, Setup, Scan, Admin, Conflicts,
             Login, PublicCard, Schedule
             *Note:* NewBoat is the owner→boat flow with no card at its end —
             a boat can be on file before a job is, and inventing a work order
             number and a date in to shorten that flow would put a wrong card
             on file.

version.js — the build's version, derived from the commit: `<pkg>+<count>.<sha>`,
             or package.json when there is no git. Node-only; the client receives
             the same string through Vite's define. Both sides kept their own copy
             of this number before, and neither moved on a push.

server/
  index.js   routes; the only place that knows HTTP
  sync.js    the two protocol implementations: push, pull
  schema.js  DDL generation, both dialects
  entities.js  the entity registry + T(), the single place table names are built
  db/
    driver.js  SQLite and MySQL; dialectDDL and toMySQL live here, and nowhere else
    index.js   createDb, bootstrap, PIN hashing, token signing
  photos.js  upload handling
  legacy/    the one-shot import from the legacy app
    reader.js     parses the INSERT-only export with no database present
    plan.js       ids, FK remapping, metadata — pure, no I/O
    apply.js      inserts rows + change_log entries and verifies, both inside
                  one transaction; verify() checks referential integrity against
                  the database rather than trusting the map
    photos.js     copies image files, and reports any row without one
    import.js     Dry run by default; applies; refuses a second run by a
                  completion marker, not by counting rows
    inspect-db.js reads the result back through pull() and checks the joins
```

`src/features/card/conditionModel.js` holds the rating and note rules as pure
functions. They used to live inside a React hook, which is why a note field that
silently refused to save shipped: nothing could reach them to test. The
invariant is that an entry exists if and only if it has a rating or a note, so an
empty row cannot be constructed and clearing one is never a separate tombstone.

`server/db/index.js` refuses to start on MySQL with a published `APP_SECRET` or a
seeded PIN. It runs on every `createServer`, including one with an injected
database, so the refusal cannot be bypassed and can be tested.

Not built, and out of scope: billing, multi-marina, and anything named under
Non-goals. Paper-card OCR (scanning the physical intake form into a new card)
is the one piece of the old app's feature set with no home yet.

`server/` is the sync peer. It is a peer, not a CRUD API: the client never waits on it, and it never allocates an ID.

## Build order

1. **Foundation** — tokens, theme switching, primitives, shell, router.
2. **Look checkpoint** — Card detail rebuilt end-to-end as the reference screen. **Stop and review.**
3. **Remaining screens**, each with its full state matrix.
4. **Sync engine + backend**, built last against a working local-first client.
5. **Audit** — accessibility pass, M3 self-audit. Any `0` in component semantics, states, or accessibility blocks sign-off.