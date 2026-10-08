import test from 'node:test'
import assert from 'node:assert/strict'

import { locationFieldsFor, isBoathouse, needsLocation, normalizeLocation, locationSummary } from './storageLocation.js'

test('boathouse types take boathouse + slip, building takes building + row + col', () => {
  assert.deepEqual(locationFieldsFor('customer_boathouse'), ['boathouse_no', 'slip_no'])
  assert.deepEqual(locationFieldsFor('marina_boathouse'), ['boathouse_no', 'slip_no'])
  assert.deepEqual(locationFieldsFor('storage_building'), ['storage_building', 'storage_row', 'storage_col'])
})

test('dry land, covered and water need no location', () => {
  for (const t of ['dry_land', 'covered', 'water']) assert.ok(!needsLocation(t))
  assert.ok(needsLocation('customer_boathouse'))
  assert.ok(needsLocation('storage_building'))
})

test('switching type strips the old fields so invalid combos are unrepresentable', () => {
  const card = { storage_type: 'marina_boathouse', boathouse_no: 3, slip_no: 7, storage_building: 'A', storage_row: 1, storage_col: 2 }
  const next = normalizeLocation(card, 'dry_land')
  assert.equal(next.storage_type, 'dry_land')
  for (const f of ['boathouse_no', 'slip_no', 'storage_building', 'storage_row', 'storage_col']) assert.equal(next[f], null)
})

test('boathouse to building keeps nothing from the old type', () => {
  const card = { storage_type: 'marina_boathouse', boathouse_no: 3, slip_no: 7 }
  const next = normalizeLocation(card, 'storage_building')
  assert.equal(next.boathouse_no, null)
  assert.equal(next.slip_no, null)
})

test('normalize returns a new object and leaves the input untouched', () => {
  const card = { storage_type: 'water', boathouse_no: 3 }
  const next = normalizeLocation(card, 'water')
  assert.notEqual(next, card)
  assert.equal(card.storage_type, 'water')
})

test('unknown type exposes no fields and clears everything', () => {
  assert.deepEqual(locationFieldsFor('bogus'), [])
  const next = normalizeLocation({ storage_type: 'water', slip_no: 7 }, 'bogus')
  assert.equal(next.slip_no, null)
})

test('summaries name the location instead of returning ids', () => {
  assert.equal(locationSummary({ storage_type: 'marina_boathouse', boathouse_no: 3, slip_no: 7 }), 'BH 3 · Slip 7')
  assert.equal(locationSummary({ storage_type: 'dry_land' }), 'Dry land')
  assert.equal(locationSummary({ storage_type: 'bogus' }), '—')
})

test('isBoathouse is true only for the two boathouse types', () => {
  assert.ok(isBoathouse('customer_boathouse'))
  assert.ok(isBoathouse('marina_boathouse'))
  assert.ok(!isBoathouse('storage_building'))
  assert.ok(!isBoathouse('water'))
})
