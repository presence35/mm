/*
 * The bind chain itself: first allowed address wins, base URL is real.
 * Runs wherever the suite runs, since it only needs loopback.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

import { listenTest } from './test-listen.js'

test('listenTest serves on the first allowed bind', async () => {
  const app = express()
  app.get('/ping', (req, res) => res.json({ pong: true }))
  const { server, base } = await listenTest(app)
  try {
    const res = await fetch(`${base}/ping`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { pong: true })
    assert.match(base, /^http:\/\/(\[::1\]|127\.0\.0\.1):\d+$/)
  } finally {
    server.close()
  }
})
