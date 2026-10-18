/*
 * Which sections are open, on this phone.
 *
 * Per phone, not per worker and not per card. A section you always open is a
 * fact about how you read a card, not about the card and not about who is
 * holding the phone — and a per-card key would grow without bound, one entry
 * for every work order the marina has ever had.
 *
 * It lives in localStorage rather than the card database because it is a fact
 * about this device. Device preference must never reach the outbox, a push or
 * a conflict, and it is not worth a sync row.
 *
 * The key set is bounded by the sections that exist in the app — every key is a
 * literal at a call site — so the map stays around a dozen entries.
 *
 * Plain module, no interface: one storage here and no second implementation
 * coming. The storage is a parameter so a caller can hand in its own (tests do).
 */

const KEY = 'mm.collapse'

function deviceStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    /* Safari in private mode throws on access instead of returning null. */
    return null
  }
}

function readAll(store) {
  if (!store) return {}
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? '{}')
    /* An array or a string parses fine and is not a map of sections. */
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    /* A half-written value from a killed tab is not worth an error screen; the
       sections fall back to their defaults. */
    return {}
  }
}

export function isSectionOpen(sectionKey, fallback = false, store = deviceStorage()) {
  if (!sectionKey) return fallback
  const value = readAll(store)[sectionKey]
  return typeof value === 'boolean' ? value : fallback
}

export function rememberSection(sectionKey, open, store = deviceStorage()) {
  if (!sectionKey || !store) return
  const all = readAll(store)
  if (all[sectionKey] === open) return
  try {
    store.setItem(KEY, JSON.stringify({ ...all, [sectionKey]: open }))
  } catch {
    /* Full or unavailable storage costs the memory, not the tap. */
  }
}
