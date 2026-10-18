/*
 * Local store — the synchronous read API every screen goes through.
 *
 * Constraint 1: screens read from here. No screen calls fetch. No screen
 * touches IndexedDB.
 *
 * Reads are synchronous because React renders synchronously, but persistence
 * is IndexedDB. Both are true via a hydrated in-memory projection: boot reads
 * IndexedDB once into `db`, writes update the projection immediately and
 * queue an op in the same transaction. No screen ever awaits storage.
 *
 * Writes always land here first and queue. Nothing in this file talks to a
 * network — the sync engine drains the outbox.
 */

import * as idb from './idb.js'
import { activeCardFor } from '../../domain/cardStatus.js'
import { canBeAssignedWork } from '../auth/permissions.js'
import { SEED_STAFF, SEED_STORAGE_LAYOUT } from './seed.js'

const ENTITY_OF = { cards: 'service_cards', boats: 'boats', customers: 'customers', serials: 'boat_serials', assignments: 'boat_assignments' }

/*
 * Child collections are their own entities, not columns on the card.
 *
 * The card row has no `logs` column, so a log nested inside the card payload
 * was silently discarded by the server — a worker's notes vanished and nothing
 * said so. They are separate tables on both sides.
 *
 * Child ids are derived from the parent and the key, not random: editing the
 * same task twice must update one row, not create two, and a retried sync must
 * land on the same row.
 */
const CHILD_ENTITIES = [
  'received_items',
  'authorized_work',
  'condition_assessment',
  'work_logs',
  'invoice_items',
  'status_history',
  'photos',
]

const childId = {
  received_items: (cardId, item) => `ri-${cardId}-${item}`,
  authorized_work: (cardId, key) => `aw-${cardId}-${key}`,
  condition_assessment: (cardId, area) => `ca-${cardId}-${area}`,
  invoice_items: (cardId, i) => `ii-${cardId}-${i}`,
}

let db = { cards: [], boats: [], serials: [], assignments: [], customers: [], employees: [], storageLayout: [], children: {} }

function emptyChildren() {
  return Object.fromEntries(CHILD_ENTITIES.map((e) => [e, []]))
}
let hydrated = false
let hydratePromise = null
let degraded = null
const listeners = new Set()

function notify() {
  for (const fn of listeners) fn()
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/* ------------------------------------------------------------------ boot */

/* Reads the stored projection into memory. No seeding, no substitute data: a
   store that holds nothing is a device that has never pulled, and every screen
   already has an empty state for that.

   Memoised on the promise, not on a boolean: Boot and SyncProvider both call
   this on mount, and a flag checked at the top lets two callers through before
   either sets it, so the whole read ran twice. */
export function hydrate() {
  if (hydrated) return Promise.resolve(db)
  if (hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    try {
      const [cards, boats, serials, assignments, customers, employees, storageLayout, appointments, ...childRows] = await Promise.all([
        idb.all('service_cards'),
        idb.all('boats'),
        idb.all('boat_serials'),
        idb.all('boat_assignments'),
        idb.all('customers'),
        idb.getReference('employees'),
        idb.getReference('storage_layout'),
        idb.all('appointments'),
        ...CHILD_ENTITIES.map((e) => idb.all(e)),
      ])
      const children = Object.fromEntries(CHILD_ENTITIES.map((e, i) => [e, childRows[i]]))

      /* A device that has never synced has no roster of its own, and you cannot
         sync until you have signed in. One name, the one the server seeds. */
      const roster = employees.length ? employees : SEED_STAFF

      /* Empty is a real answer. A store that holds nothing is a device that has
         never pulled, and an empty list is the truth about it. */
      db = { cards, boats, customers, employees: roster, storageLayout, appointments, serials, assignments, children }
    } catch (e) {
      /* Storage is unavailable — private mode, or a browser that refuses. Say
         so rather than running in a state that looks fine and silently loses
         every write. `degraded` drives a visible warning in Setup. */
      degraded = e?.message ?? 'storage unavailable'
      /* An empty store, not a sample one. Substituting sample data here is what
         made a failed read indistinguishable from a healthy boot — the exact
         bug server/client-staff.test.js was written to prevent. */
      db = {
        cards: [], boats: [], serials: [], assignments: [], customers: [],
        employees: SEED_STAFF, storageLayout: [], appointments: [], children: emptyChildren(),
      }
    }
    hydrated = true
    hydratePromise = null
    notify()
    return db
  })()

  return hydratePromise
}


