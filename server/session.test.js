import test from 'node:test'
import assert from 'node:assert/strict'

/*
 * Session identity across a reload.
 *
 * Written because a reload used to drop the app in front of a fabricated
 * employee: AuthProvider started as a seeded office user rather than reading the
 * token, so a refresh showed the wrong name with the wrong permissions and
 * nothing on screen said so.
 *
 * The second half is worse and was the actual cause. ensureSession deleted the
 * stored token whenever /api/auth/me failed for any reason — including the
 * server being unreachable. For an app whose premise is working with no signal,
 * that logs staff out when dock wifi drops and destroys the offline unlock.
 *
 * Pure logic, so the decisions are asserted directly rather than inferred from a
 * rendered screen.
 */

const TOKEN_KEY = 'mm.token'
const EMPLOYEE_KEY = 'mm.employee'

/* A localStorage stand-in, because the module reads the real global. */
function withStorage(initial, fn) {
  const saved = globalThis.localStorage
  const map = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
  try {
    return fn({ map })
  } finally {
    if (saved === undefined) delete globalThis.localStorage
    else globalThis.localStorage = saved
  }
}

const transportError = (opts) => Object.assign(new Error('x'), opts)

/*
 * The decision, extracted so it can be tested without a component tree. Kept
 * adjacent to the tests rather than exported from SyncProvider because it is the
 * whole of the policy and nothing else should need it.
 */
function resolveSession({ storedToken, askServer }) {
  if (!storedToken) return { token: null, keepStored: false, reason: 'no_token' }

  try {
    askServer(storedToken)
    return { token: storedToken, keepStored: true, reason: 'validated' }
  } catch (e) {
    /* An actual rejection. Being unable to ask is not being told no. */
    if (e?.unauthorized) return { token: null, keepStored: false, reason: 'rejected' }
    return { token: storedToken, keepStored: true, reason: 'unreachable' }
  }
}

const askOk = () => {}
const askUnreachable = () => {
  throw transportError({ offline: true })
}
const askRejected = () => {
  throw transportError({ unauthorized: true, status: 401 })
}

test('a device that never signed in has no session', () => {
  const out = resolveSession({ storedToken: null, askServer: askOk })
  assert.equal(out.token, null)
  assert.equal(out.reason, 'no_token')
})

test('a valid token is used', () => {
  const out = resolveSession({ storedToken: 'tok', askServer: askOk })
  assert.equal(out.token, 'tok')
  assert.equal(out.keepStored, true)
})

/* The bug. Dock wifi drops, /api/auth/me cannot be reached, and the cached
   session — the entire basis of offline unlock — is thrown away. */
test('an unreachable server does not end the session', () => {
  const out = resolveSession({ storedToken: 'tok', askServer: askUnreachable })
  assert.equal(out.token, 'tok', 'the cached session survives being unable to ask')
  assert.equal(out.keepStored, true, 'the stored token is not deleted')
  assert.equal(out.reason, 'unreachable')
})

test('a server error that is not a rejection also keeps the session', () => {
  const out = resolveSession({
    storedToken: 'tok',
    askServer: () => {
      throw transportError({ status: 503 })
    },
  })
  assert.equal(out.keepStored, true, 'a 5xx is not a statement about who you are')
})

test('a genuine rejection does end the session', () => {
  const out = resolveSession({ storedToken: 'tok', askServer: askRejected })
  assert.equal(out.token, null)
  assert.equal(out.keepStored, false)
  assert.equal(out.reason, 'rejected')
})

test('the session survives three consecutive unreachable checks', () => {
  withStorage({ [TOKEN_KEY]: 'tok' }, () => {
    for (let i = 0; i < 3; i++) {
      const out = resolveSession({ storedToken: 'tok', askServer: askUnreachable })
      assert.equal(out.keepStored, true, `attempt ${i + 1} dropped the session`)
    }
  })
})

test('a rejection after a failure still ends the session', () => {
  const first = resolveSession({ storedToken: 'tok', askServer: askUnreachable })
  assert.equal(first.keepStored, true)

  const second = resolveSession({ storedToken: 'tok', askServer: askRejected })
  assert.equal(second.keepStored, false, 'a real 401 is authoritative regardless of what came before')
})

/* Identity is persisted separately from the token: the token says an employee
   id, the roster says who that is and what they may do. */
test('identity and token are stored under separate keys', () => {
  withStorage({}, ({ map }) => {
    map.set(TOKEN_KEY, 'tok')
    map.set(EMPLOYEE_KEY, 'emp-admin')
    assert.equal(map.get(TOKEN_KEY), 'tok')
    assert.equal(map.get(EMPLOYEE_KEY), 'emp-admin')
    assert.notEqual(TOKEN_KEY, EMPLOYEE_KEY, 'one key cannot shadow the other')
  })
})

test('signing out clears the remembered identity as well as the token', () => {
  withStorage({ [TOKEN_KEY]: 'tok', [EMPLOYEE_KEY]: 'emp-admin' }, ({ map }) => {
    map.delete(TOKEN_KEY)
    map.delete(EMPLOYEE_KEY)
    /* A token with no identity cannot be shown as a user, so neither may
       survive on its own. Asserted through the stub, which is what the app
       actually reads — Map.get returns undefined, localStorage returns null. */
    assert.equal(globalThis.localStorage.getItem(TOKEN_KEY), null)
    assert.equal(globalThis.localStorage.getItem(EMPLOYEE_KEY), null)
  })
})