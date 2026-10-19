/*
 * Put one photo on a card, for looking at the card header's watermark.
 *
 * Development only — not registered as a route, not reachable from the app. It
 * goes through `storePhoto`, the same path an upload takes, so the file, the row
 * and the change-log entry are all real: a device picks the photo up on its next
 * pull instead of the script poking IndexedDB from the outside.
 *
 *   node server/dev-photo.js --card <cardId> --file <image> [--type intake]
 *
 * `--card` is a card that already reached the server (the app pushes on sign-in),
 * so run it after the device has synced.
 */

import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { createServer } from './index.js'
import { storePhoto } from './photos.js'
import { T } from './entities.js'

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const args = process.argv.slice(2)
const arg = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : fallback
}

const cardId = arg('card')
const source = arg('file')
const photoType = arg('type', 'intake')

if (!cardId || !source) {
  console.error('usage: node server/dev-photo.js --card <cardId> --file <image> [--type intake]')
  process.exit(1)
}

const mimetype = MIME[extname(source).toLowerCase()]
if (!mimetype) {
  console.error(`unsupported image type: ${extname(source)} (jpg, png or webp)`)
  process.exit(1)
}

const { db } = await createServer()
try {
  const card = await db.get(`SELECT id, work_order_no FROM ${T('service_cards')} WHERE id = ? AND deleted_at IS NULL`, [cardId])
  if (!card) {
    console.error(`no card ${cardId} on this server — open it on the device once so the app pushes it, then retry`)
    process.exit(2)
  }

  const employee = await db.get(`SELECT id FROM ${T('employees')} WHERE active = 1 ORDER BY role LIMIT 1`)
  if (!employee) {
    console.error('no active employee on this server')
    process.exit(2)
  }

  const buffer = await readFile(resolve(source))
  const id = `p-dev-${randomUUID()}`
  const result = await storePhoto(db, {
    root: resolve('.'),
    file: { buffer, size: buffer.length, mimetype, filename: `${id}${extname(source)}` },
    cardId,
    employeeId: employee.id,
    deviceId: 'dev-photo',
    caption: 'Development fixture',
    photoType,
  })

  if (!result.ok) {
    console.error(`storePhoto refused: ${result.status} ${result.reason}`)
    process.exit(3)
  }

  console.log(`${card.work_order_no} ← ${result.photo.filename} (${photoType}, ${buffer.length} bytes)`)
} finally {
  await db.close?.()
}
