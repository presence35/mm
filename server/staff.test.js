import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createServer, makePinThrottle } from './index.js'
import { bootstrap } from './db/index.js'
import { sqliteDriver } from './db/driver.js'
import { FULL_DDL } from './schema.js'
import { T } from './entities.js'
import { validatePin, createStaff } from './staff.js'

/*
 * Staff and credentials.
 *
 * The properties worth asserting are the boundaries, not the happy path: who
 * may do what, and that a credential never crosses the wire in either
 * direction.
 */

const ADMIN_PIN = '1234'

async function boot(options = {}) {
  const db = sqliteDriver(join(mkdtempSync(join(tmpdir(), 'mm-staff-')), 't.db'))
  db.exec(FULL_DDL)
  await bootstrap(db, () => {})
  const { app } = await createServer({ db, quiet: true, ...options })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  server.unref()
  const base = `http://127.0.0.1:${server.address().port}`

  /* employee_id is required in practice. Without it the server authenticates
     the first active employee on file, which means only one person could ever
     use the app — the flaw the sign-in screen now prevents. */
  const signIn = async (pin = ADMIN_PIN, employeeId = 'emp-admin') => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, employee_id: employeeId }),
    })
    return (await res.json()).token
  }

  const login = async (pin, employeeId) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, employee_id: employeeId }),
    })
    return { status: res.status, body: await res.json() }
  }

  return { db, base, server, signIn, login }
}

const post = (base, path, token, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

/* ------------------------------------------------------------- validation */

test('a PIN is four to twelve digits, and says why', () => {
  assert.equal(validatePin('1234'), null)
  assert.equal(validatePin('123456789012'), null)
  assert.equal(validatePin('123'), 'pin_too_short')
  assert.equal(validatePin('1234567890123'), 'pin_too_short')
  assert.equal(validatePin('abcd'), 'pin_not_numeric')
  assert.equal(validatePin(''), 'pin_too_short')
  assert.equal(validatePin(undefined), 'pin_required')
  assert.equal(validatePin(1234), 'pin_required', 'a number is not a PIN')
})

/* ------------------------------------------------------------ own change */

test('anyone signed in can change their own PIN', async () => {
  const { base, server, db, signIn } = await boot()
  const token = await signIn()

  const res = await post(base, '/api/auth/pin', token, { current_pin: ADMIN_PIN, new_pin: '5581' })
  assert.equal(res.status, 200)
  await res.json()

  const old = await post(base, '/api/auth/pin', token, { current_pin: ADMIN_PIN, new_pin: '9999' })
  assert.equal(old.status, 401, 'the old PIN no longer works')

  const fresh = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '5581' }),
  })
  assert.equal(fresh.status, 200, 'the new one does')

  server.close()
  await db.close?.()
})

/* The throttle is per person, not per connection, and it clears itself. Both
   properties are the fix for a lockout that had no window and was keyed on IP:
   twenty-one misses then a long wait, and one person's misses never touching
   anyone else's allowance. */
test('wrong PINs are throttled per person, and the window clears itself', async () => {
  let clock = 1_000_000
  const throttle = makePinThrottle({ now: () => clock })
  const { base, server, db, login } = await boot({ throttle })

  for (let i = 0; i < 21; i += 1) {
    const miss = await login('9999', 'emp-admin')
    assert.equal(miss.status, 401, `guess ${i + 1} is a plain rejection`)
  }

  const throttled = await login('9999', 'emp-admin')
  assert.equal(throttled.status, 429, 'the twenty-second guess in the window is refused')
  assert.ok(throttled.body.error)

  /* Someone else signing in is unaffected: this is the shared-proxy case that
     locked the whole crew out. */
  const added = await createStaff(db, {
    name: 'Sam Reyes',
    role: 'mechanic',
    pin: '4477',
    actorId: 'emp-admin',
  })
  assert.equal(added.ok, true, added.reason)
  const other = await login('4477', added.employee.id)
  assert.equal(other.status, 200, "another person's allowance is their own")

  clock += 420_000
  const afterWindow = await login(ADMIN_PIN, 'emp-admin')
  assert.equal(afterWindow.status, 200, 'the window clears itself, correct PIN and all')

  server.close()
  await db.close?.()
})

