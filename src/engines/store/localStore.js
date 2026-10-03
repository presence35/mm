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

const restored = load()

let db = restored ?? {
  cards: SEED_CARDS,
  boats: SEED_BOATS,
  customers: SEED_CUSTOMERS,
}

/* Outbox: every mutation is queued here and drained by the sync engine.
   This is the local-first loop — writes land in the store first, always, and
   reach the server later or never. Nothing in this module talks to a network. */
let outbox = restored?.outbox ?? []
let opSeq = 0

const listeners = new Set()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...db, outbox }))
  } catch {
    /* private mode or quota — the in-memory copy still serves this session */
  }
  listeners.forEach((fn) => fn())
}

function enqueue(entity, op, payload) {
  opSeq += 1
  outbox = [...outbox, { op_id: `op-${opSeq}`, entity, op, payload, queued_at: Date.now() }]
  persist()
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
  enqueue('service_cards', 'upsert', { id, ...patch })
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

/* IDs are client-generated ULIDs — the server never allocates one, so an
   entity created with no signal already has a final ID. */
let ulidCounter = 0
export function newId(prefix) {
  ulidCounter += 1
  const stamp = Date.now().toString(32).toUpperCase().padStart(10, '0')
  const rand = Math.random().toString(32).slice(2, 8).toUpperCase()
  return `${prefix}-${stamp}${rand}${ulidCounter.toString(32).toUpperCase()}`
}

export function createCustomer(fields) {
  const customer = { ...fields, id: newId('c'), created_at: new Date().toISOString() }
  db.customers = [...db.customers, customer]
  enqueue('customers', 'upsert', customer)
  persist()
  return customer
}

export function findDuplicateCustomer({ email, phone }) {
  if (!email && !phone) return null
  return (
    db.customers.find((c) => (email && c.email?.toLowerCase() === email.toLowerCase()) || (phone && c.phone === phone)) ?? null
  )
}

export function createBoat(fields) {
  const boat = { ...fields, id: newId('b'), created_at: new Date().toISOString() }
  db.boats = [...db.boats, boat]
  enqueue('boats', 'upsert', boat)
  persist()
  return boat
}

export function boatsForCustomer(customerId) {
  return db.boats.filter((b) => b.customer_id === customerId)
}

export function cardsForCustomer(customerId) {
  const boatIds = new Set(db.boats.filter((b) => b.customer_id === customerId).map((b) => b.id))
  return db.cards.filter((c) => boatIds.has(c.boat_id))
}

export function cardsForBoat(boatId) {
  return db.cards.filter((c) => c.boat_id === boatId)
}

export function nextWorkOrderNo(now) {
  const year = now.getFullYear()
  const max = db.cards
    .filter((c) => String(c.work_order_no).startsWith(`WO-${year}`))
    .reduce((acc, c) => Math.max(acc, Number(String(c.work_order_no).split('-')[1]) || 0), 2400)
  return `WO-${year}${max + 1}`
}

export function createCard(fields) {
  const card = {
    storage_type: null,
    boathouse_no: null,
    slip_no: null,
    storage_building: null,
    storage_row: null,
    storage_col: null,
    wrap_required: false,
    unwrap_done: false,
    remarks: null,
    other_work: null,
    pickup_delivery: null,
    invoice_number: null,
    invoice_status: null,
    tax_rate: 0,
    status: 'intake',
    is_fake: 0,
    is_scanned: 0,
    received_items: [],
    authorized_work: [],
    condition: [],
    logs: [],
    photos: [],
    customer_token: newId('tk'),
    ...fields,
    id: newId('k'),
    created_at: new Date().toISOString(),
  }
  db.cards = [card, ...db.cards]
  enqueue('service_cards', 'upsert', card)
  persist()
  return card
}

/* ------------------------------------------------------------------ outbox */

export function pendingWrites() {
  return outbox
}

export function pendingWriteCount() {
  return outbox.length
}

/* Drain acknowledged ops. The sync engine calls this; nothing else does. */
export function drainOutbox(opIds) {
  const done = new Set(opIds)
  const before = outbox.length
  outbox = outbox.filter((o) => !done.has(o.op_id))
  if (outbox.length !== before) persist()
  return outbox.length
}

export function cardByToken(token) {
  return db.cards.find((c) => c.customer_token === token) ?? null
}