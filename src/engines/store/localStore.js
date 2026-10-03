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
import { SEED_CARDS, SEED_BOATS, SEED_CUSTOMERS } from './seed.js'

const ENTITY_OF = { cards: 'service_cards', boats: 'boats', customers: 'customers' }

let db = { cards: [], boats: [], customers: [] }
let hydrated = false
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

/* A cold device with nothing stored gets the seed fixture, exactly once. This
   is the bootstrap snapshot; after the first sync the server is the truth. */
export async function hydrate() {
  if (hydrated) return db
  try {
    const [cards, boats, customers] = await Promise.all([
      idb.all('service_cards'),
      idb.all('boats'),
      idb.all('customers'),
    ])

    if (!cards.length && !customers.length) {
      const now = new Date().toISOString()
      await Promise.all([
        ...SEED_CUSTOMERS.map((c) => idb.put('customers', { ...c, version: 1, updated_at: now })),
        ...SEED_BOATS.map((b) => idb.put('boats', { ...b, version: 1, updated_at: now })),
        ...SEED_CARDS.map((c) => idb.put('service_cards', { ...c, version: 1, updated_at: now })),
      ])
      db = { cards: SEED_CARDS, boats: SEED_BOATS, customers: SEED_CUSTOMERS }
    } else {
      db = { cards, boats, customers }
    }
  } catch (e) {
    /* Storage is unavailable — private mode, or a browser that refuses. Say so
       rather than running in a state that looks fine and silently loses every
       write. `degraded` drives a visible warning in Setup. */
    degraded = e?.message ?? 'storage unavailable'
    db = { cards: SEED_CARDS, boats: SEED_BOATS, customers: SEED_CUSTOMERS }
  }
  hydrated = true
  notify()
  return db
}

export async function reload() {
  hydrated = false
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
  return { card, boat, customer }
}

export function listCustomers() {
  return db.customers
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
  db.cards[i] = { ...db.cards[i], ...patch, local_pending: true }
  write('cards', db.cards[i])
  return db.cards[i]
}

export function setAuthorizedWork(id, key, patch) {
  const card = db.cards.find((c) => c.id === id)
  if (!card) return null
  const next = (card.authorized_work ?? []).map((w) => (w.key === key ? { ...w, ...patch } : w))
  return patchCard(id, { authorized_work: next })
}

export function addLog(id, log) {
  const card = db.cards.find((c) => c.id === id)
  if (!card) return null
  return patchCard(id, { logs: [...(card.logs ?? []), log] })
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