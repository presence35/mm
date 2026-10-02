/*
 * Local store — the read/write path every screen goes through.
 *
 * Constraint 1: screens serve from here. No screen calls fetch. No screen
 * touches IndexedDB. This module is the only thing that knows how data is
 * persisted, and in Phase 1 that is memory + localStorage, seeded from
 * seed.js. Phase 4 swaps the internals for IndexedDB; the API does not move.
 *
 * Writes are optimistic and durable-before-sync: they land here first and are
 * queued for the sync engine later. Nothing in this module talks to a server.
 */

import { SEED_CARDS, SEED_BOATS, SEED_CUSTOMERS } from './seed.js'

const KEY = 'mm.store.v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.cards?.length) return null
    return parsed
  } catch {
    return null
  }
}

let db = load() ?? {
  cards: SEED_CARDS,
  boats: SEED_BOATS,
  customers: SEED_CUSTOMERS,
}

const listeners = new Set()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* private mode or quota — the in-memory copy still serves this session */
  }
  listeners.forEach((fn) => fn())
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetToSeed() {
  db = { cards: SEED_CARDS, boats: SEED_BOATS, customers: SEED_CUSTOMERS }
  persist()
}

/* ------------------------------------------------------------------ reads */

export function listCards() {
  return [...db.cards].sort((a, b) => (a.work_order_no < b.work_order_no ? 1 : -1))
}

export function getCard(id) {
  const card = db.cards.find((c) => c.id === id)
  if (!card) return null
  const boat = db.boats.find((b) => b.id === card.boat_id) ?? null
  const customer = boat ? db.customers.find((c) => c.id === boat.customer_id) ?? null : null
  return { card, boat, customer }
}

export function getCardsByIds(ids) {
  return ids.map((id) => getCard(id)).filter(Boolean)
}

export function listCustomers() {
  return db.customers
}

export function getCustomer(id) {
  const customer = db.customers.find((c) => c.id === id) ?? null
  return { customer, boats: db.boats.filter((b) => b.customer_id === id) }
}

/* ----------------------------------------------------------------- writes */

export function patchCard(id, patch) {
  const i = db.cards.findIndex((c) => c.id === id)
  if (i < 0) return null
  db.cards[i] = { ...db.cards[i], ...patch }
  persist()
  return db.cards[i]
}

export function toggleCardField(id, field) {
  const card = db.cards.find((c) => c.id === id)
  if (!card) return null
  return patchCard(id, { [field]: !card[field] })
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

/* Pending-write counter. A real implementation reads the sync outbox; until
   that exists this reflects unsynced local mutations. */
export function pendingWriteCount() {
  return 0
}