export async function reload() {
  hydrated = false
  hydratePromise = null
  return hydrate()
}

export function isHydrated() {
  return hydrated
}

/* Non-null when persistence is not working. The UI must say so: silently
   running from memory would lose every write the worker makes. */
export function storageProblem() {
  return degraded
}

/* ----------------------------------------------------------------- reads */

export function listCards() {
  return [...db.cards].sort((a, b) => (String(a.work_order_no) < String(b.work_order_no) ? 1 : -1))
}

export function getCard(id) {
  const card = db.cards.find((c) => c.id === id)
  if (!card) return null
  const boat = db.boats.find((b) => b.id === card.boat_id) ?? null
  const customer = boat ? db.customers.find((c) => c.id === boat.customer_id) ?? null : null
  /* Screens keep seeing `card.logs` and `card.received_items`. Storage keeps
     them as their own entities. The shape a screen uses is a read concern, not
     a storage one. */
  return { card: withChildren(card), boat, customer }
}

function children(entity, cardId) {
  return (db.children[entity] ?? []).filter((r) => r.card_id === cardId)
}

function withChildren(card) {
  return {
    ...card,
    received_items: children('received_items', card.id).map((r) => r.item),
    authorized_work: children('authorized_work', card.id).map((r) => ({
      key: r.service_type,
      authorized: Boolean(r.authorized),
      completed: Boolean(r.completed),
      notes: r.notes,
    })),
    condition: children('condition_assessment', card.id).map((r) => ({ area: r.area, rating: r.rating, note: r.notes })),
    logs: children('work_logs', card.id)
      .slice()
      .sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)))
      .map((r) => ({
        id: r.id,
        employee_id: r.employee_id,
        name: r.name ?? r.employee_id,
        date: r.log_date,
        description: r.description,
        transcription: r.transcription,
      })),
    invoice_items: children('invoice_items', card.id).map((r) => ({
      description: r.description,
      quantity: r.quantity,
      unit_price: r.unit_price,
      total: r.total,
      sort_order: r.sort_order,
    })),
    photos: children('photos', card.id).map((r) => ({
      id: r.id,
      filename: r.filename,
      caption: r.caption,
      photo_type: r.photo_type,
      work_log_id: r.work_log_id,
      uploaded_at: r.uploaded_at,
    })),
  }
}

export function listCustomers() {
  return db.customers
}

/* Active staff, in the order they should be offered at sign-in. Deactivated
     accounts are excluded here rather than at the call sites, so no screen can
     forget. */
export function listStaff() {
  return db.employees.filter((e) => Number(e.active) === 1 && !e.deleted_at)
}

/* Display name for an actor id one of the server's \"changed by\" lines. The
   whole roster, not the active-filtered one: the person who edited a card may
   have been since deactivated, and their name still answers whose edit it was. */
export function staffName(id) {
  return db.employees.find((e) => e.id === id)?.name ?? null
}

/* Who can be given a boat to work on. The role test lives in permissions.js —
   nothing outside that file compares a role string. */
export function listAssignableStaff() {
  return listStaff().filter((e) => canBeAssignedWork(e.role))
}

export function getCustomer(id) {
  return { customer: db.customers.find((c) => c.id === id) ?? null, boats: db.boats.filter((b) => b.customer_id === id) }
}

export function boatsForCustomer(customerId) {
  return db.boats.filter((b) => b.customer_id === customerId)
}

export function cardsForCustomer(customerId) {
  const ids = new Set(boatsForCustomer(customerId).map((b) => b.id))
  return db.cards.filter((c) => ids.has(c.boat_id))
}

export function cardByToken(token) {
  return db.cards.find((c) => c.customer_token === token) ?? null
}

/* ------------------------------------------------------------------ boats */

