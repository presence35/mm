# Roadmap

Items agreed but not built, in the order they came up. Each one lists what is
true today, what the change is, and the questions that still need an answer.

---

## 1. Entering the marina's own measurements (sheds and boathouses)

**Wanted:** somewhere in the app to record what a slot actually is — a shed bay's
size, a boathouse's slip count, a slip's size — instead of the layout being
something nobody can correct from the phone. Raised as "add 'boathouse' to Setup
→ Admin beside Staff / Parts / Labels" (`src/screens/AdminScreen.jsx:24`), and
before that as "we need a way to enter that slot's size".

**Where the numbers live today**

- `storage_layout` reference data on the server (`server/entities.js:120`),
  pulled read-only by the client (`server/reference.js`, `/api/sync/reference`).
  Nothing in the app writes it, so this item needs the first writer: admin-only
  and refusing offline, like Staff (`src/screens/AdminScreen.jsx:11`).
- One row per measured position, `kind: 'position'`, code `Metal 1/2/A` or
  `BH3/S7`, carrying `length_ft`, `width_ft`, `height_front_ft`,
  `height_back_ft`, `prior_year_customer`.
- The shape is declared, not described: `getStorageShape()`
  (`src/engines/store/localStore.js:300`) reads `building`, `row`, `col`,
  `boathouse` and `slip` as **flat lists**, so every shed is rows 1–5 × cols A–Z
  (4 × 5 × 26 = 520 spots) and every boathouse has the same 10 slips.
  `marinaFill` counts capacity from exactly that, so the fullness bar currently
  claims spots the marina may not have.
- A customer's own boathouse is *not* layout data — it is `storage_type:
  customer_boathouse` on the card (`src/domain/storageLocation.js:143`). The
  editor must say so, or people will look for it there.
- `sizeClassFor` / `dimensionSummary` read a position only; with shed- or
  boathouse-level sizes they need a fallback position → parent size.

**Shape of the change (my proposal)**

- One Admin tab for the physical yard, covering buildings and boathouses
  together, because it is the same question twice.
- A list of the marina's sheds and boathouses; tap one to set how many rows and
  columns (or slips) it has and the size of one bay: length, width, height
  front/back. One entry per shed or boathouse, not per slot.
- An individual slot or slip can override its parent later, for the odd top row
  with the sloped roof or the one wider bay. Not in this change.
- Removing a shed, boathouse or slot that has a boat recorded in it is refused,
  naming the boats rather than orphaning them on the map.
- Beta, so the shape rows are rewritten rather than migrated: a per-boathouse
  count and bay size on the boathouse row, and per-shed rows/columns and bay
  size on the building row.

**Docs to amend in the same change:** `docs/behaviors-sync.md:196` (it
enumerates the five shape kinds plus `position`), and the module map entries for
`storageLocation.js` / `localStore.js` in `docs/architecture.md`.

**Open questions**

1. One tab for sheds and boathouses together, or Boathouse alone for now?
   *Leaning: one tab.*
2. Same bay size for every slip in a boathouse? *Leaning: yes.*
3. Same slip count in every boathouse (10 today), or per boathouse?
4. Boathouses numbered 1–8 as the codes `BH3/S7` already assume, or named?
5. Do the measurements exist on paper, or does it mean walking the dock with a
   tape? Decides whether this ships now or the tab stays read-only for a while.
6. Removing a boathouse or slip with a boat in it: refuse and name the boats, or
   allow it and flag the orphans? *Leaning: refuse.*

**Already done, from the same thread:** the Map's List view no longer prints a
"No size" pill and "No dimensions recorded" for a position the layout does not
describe — the whole line collapses when there is nothing to say
(`src/screens/MapScreen.jsx:287`).

---

## 2. Assignment: who is on this boat

**Wanted:** "assigned to is lazy. the mechanic should have better 'im assigned'
than just the button text."

**Where it stands today**

- The whole truth lives in one place: `BoatEdit.jsx:254` lists every assignable
  mechanic, each row carrying a button that flips its own label to "Unassign".
  Nothing else in the app shows an assignment — not the Boats list, the Map, or
  the card — and the signed-in mechanic's name sits in that list looking like
  every other row. So "am I on this?" is answered by reading button labels.
- Assignment is a boat-and-person table, many per boat
  (`localStore.addAssignment`, `localStore.removeAssignment`), syncable and
  already written locally with `local_pending: true`.
- `cards.assigned_employee_id` exists in the schema
  (`src/engines/store/localStore.js:334`) but nothing reads or writes it.
  Decision: assignment stays on the boat; delete the dead column.

**Shape of the change**

1. In the boat screen's section: the assigned people are checked rows, the
   signed-in one reading "You", the heading counting them (`Assigned to · 2`),
   and the row itself the toggle — so the state reads without reading a label.
2. Off the boat screen: a pill on the rows that already carry one (Boats, Map
   list, card detail) reading `You` or `Assigned 2`, keeping the label + shape +
   tone discipline rather than colour alone.
3. A mechanic's own claim: see the open question below — this is the part that
   decides what (1) even means.

**Open questions**

1. Can a mechanic claim a job themselves? `ASSIGN_BOAT` is office/admin and
   refuses offline (`src/engines/auth/permissions.js:13`), yet the rows are
   already local-first. If a mechanic in a shed with no signal taps "I'm on
   this", that is a permission change, a queueable write, and a rule for two
   phones claiming the same boat. If mechanics may only read their assignment,
   the section stays office/admin furniture and (2) carries all the weight.
