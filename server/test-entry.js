/*
 * Sandbox-aware test entry. Some hosts (GoDaddy's build container) forbid all
 * TCP binds, which kills the 66 networked tests with EACCES. Rather than fail
 * the build there, probe one loopback bind up front: if it works, run the
 * full suite; if not, run the unit subset. File lists stay in package.json
 * (`test:full`, `test:unit`) so there is exactly one source of truth.
 *
 * TEST_FORCE_UNIT=1 runs the subset anywhere — used to verify this fallback
 * on machines where binds work.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const files = (script) => pkg.scripts[script].replace(/^node --test\s+/, '').split(/\s+/)

function canBind() {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.once('error', () => resolve(false))
    probe.listen(0, '127.0.0.1')
  })
}

const list = process.env.TEST_FORCE_UNIT || !(await canBind()) ? 'test:unit' : 'test:full'
if (list === 'test:unit') {
  console.log('TCP binds unavailable: running unit subset (see test:unit). Full suite runs where binds work.')
}
const result = spawnSync(process.execPath, ['--test', ...files(list)], { stdio: 'inherit' })
process.exit(result.status ?? 1)
