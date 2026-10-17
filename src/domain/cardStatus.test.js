import test from 'node:test'
import assert from 'node:assert/strict'

import { CARD_STATUS, STATUS_ORDER, nextStatuses, canTransition, statusMeta, STAGES, stagePhase, stageProgress, countsByStatus, OPTIONAL_STAGES, activeCardFor } from './cardStatus.js'

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

test('the stage strip is the lifecycle in order, and marks the skippable stage', () => {
  assert.deepEqual(
    STAGES.map((s) => s.key),
    STATUS_ORDER,
  )
  assert.equal(OPTIONAL_STAGES.size, 1)
  assert.ok(OPTIONAL_STAGES.has('cleaning'))
  assert.equal(STAGES.find((s) => s.key === 'cleaning').optional, true)
  assert.equal(STAGES.find((s) => s.key === 'service').optional, false)
})

test('stage phase is positional: behind is done, equal is current, ahead is future', () => {
  assert.equal(stagePhase('service', 'intake'), 'done')
  assert.equal(stagePhase('service', 'service'), 'current')
  assert.equal(stagePhase('service', 'ready'), 'future')
  assert.equal(stagePhase('intake', 'intake'), 'current')
})

test('an unknown status yields no current stage instead of a wrong one', () => {
  assert.equal(stagePhase('bogus', 'intake'), 'future')
  assert.equal(stagePhase('intake', 'bogus'), 'future')
})

test('the progress bar counts positionally, and an unknown status gets no bar', () => {
  assert.deepEqual(stageProgress('intake'), { done: 1, total: 9 })
  assert.deepEqual(stageProgress('service'), { done: 5, total: 9 })
  assert.deepEqual(stageProgress('archived'), { done: 9, total: 9 })
  assert.equal(stageProgress('bogus'), null)
})

test('counts bucket every card, including an unrecognised status', () => {
  const counts = countsByStatus([
    { status: 'intake' },
    { status: 'intake' },
    { status: 'ready' },
    { status: 'nonsense' },
  ])
  assert.equal(counts.intake, 2)
  assert.equal(counts.ready, 1)
  assert.equal(counts.nonsense, 1)
  assert.equal(counts.archived, 0)
  /* The buckets sum to the list length, so a filter chip total never
     contradicts the row count on screen. */
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    4,
  )
})

test('countsByStatus tolerates an empty or missing list', () => {
  assert.equal(countsByStatus([]).intake, 0)
  assert.equal(countsByStatus(undefined).intake, 0)
})

test('statusMeta falls back for unknown status instead of throwing', () => {
  const m = statusMeta('bogus')
  assert.equal(m.tone, 'neutral')
})

/* ------------------------------------------- which card a boat's row opens */

test('a boat opens the card that is neither invoiced nor archived', () => {
  const cards = [
    { id: 'k-1', season_year: 2024, status: 'archived' },
    { id: 'k-2', season_year: 2025, status: 'invoiced' },
    { id: 'k-3', season_year: 2026, status: 'storage' },
  ]
  assert.equal(activeCardFor(cards).id, 'k-3')
})

test('history alone is no card at all, so the caller can fall back to the owner', () => {
  assert.equal(activeCardFor([{ id: 'k-1', status: 'invoiced' }, { id: 'k-2', status: 'archived' }]), null)
  assert.equal(activeCardFor([]), null)
  assert.equal(activeCardFor(undefined), null)
})

test('the newest season wins, so the answer does not depend on row order', () => {
  const older = { id: 'k-1', season_year: 2025, work_order_no: 'WO-1', status: 'storage' }
  const newer = { id: 'k-2', season_year: 2026, work_order_no: 'WO-2', status: 'intake' }
  assert.equal(activeCardFor([older, newer]).id, 'k-2')
  assert.equal(activeCardFor([newer, older]).id, 'k-2')
})

test('the same season is broken by work order number, and by nothing else', () => {
  const a = { id: 'k-1', season_year: 2026, work_order_no: 'WO-2481', status: 'storage' }
  const b = { id: 'k-2', season_year: 2026, work_order_no: 'WO-2484', status: 'storage' }
  assert.equal(activeCardFor([a, b]).id, 'k-2')
  assert.equal(activeCardFor([b, a]).id, 'k-2')
})

test('a card with no season at all still counts as open, and sorts last', () => {
  const seasonal = { id: 'k-1', season_year: 2024, status: 'storage' }
  const undated = { id: 'k-2', season_year: null, status: 'intake' }
  assert.equal(activeCardFor([undated, seasonal]).id, 'k-1')
  assert.equal(activeCardFor([undated]).id, 'k-2')
})
