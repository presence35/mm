import test from 'node:test'
import assert from 'node:assert/strict'

import { installIndexedDB } from './shim-indexeddb.js'

installIndexedDB()

const idb = await import('../src/engines/store/idb.js')
const store = await import('../src/engines/store/localStore.js')

/*
 * The staff roster in the client store.
 *
 * Written because of a bug this file now prevents. Employees are server-owned
 * reference data and live in the single `reference` store, not a store of their
 * own. Reading idb.all('employees') therefore threw — and hydrate() wraps every
 * read in one try/catch that falls back to seed data, so the throw was swallowed
 * and the app quietly replaced every card on the device with the sample marina,
 * on every boot, showing no error.
 *
 * The lesson is the fallback, not the typo: any read that throws is
 * indistinguishable from "storage unavailable", and one of them is fatal and
 * silent. So these assert that a healthy boot stays healthy.
 */

const REFERENCE_SNAPSHOT = {
  employees: [
    { id: 'emp-admin', name: 'Admin', role: 'admin', initials: 'AD', active: 1 },
    { id: 'emp-2', name: 'Bo Lindqvist', role: 'mechanic', initials: 'BL', active: 1 },
    { id: 'emp-3', name: 'Gone', role: 'mechanic', initials: 'GN', active: 0 },
  ],
}

test('a healthy boot does not degrade and does not lose cards', async () => {
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.reload()

  assert.equal(store.storageProblem(), null, 'no storage problem')
  assert.ok(store.listCards().length > 0, 'the sample marina is there')

  /* Written, not read-through: a card added locally must survive a rehydrate. */
  await store.hydrate()
  assert.ok(store.listCards().length > 0)
})

test('the roster arrives from the reference store, not a store of its own', async () => {
  await idb.wipe()
  await idb.setMeta('cursor', 0)

  /* First boot seeds a snapshot, which is correct for a device with nothing.
     The reference snapshot then arrives, and the next read is the one that must
     pick it up — so the seed branch is not what is under test here. */
  await store.reload()
  await idb.putReference(REFERENCE_SNAPSHOT)
  await store.reload()

  assert.equal(store.storageProblem(), null, 'reading employees must not degrade the store')

  const staff = store.listStaff()
  assert.equal(staff.length, 2, 'active only')
  assert.deepEqual(staff.map((s) => s.name).sort(), ['Admin', 'Bo Lindqvist'])
})

test('a deactivated person is not offered at sign-in', async () => {
  const staff = store.listStaff()
  assert.ok(!staff.some((s) => s.name === 'Gone'))
  assert.ok(staff.every((s) => Number(s.active) === 1))
})

test('a card written locally survives alongside the roster', async () => {
  const before = store.listCards().length
  const created = await store.createCard({ boat_id: 'b-1', work_order_no: 'WO-TEST', season_year: 2026 })
  const after = store.listCards().length

  assert.equal(after, before + 1)
  assert.equal(store.getCard(created.id).card.work_order_no, 'WO-TEST')
  assert.equal(store.listStaff().length, 2, 'the roster is untouched by a card write')
})

test('a fresh device with no reference data still has someone to offer', async () => {
  await idb.wipe()
  await idb.setMeta('cursor', 0)
  await store.reload()

  /* Without this the sign-in screen would have nobody to choose and would look
     broken before the first sync. */
  const staff = store.listStaff()
  assert.ok(staff.length >= 1)
  assert.equal(store.storageProblem(), null)
})