import test from 'node:test'
import assert from 'node:assert/strict'

import { CARD_STATUS, STATUS_ORDER, nextStatuses, canTransition, progressPercent, statusMeta } from './cardStatus.js'

/* No-mirror rule: every status pairs colour (tone) with a label and a shape. */
test('every status carries label + tone + shape, so colour never stands alone', () => {
  for (const s of STATUS_ORDER) {
    const m = CARD_STATUS[s]
    assert.ok(m.label, s)
    assert.ok(m.tone, s)
    assert.ok(m.shape, s)
  }
})

test('lifecycle order matches the paper flow', () => {
  assert.deepEqual(STATUS_ORDER, ['intake', 'fall_checklist', 'storage', 'spring_checklist', 'service', 'cleaning', 'ready', 'invoiced', 'archived'])
})

test('forward chain skips cleaning: service goes straight to ready', () => {
  assert.ok(canTransition('service', 'cleaning'))
  assert.ok(canTransition('service', 'ready'))
  assert.ok(canTransition('cleaning', 'ready'))
})

test('a one-step backward move is always legal for field corrections', () => {
  assert.ok(canTransition('storage', 'fall_checklist'))
  assert.ok(canTransition('ready', 'cleaning'))
  assert.ok(!canTransition('storage', 'intake'), 'only one step back, not two')
})

test('skipping stages is refused', () => {
  assert.ok(!canTransition('intake', 'storage'))
  assert.ok(!canTransition('storage', 'service'))
  assert.ok(!canTransition('ready', 'archived'))
})

test('archived has no forward moves, only the one-step correction back', () => {
  assert.deepEqual(nextStatuses('archived'), ['invoiced'])
  assert.ok(!canTransition('archived', 'intake'))
})

test('unknown status transitions nowhere instead of throwing', () => {
  assert.deepEqual(nextStatuses('bogus'), [])
  assert.ok(!canTransition('bogus', 'intake'))
})

test('progress is monotonic and cleaning parks at service level', () => {
  assert.equal(progressPercent('intake'), 0)
  assert.equal(progressPercent('archived'), 1)
  assert.equal(progressPercent('cleaning'), progressPercent('service'))
  assert.ok(progressPercent('service') < progressPercent('ready'))
})

test('statusMeta falls back for unknown status instead of throwing', () => {
  const m = statusMeta('bogus')
  assert.equal(m.tone, 'neutral')
})
