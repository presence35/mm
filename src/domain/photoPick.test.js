import test from 'node:test'
import assert from 'node:assert/strict'

import { mainPhoto, MAIN_PHOTO_TYPE } from './photoPick.js'

const p = (id, photo_type, uploaded_at, filename = `${id}.jpg`) => ({ id, photo_type, uploaded_at, filename })

test('no photos means no picture, not a placeholder', () => {
  assert.equal(mainPhoto([]), null)
  assert.equal(mainPhoto(null), null)
  assert.equal(mainPhoto(undefined), null)
  /* A row with no file behind it cannot be shown — 60 of them exist after the
     legacy import, and the header would draw nothing for one. */
  assert.equal(mainPhoto([{ id: 'p-1', photo_type: 'intake', filename: null }]), null)
})

test('intake wins over a newer photo of any other type', () => {
  const chosen = mainPhoto([
    p('p-1', 'general', '2026-10-18T10:00:00.000Z'),
    p('p-2', MAIN_PHOTO_TYPE, '2026-10-02T10:00:00.000Z'),
    p('p-3', 'damage', '2026-10-19T10:00:00.000Z'),
  ])
  assert.equal(chosen.id, 'p-2')
})

test('among two intake photos the latest wins', () => {
  const chosen = mainPhoto([
    p('p-1', MAIN_PHOTO_TYPE, '2026-10-02T10:00:00.000Z'),
    p('p-2', MAIN_PHOTO_TYPE, '2026-10-09T10:00:00.000Z'),
  ])
  assert.equal(chosen.id, 'p-2')
})

test('with no intake photo the latest of anything is used', () => {
  const chosen = mainPhoto([
    p('p-1', 'work', '2026-10-01T10:00:00.000Z'),
    p('p-2', 'completed', '2026-10-11T10:00:00.000Z'),
    p('p-3', 'general', '2026-09-30T10:00:00.000Z'),
  ])
  assert.equal(chosen.id, 'p-2')
})

test('a missing or tied timestamp still picks the same photo every time', () => {
  const rows = [p('p-1', 'general', null), p('p-2', 'general', null), p('p-3', 'general', null)]
  assert.equal(mainPhoto(rows).id, mainPhoto([...rows].reverse()).id)
  assert.equal(mainPhoto(rows).id, 'p-3')
})

test('an untagged photo is general, so it is still eligible', () => {
  assert.equal(mainPhoto([{ id: 'p-1', uploaded_at: '2026-10-01T10:00:00.000Z', filename: 'a.jpg' }]).id, 'p-1')
})
