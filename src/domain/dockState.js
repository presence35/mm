/*
 * Where a customer stands this season.
 *
 * One closed set, answered once, because the People list, its filter sheet and
 * the count on each option all have to agree — and because "docked" is a word
 * two screens would otherwise define separately.
 *
 * Two questions, both from data the app already holds. A boat is in dock when
 * its current card sits on the map — the same line the Map draws, so a boat on
 * dry land or in the water reads as ashore. A season is the card's own
 * `season_year`: the app records no arrival date, so the season on the card is
 * the only season there is.
 *
 * `now` is explicit. "This season" is a question about the clock, and a
 * function that reads the clock itself cannot be tested either side of New
 * Year.
 */

import { activeCardFor } from './cardStatus.js'
import { positionCode } from './storageLocation.js'

/* Single words, because they are read as a filter, not as a sentence. */
export const STANDINGS = [
  { value: 'docked', label: 'Docked' },
  { value: 'ashore', label: 'Ashore' },
  { value: 'lapsed', label: 'Lapsed' },
  { value: 'none', label: 'None' },
]

export function seasonOf(now) {
  return now.getFullYear()
}

export function isDocked(card) {
  return Boolean(positionCode(card))
}

/* The card that says where a boat is now: its newest open one. History does not
   place a boat — an archived card from a past season is a record of a visit,
   not an answer to where the boat is. */
export function currentCards(cards) {
  const byBoat = new Map()
  for (const card of cards ?? []) {
    const key = card?.boat_id
    if (!key) continue
    byBoat.set(key, [...(byBoat.get(key) ?? []), card])
  }
  return [...byBoat.values()].map(activeCardFor).filter(Boolean)
}

export function standingOf({ boats = [], cards = [], now }) {
  if (!boats.length) return 'none'

  const boatIds = new Set(boats.map((b) => b.id))
  const mine = (cards ?? []).filter((c) => boatIds.has(c?.boat_id))

  if (currentCards(mine).some(isDocked)) return 'docked'
  /* Any card at all for this season means the boat came — invoiced and archived
     ones included, since those are the boats that have already gone home. */
  if (mine.some((c) => Number(c?.season_year) === seasonOf(now))) return 'ashore'
  return 'lapsed'
}