/* Every boat, with the one card a worker should be sent to.
 *
 * A boat accumulates a card per season, so "the boat's card" is a rule, not a
 * lookup. It is legacy's: the card that is neither invoiced nor archived. When
 * a boat has none — a boat on file that has never been in — the row still
 * exists and points at the owner instead. See domain/cardStatus.js. */
export function listBoats() {
  return [...db.boats]
    .sort((a, b) => String(a.name ?? a.model ?? '').localeCompare(String(b.name ?? b.model ?? '')))
    .map((boat) => ({
      boat,
      customer: db.customers.find((c) => c.id === boat.customer_id) ?? null,
      card: activeCardFor(db.cards.filter((c) => c.boat_id === boat.id)),
    }))
}

export function getBoat(id) {
  const boat = db.boats.find((b) => b.id === id)
  if (!boat) return null
  return {
    boat,
    customer: db.customers.find((c) => c.id === boat.customer_id) ?? null,
    card: activeCardFor(db.cards.filter((c) => c.boat_id === id)),
    serials: db.serials.filter((s) => s.boat_id === id),
    /* Decorated here, once. A screen looking up employee names would be a second
       place that knows how an assignment is joined. */
    assignments: db.assignments
      .filter((a) => a.boat_id === id)
      .map((a) => {
        const employee = db.employees.find((e) => e.id === a.employee_id) ?? null
        return { ...a, employee_name: employee?.name ?? null, employee_initials: employee?.initials ?? null, employee_role: employee?.role ?? null }
      }),
  }
}

/* Server-owned storage positions. Read synchronously like everything else —
   a screen must never await. Hydrated at boot and after a sync reload. */
export function listStorageLayout() {
  return db.storageLayout
}

/* The marina's shape: which buildings exist, how many rows and columns each
 * has, how many boathouses and slips.
 *
 * Server-owned, like the positions — behaviors-sync.md says the app must not
 * need a release to learn about a new building. So the rows win when the server
 * has told us; SEED_STORAGE_LAYOUT is the bootstrap snapshot for a device that
 * has never synced.
 *
 * Dimensions are deliberately absent: a size belongs to a measured position,
 * which the server owns, and no default is better than a guessed size for a spot
 * nobody measured. */
export function getStorageShape() {
  const fromRows = (kind, mapper) => db.storageLayout.filter((r) => r.kind === kind).map(mapper)
  const buildings = fromRows('building', (r) => r.value)
  const rows = fromRows('row', (r) => r.value)
  const cols = fromRows('col', (r) => r.value)
  const boathouses = fromRows('boathouse', (r) => r.value)
  const slips = fromRows('slip', (r) => r.value)
  return {
    buildings: buildings.length ? buildings : SEED_STORAGE_LAYOUT.buildings,
    rows: rows.length ? rows : SEED_STORAGE_LAYOUT.rows,
    cols: cols.length ? cols : SEED_STORAGE_LAYOUT.cols,
    boathouseCount: boathouses.length ? boathouses.length : SEED_STORAGE_LAYOUT.boathouse_count,
    boathouseSlips: slips.length ? slips.length : SEED_STORAGE_LAYOUT.boathouse_slips,
  }
}

/* ----------------------------------------------------------------- schedule */

export function listAppointments({ cardId = null } = {}) {
  return cardId ? db.appointments.filter((a) => a.card_id === cardId) : [...db.appointments]
}

/*
 * Create or update an appointment.
 *
 * This is the write half of scheduling, and it is deliberately NOT reachable
 * offline: the caller refuses before getting here (constraint 15). Nothing in
 * this function queues a booking that a second phone could also make.
 */
export function putAppointment(fields) {
  const existing = fields.id ? db.appointments.find((a) => a.id === fields.id) : null
  const base = existing ?? {
    status: 'proposed',
    notes: null,
    assigned_employee_id: null,
    card_id: null,
    boat_id: null,
    customer_id: null,
    version: 0,
  }
  const row = { ...base, ...fields, id: existing?.id ?? fields.id ?? idb.newId('ap'), local_pending: true }

  db.appointments = existing ? db.appointments.map((a) => (a.id === row.id ? row : a)) : [...db.appointments, row]
  idb.putAndQueue('appointments', row).catch(() => {})
  notify()
  return row
}

