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

---

## 3. The boat's own picture

**Wanted:** "maybe in boat edit you get to add 1 pic, distinct from every service
card."

**Where it stands today**

- Every photo hangs off a service card (`photos.card_id`, `server/photos.js:22`),
  so a boat's picture is whichever card happens to hold it, and it is lost from
  view the moment that card is old. `domain/photoPick.js` answers "which photo
  represents this card" — intake first, then the newest — and the card header
  draws it faintly behind its opening lines (`.card-head__photo`, `ui.css`).
- Nothing in the schema represents the boat itself: `boats` has no photo column
  and `photos` has no `boat_id`.
- The upload path already refuses offline and stores through one function
  (`storePhoto`), which is the whole reason a boat photo is a small change
  rather than a second photo system.

**Shape of the change (my proposal)**

- A `boat_id` on `photos` (null for a card photo), so one table, one upload
  path, one strip of code that fetches bytes. Beta: the column is added, not
  migrated.
- Boat edit gets the one row: **Boat photo** — the current picture, or "Add
  photo"/"Replace", with the same online-only rule and the same blocked reason
  as every other photo.
- The card header prefers the boat's photo and falls back to the card's intake
  shot, so `photoPick.js` gains one rule rather than the header gaining a special
  case.
- Replacing keeps the old row as a tombstone (never a hard delete) so other
  devices drop it by delta.

**Open questions**

1. One picture per boat, or a small set with one flagged as the main one?
   *Leaning: one — "add 1 pic" is the ask, and a set re-opens the flagging
   question.*
2. Who may set it — office/admin only, or the mechanic who has the boat in front
   of them? *Leaning: anyone who can work on the card, because the person who
   knows what the boat looks like is the one standing next to it.*
3. Does it follow the boat across seasons? *Leaning: yes. It is the boat, not the
   card.*
4. What does the card header draw when a boat photo and an intake shot both
   exist — the boat's picture, or this season's intake shot? *Leaning: the
   intake shot while the card is open, the boat photo otherwise.*

---

## 4. Storage prep and wrap

**Wanted:** "storage prep wrap UX needs work." Named, not yet described — this
section is a placeholder so the complaint is not lost, and it deliberately
proposes nothing until someone who does the work says which part is slow.

**Where it stands today**

- A card already says where the boat goes: `storage_type`
  (`domain/storageLocation.js:11`, six types) and a slot in the marina's own
  layout (`ui/SlotGrid.jsx`), drawn per boathouse by `screens/MapScreen.jsx`.
- Neither the card nor the map shows the *season pass* of a boat — still in the
  water, hauled, wrapped, slotted — so the yard's real state only exists in the
  workers' heads. That is the part that reads as broken.
- Nothing here needs a new store: every fact is a read over card rows that
  already exist. It is a derivation plus a screen, which is why it is cheap to
  fix once the shape is agreed.

**Open questions**

1. Is prep a checklist on one card, or a board across the whole yard? *Leaning:
   a board — "where does this boat go" is decided while looking at the yard.*
2. Is "wrapped" a stage, a task, or a storage type? *Leaning: a task. Stages are
   the service lifecycle; wrapping is a job, and it happens to a boat in any
   stage.*
3. Who marks a boat slotted — the worker on the dock, or the office when the
   paper comes back? *Leaning: the worker, offline, because that is where the
   boat actually lands.*


---

## 5. Writing expectations into the system (task checklists + end-of-day reminders)

**Wanted:** "What about the idea of writing expectations into the system." Example given: shrink wrapping is a standard process - put up the wood to support the plastic, tie it down with string, add a package of desiccant called No Damp, cover it with plastic, heat the plastic, add ventilation, write the name on the boat, make sure the sticker is attached - then it gets passed on to the person who will store the boat. This can be a checklist, with a notification to the employee ~2 hours after the process begins asking whether all tasks are done, and an end-of-day notification reminding them to check off everything before going home.

