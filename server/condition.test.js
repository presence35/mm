import test from 'node:test'
import assert from 'node:assert/strict'

import { setRating, setNote, summarise, ratingFor, noteFor, needsNote, RATINGS } from '../src/features/card/conditionModel.js'

/*
 * These rules used to live inside a React hook, which is why a note field that
 * silently refused to save shipped: nothing could reach them. A bug that costs a
 * mechanic's typed words is worth this file existing.
 */

const AREAS = ['top', 'hull', 'upholstery', 'motor', 'propeller', 'lower_unit']

/* ------------------------------------------------------------- invariant */

test('an empty entry cannot exist: no rating and no note means no row', () => {
  let c = setRating([], 'hull', 'fair')
  assert.equal(c.length, 1)

  c = setNote(c, 'hull', 'scuff')
  assert.equal(c.length, 1, 'still one entry, not two')

  /* Clearing both must remove the entry rather than leave an empty husk. */
  c = setRating(c, 'hull', null)
  assert.equal(c.length, 1, 'the note alone keeps the entry alive')
  c = setNote(c, 'hull', '')
  assert.deepEqual(c, [], 'nothing left, so nothing remains')
})

test('every entry that exists carries something', () => {
  let c = []
  c = setRating(c, 'hull', 'good')
  c = setNote(c, 'motor', 'some scuff')
  c = setRating(c, 'top', 'poor')
  c = setNote(c, 'top', 'torn')

  for (const entry of c) {
    assert.ok(entry.rating || entry.note, `empty entry for ${entry.area}`)
  }
  assert.equal(c.length, 3)
})

/* --------------------------------------------------------------- rating */

test('a rating is set and read back', () => {
  const c = setRating([], 'hull', 'fair')
  assert.equal(ratingFor(c, 'hull'), 'fair')
  assert.equal(noteFor(c, 'hull'), null)
})

test('changing a rating replaces rather than appends', () => {
  let c = setRating([], 'hull', 'fair')
  c = setRating(c, 'hull', 'poor')
  assert.equal(c.length, 1)
  assert.equal(ratingFor(c, 'hull'), 'poor')
})

test('an unknown rating is refused rather than stored', () => {
  assert.throws(() => setRating([], 'hull', 'excellent'), /Unknown condition rating/)
  assert.throws(() => setRating([], 'hull', ''), /Unknown condition rating/)
})

/* ------------------------------------------------------------------ note */

test('a note is stored, trimmed of surrounding whitespace for emptiness only', () => {
  const c = setNote([], 'hull', '  scuff on starboard  ')
  assert.equal(noteFor(c, 'hull'), '  scuff on starboard  ', 'the text itself is not altered')
  assert.equal(ratingFor(c, 'hull'), null)
})

test('a note can be written before any rating is chosen', () => {
  const c = setNote([], 'motor', 'customer reports a knock')
  assert.equal(noteFor(c, 'motor'), 'customer reports a knock')
  assert.equal(ratingFor(c, 'motor'), null)
})

test('whitespace alone is not a note', () => {
  const c = setNote(setRating([], 'hull', 'poor'), 'hull', '   ')
  assert.equal(noteFor(c, 'hull'), null)
  assert.equal(c.length, 1, 'the rating keeps the entry alive')
})

/*
 * The bug that shipped: TextField passes the value as a string, and the handler
 * read `.target` off it, so the store received undefined. The empty-note path
 * swallowed it and reported success.
 */
test('setNote refuses anything that is not the field value', () => {
  assert.throws(() => setNote([], 'hull', undefined), TypeError)
  assert.throws(() => setNote([], 'hull', null), TypeError)
  assert.throws(() => setNote([], 'hull', { target: { value: 'x' } }), TypeError)
  assert.throws(() => setNote([], 'hull', 42), TypeError)
})

/* ------------------------------------------------------ the data-loss bug */

test('clearing a rating keeps the note — the worker never loses typed text', () => {
  let c = setRating([], 'hull', 'poor')
  c = setNote(c, 'hull', 'Transom cracked, needs quote')

  c = setRating(c, 'hull', null)

  assert.equal(ratingFor(c, 'hull'), null, 'the rating is gone')
  assert.equal(noteFor(c, 'hull'), 'Transom cracked, needs quote', 'the note is not')
  assert.equal(c.length, 1)
})

