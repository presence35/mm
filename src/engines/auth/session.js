import * as store from '../store/localStore.js'

/*
 * Who this device belongs to.
 *
 * The session token lives in localStorage and says an employee id; the roster
 * says who that person is and what they may do. Neither is enough alone, so the
 * identity is resolved from both.
 *
 * Its own module because two unrelated things need it and neither should import
 * the other: the sign-in screen writes it, the auth provider reads it.
 */

export const EMPLOYEE_KEY = 'mm.employee'

export function rememberedEmployeeId() {
  try {
    return localStorage.getItem(EMPLOYEE_KEY)
  } catch {
    /* private mode: the session lasts this page only */
    return null
  }
}

export function rememberEmployeeId(id) {
  try {
    if (id) localStorage.setItem(EMPLOYEE_KEY, id)
    else localStorage.removeItem(EMPLOYEE_KEY)
  } catch {
    /* nothing to do; the session will not survive the page */
  }
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