test('a success clears the rest of the window', () => {
  const throttle = makePinThrottle({ now: () => 0 })
  for (let i = 0; i < 20; i += 1) assert.equal(throttle.take('emp-admin'), true)
  assert.equal(throttle.take('emp-admin'), true, 'twenty-one is still allowed')
  assert.equal(throttle.take('emp-admin'), false)

  throttle.clear('emp-admin')
  assert.equal(throttle.take('emp-admin'), true, 'signing in resets the count')
})

test('signing in leaves no attempt row behind', async () => {
  const { base, server, db, login } = await boot()
  await login('9999', 'emp-admin')
  const right = await login(ADMIN_PIN, 'emp-admin')
  assert.equal(right.status, 200)
  const rows = await db.all(`SELECT * FROM ${T('login_attempts')} WHERE employee_id = ?`, ['emp-admin'])
  assert.deepEqual(rows, [])
  server.close()
  await db.close?.()
})

test('changing your PIN requires knowing the current one', async () => {
  const { base, server, db, signIn } = await boot()
  const token = await signIn()

  const res = await post(base, '/api/auth/pin', token, { current_pin: '0000', new_pin: '5581' })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'current_pin_incorrect')

  const still = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: ADMIN_PIN }),
  })
  assert.equal(still.status, 200, 'the account was not taken over')

  server.close()
  await db.close?.()
})

test('the new PIN is validated before the old one is checked', async () => {
  const { base, server, db, signIn } = await boot()
  const res = await post(base, '/api/auth/pin', await signIn(), { current_pin: 'nope', new_pin: 'ab' })
  assert.equal((await res.json()).error, 'pin_too_short')
  server.close()
  await db.close?.()
})

test('a PIN change is refused when it changes nothing', async () => {
  const { base, server, db, signIn } = await boot()
  const res = await post(base, '/api/auth/pin', await signIn(), { current_pin: ADMIN_PIN, new_pin: ADMIN_PIN })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error, 'pin_unchanged')
  server.close()
  await db.close?.()
})

test('a PIN change never returns the hash', async () => {
  const { base, server, db, signIn } = await boot()
  const res = await post(base, '/api/auth/pin', await signIn(), { current_pin: ADMIN_PIN, new_pin: '5581' })
  const body = await res.text()
  assert.ok(!body.includes('pin_hash'))
  assert.ok(!body.includes('pin_salt'))
  server.close()
  await db.close?.()
})

/* -------------------------------------------------------------- creation */

test('an admin can add staff, and the response carries no credential', async () => {
  const { base, server, db, signIn, login } = await boot()
  const token = await signIn()

  const res = await post(base, '/api/employees', token, { name: 'Rin Oyelaran', role: 'mechanic', pin: '4417' })
  assert.equal(res.status, 201)
  const { employee } = await res.json()

  assert.equal(employee.name, 'Rin Oyelaran')
  assert.equal(employee.role, 'mechanic')
  assert.equal(employee.initials, 'RO', 'derived from the name, not typed twice')
  assert.ok(!('pin_hash' in employee), 'no hash in the response')
  assert.ok(!('pin_salt' in employee), 'no salt in the response')

  /* And the new person can sign in as themselves — not as whoever is first. */
  const asRin = await login('4417', employee.id)
  assert.equal(asRin.status, 200)
  assert.equal(asRin.body.employee.role, 'mechanic')

  server.close()
  await db.close?.()
})

/*
 * The flaw this whole exercise uncovered: /api/auth/login with no employee_id
 * authenticates the first active employee on file. That is not a harmless
 * default — it means a crew of mechanics all share one login, and every work
 * log is attributed to whoever was seeded first.
 */
