/*
 * Set a PIN from the command line.
 *
 *   node server/set-pin.js <employee_id> <pin>
 *   npm run set:pin -- emp-admin 5581
 *
 * The README used to say "update the row in employees", which means computing a
 * scrypt hash by hand in phpMyAdmin. Nobody does that, and getting it wrong
 * locks everyone out of their own accounts.
 *
 * Uses the same hashPin the sign-in path verifies against, so there is no second
 * implementation to disagree with. Deliberately a script rather than a route: a
 * PIN change is a break-glass operation, and the person who can run node on the
 * host is not the person who needs it on a phone.
 *
 * Refuses to leave an account with no PIN, and prints nothing that could be
 * mistaken for the PIN itself.
 */

import { createDb } from './db/index.js'
import { hashPin, verifyPin } from './db/index.js'
import { T } from './entities.js'

const [, , employeeId, pin] = process.argv

if (!employeeId || !pin) {
  console.error('usage: node server/set-pin.js <employee_id> <pin>')
  process.exit(2)
}

if (!/^\d{4,12}$/.test(pin)) {
  console.error('A PIN is 4 to 12 digits.')
  process.exit(2)
}

const db = createDb()

const person = await db.get(
  `SELECT id, name, role, active, pin_salt, pin_hash FROM ${T('employees')} WHERE id = ?`,
  [employeeId],
)

if (!person) {
  console.error(`No such employee: ${employeeId}`)
  const everyone = await db.all(
    `SELECT id, name, role FROM ${T('employees')} WHERE deleted_at IS NULL ORDER BY created_at ASC`,
  )
  if (everyone.length) {
    console.error('On file:')
    for (const e of everyone) console.error(`  ${e.id}  ${e.name} (${e.role})`)
  }
  await db.close?.()
  process.exit(1)
}

if (!person.active) {
  console.error(`${person.name} is deactivated. Activate them first.`)
  await db.close?.()
  process.exit(1)
}

if (pin === '1234') {
  /* The seeded PIN. Refusing it is the point of the production boot guard, and
     changing it to the thing the guard is looking for would defeat it. */
  console.error('That is the seeded PIN. Pick something else.')
  await db.close?.()
  process.exit(1)
}

const { salt, hash } = hashPin(pin)

/* Verified against the value about to be written, rather than trusted from
   hashPin's return. A silent mismatch here locks the account out. */
if (!verifyPin(pin, salt, hash)) {
  console.error('Hashing failed: the new PIN does not verify against its own hash. Nothing written.')
  await db.close?.()
  process.exit(1)
}

const now = new Date().toISOString()
await db.run(
  `UPDATE ${T('employees')} SET pin_salt = ?, pin_hash = ?, updated_at = ?, updated_by = ?,
     device_id = 'server', version = version + 1 WHERE id = ?`,
  [salt, hash, now, employeeId, employeeId],
)

/*
 * Logged like any other change so other devices pick the new state up on their
 * next pull. The payload goes through rowToPayload, which is what keeps the hash
 * out of the change log.
 */
const { rowToPayload } = await import('./sync.js')
const { randomUUID } = await import('node:crypto')
const updated = await db.get(`SELECT * FROM ${T('employees')} WHERE id = ?`, [employeeId])
await db.run(
  `INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
   VALUES (?, 'employees', ?, 'upsert', ?, ?, ?, ?, 'server')`,
  [randomUUID(), employeeId, Number(updated.version) || 1, JSON.stringify(rowToPayload('employees', updated)), now, employeeId],
)

console.log(`PIN changed for ${person.name} (${person.role}).`)
console.log('They use the new PIN the next time they sign in. Existing sessions stay valid until they expire.')

await db.close?.()
