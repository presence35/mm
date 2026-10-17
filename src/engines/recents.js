/*
 * Recents — the cards this worker last opened, on this device.
 *
 * Not a log, and not synced. It answers one question — "which card was I just
 * on?" — so a worker who walked away from the dock and came back does not have
 * to remember a work order number. Five entries, newest first, no repeats.
 *
 * Keyed by employee, because a shop phone gets handed around: signing in as
 * someone else must not put their cards in your list. It lives in localStorage
 * rather than the card database because it is a fact about this phone, not
 * about the marina — and device preference must never reach the outbox, a push
 * or a conflict.
 *
 * Plain module, no interface: there is one storage here and no second
 * implementation coming. Both entry points are exported so a caller can hand in
 * its own storage (the tests do).
 */

const LIMIT = 5

const EMPTY = Object.freeze([])
const listeners = new Set()

const keyFor = (employeeId) => `mm.recents.${employeeId}`

function deviceStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    /* Safari in private mode throws on access instead of returning null. */
    return null
  }
}

export function readRecents(employeeId, store = deviceStorage()) {
  if (!employeeId || !store) return EMPTY
  try {
    const parsed = JSON.parse(store.getItem(keyFor(employeeId)) ?? '[]')
    if (!Array.isArray(parsed)) return EMPTY
    return parsed.filter((id) => typeof id === 'string' && id).slice(0, LIMIT)
  } catch {
    /* A half-written value from a killed tab is not worth an error screen; the
       list regrows from the next tap. */
    return EMPTY
  }
}

export function rememberCard(employeeId, cardId, store = deviceStorage()) {
  if (!employeeId || !cardId || !store) return
  const previous = readRecents(employeeId, store)
  /* Already at the top? Nothing changed, so nothing is written: a worker
     tapping the same card twice must not wake every subscriber. */
  if (previous[0] === cardId) return
  const ids = [cardId, ...previous.filter((id) => id !== cardId)].slice(0, LIMIT)
  try {
    store.setItem(keyFor(employeeId), JSON.stringify(ids))
  } catch {
    /* Full or unavailable storage costs the shortcut, not the tap. */
    return
  }
  for (const listener of listeners) listener()
}

export function subscribeRecents(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