test('signing in without naming yourself authenticates the first employee only', async () => {
  const { base, server, db, signIn, login } = await boot()
  const admin = await signIn()
  const { employee } = await (await post(base, '/api/employees', admin, { name: 'Rin Oyelaran', role: 'mechanic', pin: '4417' })).json()

  const anonymous = await login('4417')
  assert.equal(anonymous.status, 401, "Rin's PIN must not open the admin's account")

  const adminStill = await login(ADMIN_PIN)
  assert.equal(adminStill.status, 200)
  assert.equal(adminStill.body.employee.id, 'emp-admin')

  const asRin = await login('4417', employee.id)
  assert.equal(asRin.status, 200, 'naming yourself is what works')

  server.close()
  await db.close?.()
})

test('a PIN only opens its own account', async () => {
  const { base, server, db, signIn, login } = await boot()
  const admin = await signIn()
  const { employee: rin } = await (await post(base, '/api/employees', admin, { name: 'Rin', role: 'office', pin: '4417' })).json()
  const { employee: bo } = await (await post(base, '/api/employees', admin, { name: 'Bo', role: 'mechanic', pin: '5522' })).json()

  assert.equal((await login('5522', rin.id)).status, 401, "Bo's PIN must not open Rin's account")
  assert.equal((await login('4417', bo.id)).status, 401, "Rin's PIN must not open Bo's account")
  assert.equal((await login('4417', rin.id)).status, 200)
  assert.equal((await login('5522', bo.id)).status, 200)

  server.close()
  await db.close?.()
})

test('a deactivated account cannot sign in even by name', async () => {
  const { base, server, db, signIn, login } = await boot()
  const admin = await signIn()
  const { employee } = await (await post(base, '/api/employees', admin, { name: 'Rin', role: 'mechanic', pin: '4417' })).json()

  assert.equal((await login('4417', employee.id)).status, 200)
  await post(base, `/api/employees/${employee.id}/active`, admin, { active: false })
  assert.equal((await login('4417', employee.id)).status, 401)

  server.close()
  await db.close?.()
})

test('a mechanic cannot add staff, or touch anyone else', async () => {
  const { base, server, db, signIn } = await boot()
  const admin = await signIn()

  await post(base, '/api/employees', admin, { name: 'Bo Lindqvist', role: 'mechanic', pin: '4417' })
  const staff = await db.get(`SELECT id FROM ${T('employees')} WHERE name = ?`, ['Bo Lindqvist'])

  const mechanic = await signIn('4417', staff.id)

  const add = await post(base, '/api/employees', mechanic, { name: 'Mallory', role: 'admin', pin: '9999' })
  assert.equal(add.status, 403)

  const deactivate = await post(base, `/api/employees/${staff.id}/active`, mechanic, { active: false })
  assert.equal(deactivate.status, 403)

  const reset = await post(base, `/api/employees/${staff.id}/pin`, mechanic, { pin: '0000' })
  assert.equal(reset.status, 403)

  server.close()
  await db.close?.()
})

test('the role must be one of exactly three', async () => {
  const { base, server, db, signIn } = await boot()
  const token = await signIn()

  for (const [i, role] of ['admin', 'office', 'mechanic'].entries()) {
    const ok = await post(base, '/api/employees', token, { name: `T ${role}`, role, pin: `900${i}` })
    assert.equal(ok.status, 201, role)
  }

  for (const role of ['owner', 'ADMIN', '', null, 'superuser']) {
    const bad = await post(base, '/api/employees', token, { name: 'X', role, pin: '9009' })
    assert.equal(bad.status, 400, `role ${JSON.stringify(role)} must be refused`)
  }

  server.close()
  await db.close?.()
})

test('two people cannot share a PIN', async () => {
  const { base, server, db, signIn } = await boot()
  const token = await signIn()

  const first = await post(base, '/api/employees', token, { name: 'One', role: 'office', pin: '7711' })
  assert.equal(first.status, 201)

  const second = await post(base, '/api/employees', token, { name: 'Two', role: 'office', pin: '7711' })
  assert.equal(second.status, 409)
  assert.equal((await second.json()).error, 'pin_in_use')

  server.close()
  await db.close?.()
})

