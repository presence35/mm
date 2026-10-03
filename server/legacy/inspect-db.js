/*
 * Reads a migrated database back through the sync protocol and checks that the
 * joins a screen depends on actually resolve.
 *
 * Separate from the import on purpose. Importing can succeed and still be wrong
 * — a customer's boat attached to the wrong card reads back as perfectly valid
 * rows. This walks the relationships the way a phone does, through pull(), so a
 * migrated history is proven usable rather than merely present.
 *
 *   DB_FILE=./data/marina.db node server/legacy/inspect-db.js
 */
import { createDb } from '../db/index.js'
import { pull } from '../sync.js'
import { T } from '../entities.js'

const db = createDb()
const problems = []
const notes = []

/* Page to exhaustion. pull caps one response at 1000 changes, so a large limit
   does not return everything — the 1053-row migration needs two pages. */
const changes = []
let cursor = 0
for (;;) {
  const page = await pull(db, { cursor, limit: 1000 })
  changes.push(...page.changes)
  if (!page.has_more || page.cursor === cursor) break
  cursor = page.cursor
}

const byEntity = {}
for (const c of changes) {
  byEntity[c.entity] ??= []
  byEntity[c.entity].push(c.payload)
}

const rows = await db.get(
  `SELECT COUNT(*) AS n FROM ${T('service_cards')}`,
)
notes.push(`service_cards in table: ${rows.n}`)
notes.push(`changes read back: ${changes.length} (cursor ${cursor})`)

const cards = byEntity.service_cards ?? []
const boats = new Map((byEntity.boats ?? []).map((b) => [b.id, b]))
const customers = new Map((byEntity.customers ?? []).map((c) => [c.id, c]))
notes.push(`cards reachable from a phone: ${cards.length}`)

/* Card -> boat -> customer. The customer-facing view is built on this join, so
   a break here means a customer's QR shows nothing. */
for (const card of cards) {
  const boat = boats.get(card.boat_id)
  if (!boat) {
    problems.push(`card ${card.work_order_no} points at no boat`)
    continue
  }
  if (card.customer_token && !customers.has(boat.customer_id)) {
    problems.push(`public card ${card.customer_token} resolves to no customer`)
  }
}

/* Children must hang off a card that exists. */
const cardIds = new Set(cards.map((c) => c.id))
for (const entity of ['received_items', 'authorized_work', 'condition_assessment', 'status_history', 'photos', 'invoice_items']) {
  for (const row of byEntity[entity] ?? []) {
    if (row.card_id && !cardIds.has(row.card_id)) {
      problems.push(`${entity} points at a card that does not exist`)
      break
    }
  }
}

const freeText = (byEntity.authorized_work ?? []).filter((w) => String(w.service_type ?? '').includes(' '))
notes.push(`authorised work carrying free text: ${freeText.length}`)
notes.push(`photos: ${(byEntity.photos ?? []).length}, with a filename: ${(byEntity.photos ?? []).filter((p) => p.filename).length}`)
notes.push(`boats with an engine description: ${(byEntity.boats ?? []).filter((b) => b.motor_type).length}`)
notes.push(`serials: ${(byEntity.boat_serials ?? []).length}`)

for (const n of notes) console.log(`  ${n}`)
console.log(problems.length ? `\nPROBLEMS:\n${problems.map((p) => `  ${p}`).join('\n')}` : '\nno problems found')

await db.close?.()
process.exit(problems.length ? 1 : 0)