/* ----------------------------------------------------------------- writes */

/* Every write: update the projection now, queue the op durably. The UI never
   waits on storage and never on a network. */
async function write(entity, row) {
  const e = ENTITY_OF[entity]
  try {
    await idb.putAndQueue(e, row)
  } catch {
    /* keep the session working even if persistence is unavailable */
  }
  notify()
  return row
}

export function patchCard(id, patch) {
  const i = db.cards.findIndex((c) => c.id === id)
  if (i < 0) return null

  const { received_items, authorized_work, condition, logs, invoice_items, ...cardPatch } = patch

  /* Only queue a card write when a card column actually changed. Adding a log
     entry passes `logs` and nothing else, and this used to queue an unchanged
     card row alongside it — one wasted op per log entry on every device, which
     then arrived at the server with a stale rev and was raised as a conflict
     over content that had not moved. */
  if (Object.keys(cardPatch).length) {
    db.cards[i] = { ...db.cards[i], ...cardPatch, local_pending: true }
    write('cards', db.cards[i])
  }

  if (received_items) queueReceivedItems(id, received_items)
  if (authorized_work) queueAuthorizedWork(id, authorized_work)
  if (condition) queueCondition(id, condition)
  if (logs) queueLogs(id, logs)
  if (invoice_items) queueInvoiceItems(id, invoice_items)

  return getCard(id)?.card ?? db.cards[i]
}

/* Each collection is diffed against what is stored and only the changes are
   queued, so a task ticked twice is one row at version 2 rather than two
   rows fighting each other. */
function upsertChild(entity, row) {
  const list = db.children[entity] ?? (db.children[entity] = [])
  const at = list.findIndex((r) => r.id === row.id)
  const next = { ...(at >= 0 ? list[at] : {}), ...row, local_pending: true }
  if (at >= 0) list[at] = next
  else list.push(next)
  idb.putAndQueue(entity, next).catch(() => {})
  notify()
}

function dropChild(entity, rowId) {
  const list = db.children[entity]
  if (!list) return
  const at = list.findIndex((r) => r.id === rowId)
  if (at < 0) return
  list.splice(at, 1)
  idb.removeAndQueue(entity, rowId).catch(() => {})
  notify()
}

function queueReceivedItems(cardId, items) {
  const wanted = new Set(items)
  for (const row of children('received_items', cardId)) {
    if (!wanted.has(row.item)) dropChild('received_items', row.id)
  }
  for (const item of wanted) {
    upsertChild('received_items', {
      id: childId.received_items(cardId, item),
      card_id: cardId,
      item,
      present: 1,
      notes: null,
    })
  }
}

function queueAuthorizedWork(cardId, work) {
  const wanted = new Map(work.map((w) => [w.key, w]))
  for (const row of children('authorized_work', cardId)) {
    if (!wanted.has(row.service_type)) dropChild('authorized_work', row.id)
  }
  for (const [key, w] of wanted) {
    upsertChild('authorized_work', {
      id: childId.authorized_work(cardId, key),
      card_id: cardId,
      service_type: key,
      authorized: w.authorized ? 1 : 0,
      completed: w.completed ? 1 : 0,
      notes: w.notes ?? null,
    })
  }
}

function queueCondition(cardId, entries) {
  const wanted = new Map(entries.map((e) => [e.area, e]))
  for (const row of children('condition_assessment', cardId)) {
    if (!wanted.has(row.area)) dropChild('condition_assessment', row.id)
  }
  for (const [area, e] of wanted) {
    upsertChild('condition_assessment', {
      id: childId.condition_assessment(cardId, area),
      card_id: cardId,
      area,
      rating: e.rating,
      notes: e.note ?? null,
    })
  }
}

/* Logs are append-only: an existing entry is never rewritten, only added. */
function queueLogs(cardId, logs) {
  const existing = new Set(children('work_logs', cardId).map((r) => r.id))
  for (const l of logs) {
    const id = String(l.id).startsWith('wl-') ? l.id : `wl-${l.id}`
    if (existing.has(id)) continue
    upsertChild('work_logs', {
      id,
      card_id: cardId,
      employee_id: l.employee_id ?? null,
      name: l.name ?? null,
      log_date: l.date ?? new Date().toISOString().slice(0, 10),
      description: l.description,
      transcription: l.transcription ?? null,
      created_at: new Date().toISOString(),
    })
  }
}

