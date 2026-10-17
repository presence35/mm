import test from 'node:test'
import assert from 'node:assert/strict'

import { readRecents, rememberCard, subscribeRecents } from './recents.js'

/* A localStorage stand-in. The module never reaches a real device here — the
   storage is the module's only dependency, and that is why it is a parameter. */
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

test('the last card opened is first, and a card opened twice is one entry', () => {
  const s = memoryStorage()
  rememberCard('emp-1', 'c-1', s)
  rememberCard('emp-1', 'c-2', s)
  rememberCard('emp-1', 'c-1', s)
  assert.deepEqual(readRecents('emp-1', s), ['c-1', 'c-2'])
})

test('the list is capped, newest kept', () => {
  const s = memoryStorage()
  for (const id of ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-7']) rememberCard('emp-1', id, s)
  assert.deepEqual(readRecents('emp-1', s), ['c-7', 'c-6', 'c-5', 'c-4', 'c-3'])
})

test('a shared phone keeps one list per worker', () => {
  const s = memoryStorage()
  rememberCard('emp-1', 'c-1', s)
  rememberCard('emp-2', 'c-9', s)
  assert.deepEqual(readRecents('emp-1', s), ['c-1'])
  assert.deepEqual(readRecents('emp-2', s), ['c-9'])
})

test('no employee means no list and nothing written', () => {
  const s = memoryStorage()
  assert.deepEqual(readRecents(undefined, s), [])
  rememberCard(undefined, 'c-1', s)
  rememberCard(null, 'c-1', s)
  assert.deepEqual(s.entries(), {})
})

test('a corrupt value reads as empty, and the next card rewrites it', () => {
  const s = memoryStorage()
  rememberCard('emp-1', 'c-1', s)
  s.setItem('mm.recents.emp-1', '{"not":"a list"}')
  assert.deepEqual(readRecents('emp-1', s), [])
  rememberCard('emp-1', 'c-2', s)
  assert.deepEqual(readRecents('emp-1', s), ['c-2'])
})

test('storage that refuses to write costs the shortcut, not the tap', () => {
  const s = memoryStorage(true)
  assert.doesNotThrow(() => rememberCard('emp-1', 'c-1', s))
  assert.deepEqual(readRecents('emp-1', s), [])
})

test('subscribers hear about a change once, and not about a repeat tap', () => {
  const s = memoryStorage()
  let calls = 0
  const stop = subscribeRecents(() => {
    calls += 1
  })
  rememberCard('emp-1', 'c-1', s)
  rememberCard('emp-1', 'c-1', s)
  rememberCard('emp-1', 'c-2', s)
  stop()
  rememberCard('emp-1', 'c-3', s)
  assert.equal(calls, 2)
})