test('a blank name is refused', async () => {
  const { base, server, db, signIn } = await boot()
  const res = await post(base, '/api/employees', await signIn(), { name: '   ', role: 'office', pin: '7711' })
  assert.equal((await res.json()).error, 'name_required')
  server.close()
  await db.close?.()
})

/* ------------------------------------------------------- active and reset */

test('deactivating stops sign-in but keeps the history', async () => {
  const { base, server, db, signIn, login } = await boot()
  const admin = await signIn()
  const { employee } = await (await post(base, '/api/employees', admin, { name: 'Bo', role: 'mechanic', pin: '4417' })).json()

  const off = await post(base, `/api/employees/${employee.id}/active`, admin, { active: false })
  assert.equal(off.status, 200)

  /* Named explicitly: without employee_id this would authenticate the admin and
     be refused for the wrong reason. */
  const asThem = await login('4417', employee.id)
  assert.equal(asThem.status, 401, 'a deactivated account cannot get in')

  const row = await db.get(`SELECT * FROM ${T('employees')} WHERE id = ?`, [employee.id])
  assert.ok(row, 'the row survives — work logs still point at them')
  assert.equal(Number(row.active), 0)

  server.close()
  await db.close?.()
})

test('an admin can reset a forgotten PIN without knowing the old one', async () => {
  const { base, server, db, signIn, login } = await boot()
  const admin = await signIn()
  const { employee } = await (await post(base, '/api/employees', admin, { name: 'Bo', role: 'mechanic', pin: '4417' })).json()

  const res = await post(base, `/api/employees/${employee.id}/pin`, admin, { pin: '3322' })
  assert.equal(res.status, 200)

  const asBo = await login('3322', employee.id)
  assert.equal(asBo.status, 200)

  server.close()
  await db.close?.()
})

/* -------------------------------------------------------------- listing */

test('the staff list is readable and carries no credential', async () => {
  const { base, server, db, signIn } = await boot()
  const token = await signIn()
  await post(base, '/api/employees', token, { name: 'Rin Oyelaran', role: 'office', pin: '4417' })

  const res = await fetch(`${base}/api/employees`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.status, 200)
  const text = await res.text()
  const { employees } = JSON.parse(text)

  assert.equal(employees.length, 2)
  assert.ok(!text.includes('pin_hash'), 'the list must not leak credentials')
  assert.ok(!text.includes('pin_salt'))

  server.close()
  await db.close?.()
})

test('staff routes need a session', async () => {
  const { base, server, db } = await boot()

  const list = await fetch(`${base}/api/employees`)
  assert.equal(list.status, 401)

  const add = await post(base, '/api/employees', 'not-a-token', { name: 'X', role: 'admin', pin: '1234' })
  assert.equal(add.status, 401)

  const pin = await post(base, '/api/auth/pin', 'not-a-token', { current_pin: '1', new_pin: '2' })
  assert.equal(pin.status, 401)

  server.close()
  await db.close?.()
})

/* ------------------------------------------------- reaches other devices */

test('a staff change reaches other devices without the credential', async () => {
  const { base, server, db, signIn } = await boot()
  const admin = await signIn()
  await post(base, '/api/employees', admin, { name: 'Rin Oyelaran', role: 'office', pin: '4417' })

  const { pull } = await import('./sync.js')
  const { changes } = await pull(db, { cursor: 0 })

  /* Bootstrap inserts the admin directly and does not log it, so only the
     route-created account appears. That is fine: what matters is that a staff
     change reaches other devices. */
  const staff = changes.filter((c) => c.entity === 'employees')
  assert.ok(staff.length >= 1, 'the roster syncs, so assignments can resolve')
  assert.ok(!JSON.stringify(changes).includes('pin_hash'))

  const rin = staff.find((c) => c.payload.name === 'Rin Oyelaran')
  assert.equal(rin.payload.role, 'office')
  assert.equal(rin.payload.active, 1)

  server.close()
  await db.close?.()
})