test('clearing a note keeps the rating', () => {
  let c = setRating([], 'hull', 'fair')
  c = setNote(c, 'hull', 'scuff')
  c = setNote(c, 'hull', '')
  assert.equal(ratingFor(c, 'hull'), 'fair')
  assert.equal(noteFor(c, 'hull'), null)
})

test('editing one area never disturbs another', () => {
  let c = setRating(setRating([], 'hull', 'fair'), 'motor', 'poor')
  const before = JSON.stringify(c)

  c = setNote(c, 'hull', 'starboard scuff')
  assert.equal(ratingFor(c, 'motor'), 'poor')
  assert.equal(noteFor(c, 'motor'), null)
  assert.notEqual(JSON.stringify(c), before, 'but the edited area did change')
})

test('setRating and setNote never mutate their input', () => {
  const original = [{ area: 'hull', rating: 'fair', note: 'scuff' }]
  const snapshot = JSON.stringify(original)
  setRating(original, 'hull', 'poor')
  setNote(original, 'hull', 'changed')
  setNote(original, 'motor', 'new')
  assert.equal(JSON.stringify(original), snapshot)
})

/* -------------------------------------------------------------- summary */

test('summary counts rated areas, not rows', () => {
  /* A note-only entry is a row without a rating, and must not read as checked. */
  const c = [
    ...setNote([], 'hull', 'saw something'),
    { area: 'motor', rating: 'fair', note: null },
  ]
  const text = summarise(c, 6)
  assert.match(text, /1 of 6 checked/, 'one rating, not two rows')
  assert.match(text, /worst fair/)
  assert.match(text, /1 noted/)
})

test('summary names the worst rating, which is the thing anyone opening it wants', () => {
  const c = [
    { area: 'hull', rating: 'fair', note: null },
    { area: 'motor', rating: 'damage', note: null },
    { area: 'top', rating: 'good', note: null },
  ]
  assert.match(summarise(c, 6), /worst damage/)
})

test('summary says so when nothing has been recorded', () => {
  assert.equal(summarise([], 6), 'Not yet checked')
  assert.equal(summarise(undefined, 6), 'Not yet checked')
})

test('a note with no rating is not reported as unchecked-and-fine', () => {
  const text = summarise([{ area: 'hull', rating: null, note: 'looks odd to me' }], 6)
  assert.match(text, /No areas graded/)
  assert.match(text, /1 noted/)
})

test('notes are only requested below Good', () => {
  assert.equal(needsNote('good'), false)
  assert.equal(needsNote('fair'), true)
  assert.equal(needsNote('poor'), true)
  assert.equal(needsNote('damage'), true)
  assert.equal(needsNote(null), false)
})

test('the rating scale is the four the paper card uses', () => {
  assert.deepEqual(RATINGS.map((r) => r.value), ['good', 'fair', 'poor', 'damage'])
})

/* --------------------------------------------------------- all six areas */

test('a full pass over every area behaves', () => {
  let c = []
  for (const [i, area] of AREAS.entries()) {
    const rating = ['good', 'fair', 'poor', 'damage'][i % 4]
    c = setRating(c, area, rating)
    if (rating !== 'good') c = setNote(c, area, `${area} needs attention`)
  }
  assert.equal(c.length, 6)
  assert.match(summarise(c, 6), /6 of 6 checked/)
  assert.match(summarise(c, 6), /worst damage/)

  /* Clear every rating; every note must survive. The two areas graded Good
     carried no note, so clearing leaves nothing for them and they go. */
  for (const area of AREAS) c = setRating(c, area, null)

  const withNotes = AREAS.filter((a) => c.some((e) => e.area === a))
  assert.equal(c.length, 4, 'only the areas that had a note remain')
  assert.deepEqual(withNotes, ['hull', 'upholstery', 'motor', 'lower_unit'])
  for (const area of withNotes) {
    assert.equal(noteFor(c, area), `${area} needs attention`)
  }
})