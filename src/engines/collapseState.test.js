import test from 'node:test'
import assert from 'node:assert/strict'

import { isSectionOpen, rememberSection } from './collapseState.js'

/* Same storage stand-in as recents.test.js: the module's only dependency is
   storage, which is why it is a parameter. */
function memoryStorage(failWrites = false) {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new Error('QuotaExceededError')
      map.set(k, String(v))
    },
    removeItem: (k) => map.delete(k),
    entries: () => Object.fromEntries(map),
  }
}

test('an unvisited section falls back to the default it was given', () => {
  const s = memoryStorage()
  assert.equal(isSectionOpen('card.photos', false, s), false)
  assert.equal(isSectionOpen('cards.recent', true, s), true)
})

test('a section remembers both ways, and the phone remembers it for the next screen', () => {
  const s = memoryStorage()
  rememberSection('card.photos', true, s)
  rememberSection('map.dry-land', true, s)
  assert.equal(isSectionOpen('card.photos', false, s), true)
  assert.equal(isSectionOpen('map.dry-land', false, s), true)
  rememberSection('card.photos', false, s)
  assert.equal(isSectionOpen('card.photos', true, s), false)
  /* The neighbour is untouched: one section's state is not the map's. */
  assert.equal(isSectionOpen('map.dry-land', false, s), true)
})

test('a section key is the whole identity — no employee, no card', () => {
  const s = memoryStorage()
  rememberSection('card.photos', true, s)
  assert.deepEqual(s.entries(), { 'mm.collapse': '{"card.photos":true}' })
})

test('storage that refuses to write costs the memory, not the tap', () => {
  const s = memoryStorage(true)
  assert.doesNotThrow(() => rememberSection('card.photos', true, s))
  assert.equal(isSectionOpen('card.photos', false, s), false)
})

test('storage that holds rubbish reads as no memory at all', () => {
  const s = memoryStorage()
  s.setItem('mm.collapse', '{not json')
  assert.equal(isSectionOpen('card.photos', true, s), true)
  s.setItem('mm.collapse', '["card.photos"]')
  assert.equal(isSectionOpen('card.photos', true, s), true)
  /* A non-boolean is not a state; the default stands rather than truthiness. */
  s.setItem('mm.collapse', '{"card.photos":"yes"}')
  assert.equal(isSectionOpen('card.photos', false, s), false)
})

test('no storage at all is not an error', () => {
  assert.equal(isSectionOpen('card.photos', true, null), true)
  assert.doesNotThrow(() => rememberSection('card.photos', true, null))
  assert.equal(isSectionOpen('', true, memoryStorage()), true)
})
