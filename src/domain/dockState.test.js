import test from 'node:test'
import assert from 'node:assert/strict'

import { STANDINGS, standingOf, isDocked, currentCards } from './dockState.js'

const NOW = new Date('2026-10-18T12:00:00.000Z')
const boat = (id) => ({ id })
const docked = (id, boatId, extra = {}) => ({
  id,
  boat_id: boatId,
  season_year: 2026,
  status: 'storage',
  storage_type: 'storage_building',
  storage_building: 'Metal 1',
  storage_row: 2,
  storage_col: 'A',
  ...extra,
})

test('the standings are four single words', () => {
  assert.deepEqual(
    STANDINGS.map((s) => s.value),
    ['docked', 'ashore', 'lapsed', 'none'],
  )
  for (const standing of STANDINGS) assert.equal(standing.label.split(' ').length, 1, standing.label)
})

test('no boats on file is None, whatever else is true', () => {
  assert.equal(standingOf({ boats: [], cards: [docked('k-1', 'b-1')], now: NOW }), 'none')
})

test('a boat sitting on the map is Docked', () => {
  const boats = [boat('b-1')]
  assert.equal(standingOf({ boats, cards: [docked('k-1', 'b-1')], now: NOW }), 'docked')
  /* A boathouse slip is on the map too. */
  const slip = docked('k-2', 'b-1', {
    storage_type: 'marina_boathouse',
    storage_building: null,
    storage_row: null,
    storage_col: null,
    boathouse_no: 3,
    slip_no: 7,
  })
  assert.equal(standingOf({ boats, cards: [slip], now: NOW }), 'docked')
})

test('has boats and nothing in dock, but was here this season, is Ashore', () => {
  const boats = [boat('b-1')]
  const cards = [{ id: 'k-1', boat_id: 'b-1', season_year: 2026, status: 'invoiced', storage_type: 'dry_land' }]
  assert.equal(standingOf({ boats, cards, now: NOW }), 'ashore')
})

test('a last card from an older season is Lapsed', () => {
  const boats = [boat('b-1')]
  const cards = [{ id: 'k-1', boat_id: 'b-1', season_year: 2025, status: 'invoiced' }]
  assert.equal(standingOf({ boats, cards, now: NOW }), 'lapsed')
  /* A boat with no card at all has never been here. */
  assert.equal(standingOf({ boats, cards: [], now: NOW }), 'lapsed')
})

test('history does not place a boat, and a season on the card is what dates a visit', () => {
  const boats = [boat('b-1')]
  const archived = { ...docked('k-1', 'b-1'), season_year: 2025, status: 'archived' }
  /* The card still carries a storage position, but it is closed history: the
     boat is not on the map now. */
  assert.equal(isDocked(archived), true)
  assert.equal(standingOf({ boats, cards: [archived], now: NOW }), 'lapsed')
  /* The same boat, last season's card updated to this season, came this year. */
  assert.equal(standingOf({ boats, cards: [{ ...archived, season_year: 2026 }], now: NOW }), 'ashore')
})

test('another boat’s docked card is not this customer’s', () => {
  const boats = [boat('b-1')]
  assert.equal(standingOf({ boats, cards: [docked('k-9', 'b-9')], now: NOW }), 'lapsed')
})

test('the current card per boat is the newest open one', () => {
  const cards = [
    { id: 'k-1', boat_id: 'b-1', season_year: 2025, status: 'storage' },
    { id: 'k-2', boat_id: 'b-1', season_year: 2026, status: 'service' },
    { id: 'k-3', boat_id: 'b-2', season_year: 2026, status: 'archived' },
  ]
  assert.deepEqual(currentCards(cards).map((c) => c.id), ['k-2'])
})
