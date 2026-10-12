import test from 'node:test'
import assert from 'node:assert/strict'

import { describe, differences, fieldLabel, isSettled } from './conflictDiff.js'

const conflict = (over = {}) => ({
  entity: 'service_cards',
  entity_id: 'k-1',
  local_payload: { id: 'k-1', boat_id: 'b-1', status: 'storage', remarks: 'Wrap it' },
  server_payload: { id: 'k-1', boat_id: 'b-1', status: 'storage', remarks: 'Wrap it' },
  ...over,
})

test('identical payloads have nothing to decide', () => {
  assert.deepEqual(differences(conflict()), [])
  assert.equal(isSettled(conflict()), true)
})

/* The bug this replaced: the old comparison whitelisted card, boat and customer
   column names, so a conflict on a child entity always reported "both versions
   agree" no matter what the two versions actually said. */
test('a child-entity conflict shows its real difference', () => {
  const c = conflict({
    entity: 'received_items',
    local_payload: { id: 'ri-1', card_id: 'k-1', item: 'paddles', present: 1, notes: 'two of them' },
    server_payload: { id: 'ri-1', card_id: 'k-1', item: 'paddles', present: 0, notes: 'two of them' },
  })
  const rows = differences(c)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].field, 'present')
  assert.equal(rows[0].label, 'Handed over')
  assert.equal(rows[0].mine, 'yes')
  assert.equal(rows[0].theirs, 'no')
  assert.equal(isSettled(c), false)
})

test('a work log conflict surfaces the note, which a worker could otherwise lose', () => {
  const c = conflict({
    entity: 'work_logs',
    local_payload: { id: 'wl-1', card_id: 'k-1', description: 'Drained lower unit', employee_id: 'emp-2' },
    server_payload: { id: 'wl-1', card_id: 'k-1', description: 'Greased bearings', employee_id: 'emp-2' },
  })
  const rows = differences(c)
  assert.deepEqual(rows.map((r) => r.field), ['description'])
  assert.equal(rows[0].mine, 'Drained lower unit')
  assert.equal(rows[0].theirs, 'Greased bearings')
})

test('bookkeeping columns are never presented as a difference', () => {
  const c = conflict({
    local_payload: { status: 'storage', version: 4, updated_at: '2026-10-12T10:00:00Z', updated_by: 'emp-2', device_id: 'dev-b' },
    server_payload: { status: 'storage', version: 7, updated_at: '2026-10-12T11:00:00Z', updated_by: 'emp-1', device_id: 'dev-a' },
  })
  assert.deepEqual(differences(c), [])
})

test('which record a conflict belongs to is not a field to choose between', () => {
  const c = conflict({
    local_payload: { card_id: 'k-1', item: 'keys', id: 'ri-1' },
    server_payload: { card_id: 'k-1', item: 'keys', id: 'ri-1' },
  })
  assert.deepEqual(differences(c), [])
})

test('a missing field on one side is a difference, not agreement', () => {
  const c = conflict({ local_payload: { remarks: 'Wrap it' }, server_payload: {} })
  const rows = differences(c)
  assert.deepEqual(rows.map((r) => r.field), ['remarks'])
  assert.equal(rows[0].theirs, '—')
})

test('equal values written in different shapes are not a difference', () => {
  const c = conflict({
    local_payload: { wrap_required: true, length_ft: 24 },
    server_payload: { wrap_required: 1, length_ft: '24' },
  })
  assert.deepEqual(differences(c), [])
})

test('an unknown column is still shown, labelled with its own name', () => {
  const c = conflict({ local_payload: { mystery_column: 'a' }, server_payload: { mystery_column: 'b' } })
  assert.equal(differences(c)[0].label, 'mystery column')
})

/* "No differences" before the pull lands means "not comparable yet", which is a
   different statement and must not be shown as agreement. */
test('an uncomparable conflict is not called settled', () => {
  const c = conflict({ server_payload: null, local_payload: { status: 'storage' } })
  assert.equal(isSettled(c), false)
})

test('an unknown entity still gets a heading rather than a blank', () => {
  assert.equal(describe('service_cards'), 'Card')
  assert.equal(describe('appointments'), 'Appointment')
  assert.equal(describe('wat'), 'wat')
  assert.equal(fieldLabel('service_cards', 'wrap_required'), 'Shrink wrap')
  assert.equal(fieldLabel('service_cards', 'unknown_thing'), 'unknown thing')
})
