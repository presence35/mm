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
import { SEED_CARDS, SEED_BOATS, SEED_CUSTOMERS, SEED_STAFF } from './seed.js'

const ENTITY_OF = { cards: 'service_cards', boats: 'boats', customers: 'customers' }

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
]

const childId = {
  received_items: (cardId, item) => `ri-${cardId}-${item}`,
  authorized_work: (cardId, key) => `aw-${cardId}-${key}`,
  condition_assessment: (cardId, area) => `ca-${cardId}-${area}`,
  invoice_items: (cardId, i) => `ii-${cardId}-${i}`,
}

let db = { cards: [], boats: [], customers: [], employees: [], children: {} }

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

/* A cold device with nothing stored gets the seed fixture. This is the
   bootstrap snapshot; after the first sync the server is the truth.

   Memoised on the promise, not on a boolean: Boot and SyncProvider both call
   this on mount, and a flag checked at the top lets two callers through before
   either sets it. That seeded the snapshot twice, queued every row twice, and
   turned the duplicate into a wall of conflicts against our own data. */
export function hydrate() {
  if (hydrated) return Promise.resolve(db)
  if (hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    try {
      const [cards, boats, customers, employees, ...childRows] = await Promise.all([
        idb.all('service_cards'),
        idb.all('boats'),
        idb.all('customers'),
        idb.getReference('employees'),
        ...CHILD_ENTITIES.map((e) => idb.all(e)),
      ])
      const children = Object.fromEntries(CHILD_ENTITIES.map((e, i) => [e, childRows[i]]))

      /* Never empty: see below. */
      const roster = employees.length ? employees : SEED_STAFF

      if (!cards.length && !customers.length) {
        /* Queued, not just stored. A brand-new server has nothing, so this
           snapshot is what creates the marina there. Stored-only, the first
           edit would carry rev 1 against a row the server has never seen and
           be rejected as a conflict instead of an insert. */
        const now = new Date().toISOString()
        const seededChildren = emptyChildren()

        for (const c of SEED_CARDS) {
          const bare = { ...c }
          delete bare.received_items
          delete bare.authorized_work
          delete bare.condition
          delete bare.logs
          delete bare.photos

          await idb.putAndQueue('service_cards', { ...bare, version: 0, updated_at: now })

          for (const item of c.received_items ?? []) {
            const row = { id: childId.received_items(c.id, item), card_id: c.id, item, present: 1, notes: null, version: 0 }
            seededChildren.received_items.push(row)
            await idb.putAndQueue('received_items', row)
          }
          for (const w of c.authorized_work ?? []) {
            const row = {
              id: childId.authorized_work(c.id, w.key), card_id: c.id, service_type: w.key,
              authorized: w.authorized ? 1 : 0, completed: w.completed ? 1 : 0,
              notes: null, completed_by: null, completed_at: null, products_used: '[]', version: 0,
            }
            seededChildren.authorized_work.push(row)
            await idb.putAndQueue('authorized_work', row)
          }
          for (const a of c.condition ?? []) {
            const row = { id: childId.condition_assessment(c.id, a.area), card_id: c.id, area: a.area, rating: a.rating, notes: a.note, version: 0 }
            seededChildren.condition_assessment.push(row)
            await idb.putAndQueue('condition_assessment', row)
          }
          for (const l of c.logs ?? []) {
            const row = {
              id: `wl-${l.id}`, card_id: c.id, employee_id: l.employee_id,
              log_date: l.date, description: l.description, transcription: l.transcription, created_at: now, version: 0,
            }
            seededChildren.work_logs.push(row)
            await idb.putAndQueue('work_logs', row)

            const history = {
              id: `sh-${l.id}`, card_id: c.id, from_status: null, to_status: 'intake',
              employee_id: l.employee_id, changed_at: now, version: 0,
            }
            seededChildren.status_history.push(history)
            await idb.putAndQueue('status_history', history)
          }
        }

        /* Customers and boats only. Children were queued in the loop above;
           queueing them again here put two ops per row in the outbox, and the
           second one arrived as a conflict against the first. */
        await Promise.all([
          ...SEED_CUSTOMERS.map((c) => idb.putAndQueue('customers', { ...c, version: 0, updated_at: now })),
          ...SEED_BOATS.map((b) => idb.putAndQueue('boats', { ...b, version: 0, updated_at: now })),
        ])

        db = {
          cards: SEED_CARDS.map(({ received_items, authorized_work, condition, logs, photos, ...c }) => ({ ...c, version: 0, local_pending: true })),
          boats: SEED_BOATS.map((b) => ({ ...b, version: 0, local_pending: true })),
          customers: SEED_CUSTOMERS.map((c) => ({ ...c, version: 0, local_pending: true })),
          employees: roster.map((e) => ({ ...e, version: 0, local_pending: true })),
          children: seededChildren,
        }
      } else {
        db = { cards, boats, customers, employees: roster, children }
      }
    } catch (e) {
      /* Storage is unavailable — private mode, or a browser that refuses. Say
         so rather than running in a state that looks fine and silently loses
         every write. `degraded` drives a visible warning in Setup. */
      degraded = e?.message ?? 'storage unavailable'
      db = {
        cards: SEED_CARDS,
        boats: SEED_BOATS,
        customers: SEED_CUSTOMERS,
        employees: SEED_STAFF,
        children: emptyChildren(),
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
  db.cards[i] = { ...db.cards[i], ...cardPatch, local_pending: true }
  write('cards', db.cards[i])

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
const LISTS = { service_cards: 'cards', boats: 'boats', customers: 'customers' }

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

export async function resetToSeed() {
  try {
    await idb.wipe()
    await idb.setMeta('cursor', 0)
  } catch {
    /* ignore */
  }
  hydrated = false
  await hydrate()
}

export { idb }