**Where it stands today**

- Nothing in the app represents a *process* or *checklist* at all. Tasks are implicit in the service card's status lifecycle and in worker habit. There is no concept of a named procedure with ordered steps, no per-boat completion record, and no notification system of any kind (no push, no in-app reminder, no scheduled job).
- The closest existing concept is the storage-prep/wrap item above (section 4): wrap is currently modelled as an informal task, and the yard's real state lives in workers' heads. This item is the generalisation of that - any repeated procedure becomes a checklist instead of a memory.
- Cards already carry `storage_type` and a slot, and assignment already exists as a boat-and-person table (`localStore.addAssignment`), so "who is doing this boat" is answerable. What is missing is "what steps remain on this boat."
- Offline is the default; notifications that fire on a timer need a decision about whether they are local (device clock) or server-driven, and whether they survive a phone that is asleep or has no signal.

**Shape of the change (my proposal)**

- A named, ordered **checklist template** per procedure (e.g. "Shrink wrap"), with steps. Admin/office authors templates; mechanics never do. Templates are reference data, syncable read-only like `storage_layout`.
- A checklist instance attaches to a card (or a boat) when the work starts, with each step carrying its own done/not-done state and a timestamp + who. One active instance per card at a time; re-running creates a new instance rather than overwriting, so history survives.
- Step completion is offline-capable and local-first, same as card edits: write locally with `local_pending`, sync later. Office/admin refusal rules do not apply to a mechanic ticking their own steps.
- Two reminders, both optional and per-user opt-in:
  1. A "still in progress?" nudge ~2 hours after the instance was started, if not all steps are done.
  2. An end-of-day nudge listing the user's cards/instances with unchecked steps, so nothing goes home unfinished.
- Reminders are **local-first and best-effort**: fire from the device clock while the app is open/foregrounded; no server push, no background service, no guarantee if the phone is off. (A server-driven option is a separate, later item - see open questions.)
- The wrap item (section 4) is the first consumer: its eight steps become the first template, and "wrapped" stops being a guessed state and becomes "all steps of the wrap checklist done."

**Open questions**

1. Scope of a checklist - per card, per boat, or per yard task with no card? The example is per boat but the idea ("expectations into the system") is broader. *Leaning: per card first; boat-level and yard-level later if wanted.*
2. Who authors templates - admin only, or office too? *Leaning: admin authors, office can attach an existing template to a card.*
3. Can a mechanic start a checklist themselves, or only office/admin? The wrap happens on the dock, so a mechanic starting it offline is the realistic case. *Leaning: mechanic can start and tick; only admin/office edit templates.*
4. Reminders: local device clock (works offline, dies when app closed) vs. server-scheduled push (survives, needs connectivity + a push channel we do not have). *Leaning: local-first and best-effort now; revisit if people miss them.*
5. End-of-day cutoff - fixed time (e.g. 16:30), or "last activity + N"? And timezone: the marina's, not the device's? *Leaning: marina-local fixed time, configured once.*
6. What counts as "done" for a step - a single tap, or tap + optional note/photo? *Leaning: single tap; notes/photos are a later embellishment, and photos already have their own online-only path.*
7. Does an incomplete checklist block anything (e.g. marking the card complete, or the boat moving to a slot)? *Leaning: no - it informs, it does not gate. Gating turns a reminder into a blocker and people work around it.*
8. Retention: how long do completed instances stay? They are history, but they accumulate. *Leaning: keep for the season, GC with the card.*
9. Is this the same item as section 4 or separate? It subsumes the "wrap as a task" question there; section 4's board question ("prep as checklist on one card vs. board across the yard") is the same decision as this item's scope question. *Leaning: merge - section 4 becomes the first screen built on top of this, not a parallel item.*

**Not in scope (deliberately):** server push notifications, background services, photo attachments on steps, gating card completion on checklist completion, per-step assignees, and any analytics/reporting on completion rates. Add them only when asked.
