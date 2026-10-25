/*
 * The HTTP edge.
 *
 * Express 4 drops the promise an async handler returns, so a rejected handler
 * was an unhandled rejection and Node ended the process — one duplicate key in
 * a query took the whole marina down, including every other phone's session.
 * The app now wraps async handlers at registration (index.js), and this proves
 * that a throw is answered rather than fatal, without needing to reproduce the
 * database fault that found it.
 *
 * A database whose `get` rejects is the smallest fault that reaches a route:
 * sign-in calls it first, and the route does nothing special with the error.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listenTest } from './test-listen.js'

/* A real temporary database: the failing method is the only substitution, so
   the schema, the seed and the session code are the shipping ones. */
process.env.DB_FILE = join(mkdtempSync(join(tmpdir(), 'mm-http-')), 'test.db')
delete process.env.DB_HOST

const { createServer } = await import('./index.js')
const { createDb, bootstrap } = await import('./db/index.js')

test('a handler that rejects is a 500, and the server is still answering', async () => {
  const db = createDb()
  await bootstrap(db)

  let poisoned = true
  const failing = {
    ...db,
    get: (...args) => (poisoned ? Promise.reject(new Error('duplicate key')) : db.get(...args)),
  }

  const { app } = await createServer({ db: failing, quiet: true })
  const { server, base } = await listenTest(app)
  server.unref()

  const login = () =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    })

  const failed = await login()
  assert.equal(failed.status, 500, 'the rejection is answered by the error middleware')
  assert.deepEqual(await failed.json(), { error: 'internal' })

  /* The same process, the same app: if the rejection had escaped, there would
     be nothing left to answer this one. */
  poisoned = false
  const alive = await login()
  assert.equal(alive.status, 200, 'the server survived the throw')
  const body = await alive.json()
  assert.ok(body.token, 'and still issues a session')

  server.close()
})