function queueInvoiceItems(cardId, items) {
  for (const row of children('invoice_items', cardId)) dropChild('invoice_items', row.id)
  items.forEach((item, index) => {
    const id = childId.invoice_items(cardId, index)
    upsertChild('invoice_items', {
      id,
      card_id: cardId,
      description: item.description ?? '',
      quantity: Number(item.quantity ?? 1),
      unit_price: Number(item.unit_price ?? 0),
      total: Number(item.quantity ?? 0) * Number(item.unit_price ?? 0),
      sort_order: index,
    })
  })
}

export function setAuthorizedWork(id, key, patch) {
  const card = getCard(id)?.card
  if (!card) return null
  const current = card.authorized_work ?? []
  /* Upsert, not map. Mapping only rewrote entries that already existed, so
     authorising a service on a card that had none silently did nothing. */
  const next = current.some((w) => w.key === key)
    ? current.map((w) => (w.key === key ? { ...w, ...patch } : w))
    : [...current, { key, authorized: false, completed: false, notes: null, ...patch }]
  return patchCard(id, { authorized_work: next })
}

export function addLog(id, log) {
  const card = getCard(id)?.card
  if (!card) return null
  return patchCard(id, { logs: [...card.logs, log] })
}

export function toggleCardField(id, field) {
  const card = db.cards.find((c) => c.id === id)
  if (!card) return null
  return patchCard(id, { [field]: !card[field] })
}

export function createCustomer(fields) {
  const row = { ...fields, id: idb.newId('c'), version: 0, local_pending: true }
  db.customers = [...db.customers, row]
  write('customers', row)
  return row
}

export function findDuplicateCustomer({ email, phone }) {
  if (!email && !phone) return null
  return (
    db.customers.find(
      (c) => (email && c.email?.toLowerCase() === email.toLowerCase()) || (phone && c.phone === phone),
    ) ?? null
  )
}

export function createBoat(fields) {
  const row = { ...fields, id: idb.newId('b'), version: 0, local_pending: true }
  db.boats = [...db.boats, row]
  write('boats', row)
  return row
}

/* `undefined` means "leave alone". An explicit `null` clears the field — the
   difference matters for licence plates and lengths, where clearing is a real
   intention and not an omission. */
export function updateBoat(id, patch) {
  const i = db.boats.findIndex((b) => b.id === id)
  if (i < 0) return null
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  db.boats[i] = { ...db.boats[i], ...clean, local_pending: true }
  write('boats', db.boats[i])
  return db.boats[i]
}

/* Serials are replaced wholesale, not merged: the editor edits them as a list,
   and a row the worker deleted has to disappear. Rows are dropped from the
   local projection immediately and the delete is queued like any other write. */
export function setBoatSerials(boatId, serials) {
  const keep = new Set()
  serials.forEach((s) => {
    const row = {
      id: s.id ?? idb.newId('bs'),
      boat_id: boatId,
      type: s.type ?? 'other',
      serial_number: s.serial_number ?? null,
      notes: s.notes ?? null,
      version: Number(s.version ?? 0),
    }
    keep.add(row.id)
    const at = db.serials.findIndex((r) => r.id === row.id)
    const next = { ...row, local_pending: true }
    if (at >= 0) db.serials[at] = next
    else db.serials = [...db.serials, next]
    write('serials', next)
  })

  for (const row of db.serials.filter((r) => r.boat_id === boatId && !keep.has(r.id))) {
    db.serials = db.serials.filter((r) => r.id !== row.id)
    idb.removeAndQueue('boat_serials', row.id).catch(() => {})
    notify()
  }
  return getBoat(boatId)?.serials ?? []
}

/* Assignment is one row per boat-and-person pair, so assigning twice is the
   same assignment. The id is derived from both, which is also what makes a
   retried sync land on one row instead of two. */
