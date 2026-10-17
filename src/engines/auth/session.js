import * as store from '../store/localStore.js'

/*
 * Who this device belongs to.
 *
 * The session token and the remembered employee id live in the same storage —
 * localStorage when the sign-in screen's "keep me signed in" box is ticked,
 * sessionStorage when it is not — and the roster says who that person is and
 * what they may do. Neither is enough alone, so the identity is resolved from
 * both. It owns both storage keys because the two must never land in different
 * stores: a token that outlives its identity (or the reverse) reads as the app
 * having forgotten you.
 *
 * Its own module because two unrelated things need it and neither should import
 * the other: the sign-in screen writes it, the auth provider reads it.
 */

export const EMPLOYEE_KEY = 'mm.employee'
export const TOKEN_KEY = 'mm.token'

/* Both keys ride the same store the "keep me signed in" checkbox chose at
   sign-in: localStorage means the device keeps the session for 30 days;
   sessionStorage means the session dies with the tab and offline unlock is
   unavailable (it needs the cached token). Writes go to one store and scrub
   the other, so a device can never be half-persisted. */
function readKey(key) {
  try {
    const v = localStorage.getItem(key)
    if (v != null) return v
  } catch {
    /* private mode — fall through */
  }
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key, value, { persist }) {
  const primary = persist ? localStorage : null
  const other = persist ? null : sessionStorage
  /* Clearing removes from every store; writing puts it in exactly one, so a
     device can never be half-persisted. */
  for (const s of [other, primary]) {
    try {
      s?.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  if (value == null) return true
  try {
    primary?.setItem(key, value)
    return true
  } catch {
    /* private mode: the session lasts this page only */
  }
  try {
    sessionStorage?.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function rememberedEmployeeId() {
  /* localStorage first, then sessionStorage: whichever holds the identity. */
  return readKey(EMPLOYEE_KEY)
}

export function rememberEmployeeId(id, { persist = true } = {}) {
  return writeKey(EMPLOYEE_KEY, id, { persist })
}

export function readToken() {
  return readKey(TOKEN_KEY)
}

export function writeToken(token, { persist }) {
  return writeKey(TOKEN_KEY, token, { persist })
}

export function forgetToken() {
  return writeKey(TOKEN_KEY, null, { persist: true })
}

/*
 * Resolves the remembered id against the current roster.
 *
 * Returns null when there is nothing remembered, or when the remembered person is
 * not on the roster — which is the correct answer, not a failure to look up. A
 * device whose roster has not synced yet falls back to the server's seed, so the
 * common case resolves; anything else must sign in again rather than be
 * assumed.
 */
export function resolveRemembered() {
  const id = rememberedEmployeeId()
  if (!id) return null
  return store.listStaff().find((e) => e.id === id) ?? null
}