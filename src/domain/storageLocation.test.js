import test from 'node:test'
import assert from 'node:assert/strict'

import { locationFieldsFor, isBoathouse, needsLocation, normalizeLocation, locationSummary, SIZE_CLASSES, sizeClassFor, heightSummary, dimensionSummary, positionCode, findPosition, buildingGrid, boathouseGrid, buildingsToDraw, boathousesToDraw, groupByStorageType, positionByCode, marinaFill } from './storageLocation.js'

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

/* ------------------------------------------------------------- map views */

const SHAPE = { buildings: ['Metal 1', 'Metal 2'], rows: [1, 2], cols: ['A', 'B'] }

test('a building grid puts each boat in its own cell and leaves the rest vacant', () => {
  const cards = [
    { id: 'k-1', storage_type: 'storage_building', storage_building: 'Metal 1', storage_row: 1, storage_col: 'B' },
    { id: 'k-2', storage_type: 'storage_building', storage_building: 'Metal 2', storage_row: 2, storage_col: 'A' },
  ]
  const grid = buildingGrid({ building: 'Metal 1', cards, layout: [], shape: SHAPE })

  /* Letters down the side, numbers across: the same axes the shed is stencilled
     with, and the same cell codes. */
  assert.equal(grid.cols.join(','), '1,2')
  assert.deepEqual(grid.rows.map((r) => r.row), ['A', 'B'])
  assert.equal(grid.rows[1].cells[0].card.id, 'k-1')
  assert.equal(grid.rows[0].cells[0].card, null)
  assert.equal(grid.rows[1].cells[1].card, null)
  /* Only this building's boats are placed: the row count is not a filter. */
  assert.equal(grid.rows.flatMap((r) => r.cells).filter((c) => c.card).length, 1)
})

test('a cell carries the measured position as well as the boat', () => {
  const layout = [{ kind: 'position', value: 'Metal 1/1/A', length_ft: 28, width_ft: 12, height_front_ft: 9, height_back_ft: 7, prior_year_customer: 'Hollis' }]
  const grid = buildingGrid({ building: 'Metal 1', cards: [], layout, shape: SHAPE })
  const cell = grid.rows[0].cells[0]

  assert.equal(cell.code, 'Metal 1/1/A')
  assert.equal(cell.card, null)
  assert.equal(cell.position.prior_year_customer, 'Hollis')
  assert.equal(sizeClassFor(cell.position).key, 'large')
  /* And a cell the layout does not describe says so rather than guessing. */
  assert.equal(grid.rows[1].cells[0].position, null)
  assert.equal(sizeClassFor(grid.rows[1].cells[0].position).label, 'No size')
})

test('a boat with no row or column is surfaced, not dropped off the map', () => {
  const cards = [{ id: 'k-1', storage_type: 'storage_building', storage_building: 'Metal 1', storage_row: null, storage_col: null }]
  const grid = buildingGrid({ building: 'Metal 1', cards, layout: [], shape: SHAPE })

  assert.equal(grid.rows.flatMap((r) => r.cells).filter((c) => c.card).length, 0)
  assert.deepEqual(grid.unplaced.map((c) => c.id), ['k-1'])
})

test('only buildings that hold something are drawn', () => {
  const layout = [{ kind: 'position', value: 'Metal 2/1/A', length_ft: 20, width_ft: 9, height_front_ft: 7, height_back_ft: 7 }]
  const empty = []
  /* A building with neither a boat nor a measured position is a page of empty
     boxes, and it is left out. */
  assert.deepEqual(buildingsToDraw({ cards: empty, layout: empty, shape: SHAPE }), [])

  const withBoat = buildingsToDraw({
    cards: [{ id: 'k-1', storage_type: 'storage_building', storage_building: 'Metal 1' }],
    layout: [],
    shape: SHAPE,
  })
  assert.deepEqual(withBoat, ['Metal 1'])

  /* A measured but unoccupied spot is exactly what somebody is asking about. */
  const withPosition = buildingsToDraw({ cards: empty, layout, shape: SHAPE })
  assert.deepEqual(withPosition, ['Metal 2'])
})

test('the marina fill counts declared slots, not the ones in use', () => {
  const shape = { ...SHAPE, boathouseCount: 1, boathouseSlips: 10 }
  const cards = [
    { id: 'k-1', storage_type: 'storage_building' },
    { id: 'k-2', storage_type: 'storage_building', storage_building: 'Metal 1' },
    { id: 'k-3', storage_type: 'marina_boathouse' },
    /* A customer's own boathouse is not the marina's to count, and dry land has
       no slots to fill. */
    { id: 'k-4', storage_type: 'customer_boathouse' },
    { id: 'k-5', storage_type: 'dry_land' },
    { id: 'k-6', storage_type: null },
  ]

  assert.deepEqual(marinaFill({ cards, shape }), { occupied: 3, capacity: 18 })

  /* An empty marina is an empty bar, not a smaller marina: capacity is what the
     marina has declared, so it does not fall as buildings empty out. */
  assert.deepEqual(marinaFill({ cards: [], shape }), { occupied: 0, capacity: 18 })
})

test('a boathouse grid counts what is in it and places boats by slip', () => {
  const shape = { boathouseSlips: 3 }
  const cards = [
    { id: 'k-1', storage_type: 'marina_boathouse', boathouse_no: 3, slip_no: 2 },
    { id: 'k-2', storage_type: 'customer_boathouse', boathouse_no: 3, slip_no: null },
    { id: 'k-3', storage_type: 'marina_boathouse', boathouse_no: 4, slip_no: 1 },
  ]
  const grid = boathouseGrid({ boathouse: 3, cards, layout: [], shape })

  assert.equal(grid.slips.length, 3)
  assert.equal(grid.slips[1].card.id, 'k-1')
  assert.equal(grid.slips[0].card, null)
  /* A boat parked here with no slip is still found, and is listed rather than
     lost. */
  assert.deepEqual(grid.unplaced.map((c) => c.id), ['k-2'])
})

test('a boathouse number is matched numerically, so 3 and "3" are the same berth', () => {
  const grid = boathouseGrid({
    boathouse: 3,
    cards: [{ id: 'k-1', storage_type: 'marina_boathouse', boathouse_no: '3', slip_no: '1' }],
    layout: [],
    shape: { boathouseSlips: 2 },
  })
  assert.equal(grid.slips[0].card.id, 'k-1')
})

test('boathousesToDraw is the marina shape, not the data', () => {
  assert.deepEqual(boathousesToDraw({ boathouseCount: 3 }), [1, 2, 3])
  assert.deepEqual(boathousesToDraw({}), [])
})

test('the list groups by storage type in a fixed order, and names the unplaced', () => {
  const groups = groupByStorageType([
    { id: 'k-1', storage_type: 'water' },
    { id: 'k-2', storage_type: null },
    { id: 'k-3', storage_type: 'storage_building' },
    { id: 'k-4', storage_type: 'water' },
  ])

  assert.deepEqual(groups.map((g) => g.type), ['storage_building', 'water', 'unset'])
  assert.equal(groups.find((g) => g.type === 'water').items.length, 2)
  assert.equal(groups.find((g) => g.type === 'storage_building').label, 'Storage building')
  assert.equal(groups.find((g) => g.type === 'unset').label, 'No location set')
})

test('a code lookup matches exactly, and an absent code returns nothing', () => {
  const layout = [{ kind: 'position', value: 'A/2/3' }]
  assert.equal(positionByCode(layout, 'A/2/3').value, 'A/2/3')
  assert.equal(positionByCode(layout, 'A/2/4'), null)
  assert.equal(positionByCode(layout, null), null)
})