export function addAssignment(boatId, employeeId, assignedBy = null) {
  const id = `ba-${boatId}-${employeeId}`
  if (db.assignments.some((a) => a.boat_id === boatId && a.employee_id === employeeId)) return null
  const row = { id, boat_id: boatId, employee_id: employeeId, assigned_by: assignedBy, version: 0, local_pending: true }
  db.assignments = [...db.assignments, row]
  write('assignments', row)
  return row
}

/* The pair is the identity, not the id. Rows that arrived by sync or the
   legacy import carry ids this module never derived, so looking one up by a
   rebuilt id found nothing for exactly the assignments a real database has.
   Remove by pair, using each row's own id. */
export function removeAssignment(boatId, employeeId) {
  const rows = db.assignments.filter((a) => a.boat_id === boatId && a.employee_id === employeeId)
  if (!rows.length) return null
  const ids = new Set(rows.map((a) => a.id))
  db.assignments = db.assignments.filter((a) => !ids.has(a.id))
  for (const id of ids) idb.removeAndQueue('boat_assignments', id).catch(() => {})
  notify()
  return rows[0].id
}

export function nextWorkOrderNo(now) {
  const year = now.getFullYear()
  const max = db.cards
    .filter((c) => String(c.work_order_no).startsWith(`WO-${year}`))
    .reduce((acc, c) => Math.max(acc, Number(String(c.work_order_no).split('-')[1]) || 0), 2400)
  return `WO-${year}${max + 1}`
}

export function createCard(fields) {
  const row = {
    storage_type: null, boathouse_no: null, slip_no: null,
    storage_building: null, storage_row: null, storage_col: null,
    wrap_required: false, unwrap_done: false,
    remarks: null, other_work: null, pickup_delivery: null,
    invoice_number: null, invoice_status: null, tax_rate: 0,
    status: 'intake', is_fake: 0, is_scanned: 0,
    received_items: [], authorized_work: [], condition: [], logs: [], photos: [],
    customer_token: idb.newId('tk'),
    ...fields,
    id: idb.newId('k'),
    version: 0,
    local_pending: true,
  }
  db.cards = [row, ...db.cards]
  write('cards', row)
  return row
}

/* ------------------------------------------------------------------ outbox */

export function pendingWriteCount() {
  return pending.length
}

let pending = []
export function pendingSnapshot() {
  return pending
}

export async function refreshPending() {
  try {
    pending = await idb.pendingOps()
  } catch {
    pending = []
  }
  return pending.length
}

/* After a push or pull the server has the truth again. */
export async function clearPendingFlags() {
  db.cards = db.cards.map((c) => (c.local_pending ? { ...c, local_pending: false } : c))
  notify()
}

/* Generic entity access for the conflict resolver, which deals in whatever
   entity a conflict happened to be on rather than cards specifically. */
const LISTS = {
  service_cards: 'cards',
  boats: 'boats',
  boat_serials: 'serials',
  boat_assignments: 'assignments',
  customers: 'customers',
  appointments: 'appointments',
}

export function getEntity(entity, id) {
  if (CHILD_ENTITIES.includes(entity)) {
    return (db.children[entity] ?? []).find((r) => r.id === id) ?? null
  }
  const list = LISTS[entity]
  if (!list) return null
  return db[list].find((r) => r.id === id) ?? null
}

export async function putEntity(entity, row) {
  if (CHILD_ENTITIES.includes(entity)) {
    const list = db.children[entity] ?? (db.children[entity] = [])
    const at = list.findIndex((r) => r.id === row.id)
    const next = { ...(at >= 0 ? list[at] : {}), ...row, local_pending: true }
    if (at >= 0) list[at] = next
    else list.push(next)
    try {
      await idb.putAndQueue(entity, next)
    } catch {
      /* keep the session usable even if persistence fails */
    }
    notify()
    return next
  }

  const list = LISTS[entity]
  if (!list) return null
  const next = { ...row, local_pending: true }
  db[list] = next.id && !db[list].some((r) => r.id === next.id)
    ? [next, ...db[list]]
    : db[list].map((r) => (r.id === next.id ? next : r))
  try {
    await idb.putAndQueue(entity, next)
  } catch {
    /* keep the session usable even if persistence fails */
  }
  notify()
  return next
}

export { idb }