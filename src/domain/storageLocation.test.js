import test from 'node:test'
import assert from 'node:assert/strict'

import { locationFieldsFor, isBoathouse, needsLocation, normalizeLocation, locationSummary, SIZE_CLASSES, sizeClassFor, heightSummary, dimensionSummary, positionCode, findPosition } from './storageLocation.js'

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

/* Every size class pairs colour with a label and a shape, so the chart's
   colour coding survives greyscale and colour-vision deficiency
   (architecture.md constraint 9). */
test('every size class carries label + tone + shape', () => {
  for (const c of SIZE_CLASSES) {
    assert.ok(c.label, c.key)
    assert.ok(c.tone, c.key)
    assert.ok(c.shape, c.key)
  }
})

test('size class is decided by length, which is what decides whether a boat fits', () => {
  assert.equal(sizeClassFor({ length_ft: 18 }).key, 'small')
  assert.equal(sizeClassFor({ length_ft: 20 }).key, 'small')
  assert.equal(sizeClassFor({ length_ft: 21 }).key, 'medium')
  assert.equal(sizeClassFor({ length_ft: 26 }).key, 'medium')
  assert.equal(sizeClassFor({ length_ft: 27 }).key, 'large')
  assert.equal(sizeClassFor({ length_ft: '24' }).key, 'medium')
})

test('a position with no usable length is unclassified, not silently small', () => {
  assert.equal(sizeClassFor({}).key, 'unknown')
  assert.equal(sizeClassFor({ length_ft: 0 }).key, 'unknown')
  assert.equal(sizeClassFor({ length_ft: 'wide' }).key, 'unknown')
  assert.equal(sizeClassFor(null).key, 'unknown')
})

test('a sloping roof reports the height range, a flat one a single number', () => {
  assert.equal(heightSummary({ height_front_ft: 9, height_back_ft: 7 }), '7–9 ft')
  assert.equal(heightSummary({ height_front_ft: 8, height_back_ft: 8 }), '8 ft')
  assert.equal(heightSummary({ height_front_ft: 8 }), '8 ft')
  assert.equal(heightSummary({}), null)
})

test('the dimension summary omits what the position does not have', () => {
  assert.equal(dimensionSummary({ length_ft: 24, width_ft: 10, height_front_ft: 9, height_back_ft: 7 }), '24 ft long · 10 ft wide · 7–9 ft high')
  assert.equal(dimensionSummary({ length_ft: 24 }), '24 ft long')
  assert.equal(dimensionSummary({}), null)
})

test('a position code identifies a slot, and a slotless type has none', () => {
  assert.equal(positionCode({ storage_type: 'storage_building', storage_building: 'A', storage_row: 2, storage_col: 3 }), 'A/2/3')
  assert.equal(positionCode({ storage_type: 'marina_boathouse', boathouse_no: 3, slip_no: 7 }), 'BH3/S7')
  assert.equal(positionCode({ storage_type: 'dry_land' }), null)
  assert.equal(positionCode({ storage_type: 'storage_building' }), null)
})

test('the layout lookup joins on the code, and misses cleanly', () => {
  const layout = [
    { kind: 'position', value: 'A/2/3', length_ft: 28, width_ft: 12, height_front_ft: 9, height_back_ft: 7, prior_year_customer: 'Hollis' },
    { kind: 'building', value: 'A', label: 'Building A' },
  ]
  const card = { storage_type: 'storage_building', storage_building: 'A', storage_row: 2, storage_col: 3 }
  assert.equal(findPosition(layout, card).prior_year_customer, 'Hollis')
  assert.equal(sizeClassFor(findPosition(layout, card)).key, 'large')
  assert.equal(findPosition(layout, { storage_type: 'dry_land' }), null)
  assert.equal(findPosition(layout, { storage_type: 'storage_building', storage_building: 'Z', storage_row: 9, storage_col: 9 }), null)
})
