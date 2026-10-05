import test from 'node:test'
import assert from 'node:assert/strict'

import { assertProductionReady, hashPin, DEV_SECRET, SEED_PIN } from './db/index.js'
import { createServer } from './index.js'

/*
 * The guard that refuses to serve production with a published signing key or the
 * seeded PIN. Both are documented in the README as pre-deploy steps, and both
 * are the kind that get skipped on a deploy day.
 *
 * Exercised against a stub rather than a real MySQL, because there is no MySQL
 * to hand. What matters here is the decision, not the connection.
 */

const withEnv = async (vars, fn) => {
  const saved = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/* A database that answers exactly what the guard asks, and nothing more. */
const fakeDb = (dialect, staff = []) => ({
  dialect,
  async all() {
    return staff
  },
})

const realStaff = () => {
  const { salt, hash } = hashPin(SEED_PIN)
  return [{ id: 'emp-admin', name: 'Admin', pin_salt: salt, pin_hash: hash }]
}

const changedStaff = () => {
  const { salt, hash } = hashPin('8842')
  return [{ id: 'emp-admin', name: 'Admin', pin_salt: salt, pin_hash: hash }]
}

test('local SQLite development is never blocked', async () => {
  await withEnv({ APP_SECRET: undefined }, async () => {
    assert.deepEqual(await assertProductionReady(fakeDb('sqlite', realStaff())), [])
  })
})

test('production with no APP_SECRET is refused', async () => {
  await withEnv({ APP_SECRET: undefined }, async () => {
    const problems = await assertProductionReady(fakeDb('mysql', changedStaff()))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /APP_SECRET is unset/)
  })
})

test('production with the development secret is refused', async () => {
  await withEnv({ APP_SECRET: DEV_SECRET }, async () => {
    const problems = await assertProductionReady(fakeDb('mysql', changedStaff()))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /still the development default/)
  })
})

/*
 * The seeded-PIN check is disabled for the beta, and this asserts that on
 * purpose rather than leaving it uncovered. If someone re-enables it in
 * server/db/index.js without updating here, this fails and the decision gets
 * made deliberately instead of by accident.
 */
test('the seeded PIN is currently NOT a reason to refuse a boot', async () => {
  await withEnv({ APP_SECRET: 'a-real-secret' }, async () => {
    const problems = await assertProductionReady(fakeDb('mysql', realStaff()))
    assert.deepEqual(problems, [], '1234 is allowed through while this is a beta')
  })
})

test('the secret check still refuses, and names both failure modes', async () => {
  await withEnv({ APP_SECRET: DEV_SECRET }, async () => {
    const problems = await assertProductionReady(fakeDb('mysql', realStaff()))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /development default/)
  })

  await withEnv({ APP_SECRET: undefined }, async () => {
    const problems = await assertProductionReady(fakeDb('mysql', realStaff()))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /APP_SECRET is unset/)
  })
})

test('a properly configured production passes', async () => {
  await withEnv({ APP_SECRET: 'a-real-secret' }, async () => {
    assert.deepEqual(await assertProductionReady(fakeDb('mysql', changedStaff())), [])
  })
})

test('a staff member with no PIN set is not flagged', async () => {
  await withEnv({ APP_SECRET: 'a-real-secret' }, async () => {
    const staff = [{ id: 'emp-2', name: 'Bo', pin_salt: null, pin_hash: null }]
    assert.deepEqual(await assertProductionReady(fakeDb('mysql', staff)), [])
  })
})

/*
 * The guard is only useful if it is actually on the boot path. createServer runs
 * it for injected databases too precisely so this can be asserted — otherwise
 * the refusal would exist only in production, where it cannot be tested.
 */
test('createServer refuses to build a server on an unsafe MySQL configuration', async () => {
  await withEnv({ APP_SECRET: undefined }, async () => {
    await assert.rejects(
      createServer({ db: fakeDb('mysql', realStaff()), quiet: true }),
      (err) => {
        assert.match(err.message, /Refusing to start/)
        assert.match(err.message, /APP_SECRET is unset/)
        assert.match(err.message, /Before this touches production/)
        /* Deliberately not asserting the PIN message any more: that check is
           off for the beta. The test that pins that decision is above. */
        assert.doesNotMatch(err.message, /seeded PIN/)
        return true
      },
    )
  })
})

test('createServer builds on a MySQL config with only a weak secret and the seeded PIN', async () => {
  /* The exact state the beta is deploying in. It must boot, or nothing can be
     seen working. */
  await withEnv({ APP_SECRET: '0000' }, async () => {
    const { app } = await createServer({ db: fakeDb('mysql', realStaff()), quiet: true })
    assert.ok(app, 'a weak secret and PIN 1234 must not stop a beta boot')
  })
})

test('createServer is unaffected for local SQLite', async () => {
  await withEnv({ APP_SECRET: undefined }, async () => {
    const { app } = await createServer({ db: fakeDb('sqlite', realStaff()), quiet: true })
    assert.ok(app)
  })
})