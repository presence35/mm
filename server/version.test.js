import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { APP_VERSION, formatVersion } from '../version.js'

/*
 * The version used to be a literal in package.json that only moved when someone
 * remembered to edit it, so a deploy could land and `/api/version` would read
 * exactly as before — the one moment the number is worth anything. It is built
 * from the commit now. These pin that down without needing a repository.
 */

const BASE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

test('the version carries the commit, so it moves on every push', () => {
  assert.equal(formatVersion({ base: '1.2.3', count: '59', sha: 'ad4788f' }), '1.2.3+59.ad4788f')
})

test('a different commit is a different version', () => {
  const a = formatVersion({ base: '1.2.3', count: '59', sha: 'ad4788f' })
  const b = formatVersion({ base: '1.2.3', count: '60', sha: 'be91c04' })
  assert.notEqual(a, b)
})

test('with no git the base version is reported, never a broken suffix', () => {
  for (const missing of [
    { base: '1.2.3', count: '', sha: 'ad4788f' },
    { base: '1.2.3', count: '59', sha: '' },
    { base: '1.2.3', count: '', sha: '' },
  ]) {
    assert.equal(formatVersion(missing), '1.2.3')
  }
})

test('the running build reports a version, and it names the package version', () => {
  assert.ok(APP_VERSION.length > 0)
  assert.ok(APP_VERSION === BASE || APP_VERSION.startsWith(`${BASE}+`), `${APP_VERSION} does not begin with ${BASE}`)
})
