import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { T } from './entities.js'

/*
 * Photo upload.
 *
 * Photos are online-only by decision (behaviors-sync.md §Photos). Phone
 * storage is bounded and iOS may evict offline app data after ~7 days, taking
 * queued photos with it. So there is no queue: the client refuses rather than
 * pretending a photo was saved.
 *
 * The row is written through the same metadata rules as every other entity, so
 * a photo lands in the change log and reaches other devices by delta pull.
 */

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const MAX_BYTES = 12 * 1024 * 1024

export async function storePhoto(db, { root, file, cardId, employeeId, deviceId, workLogId, caption, photoType, gps }) {
  if (!MIME_EXT[file.mimetype]) {
    return { ok: false, status: 415, reason: 'unsupported_type' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, status: 413, reason: 'payload_too_large' }
  }

  const card = await db.get(`SELECT id FROM ${T('service_cards')} WHERE id = ? AND deleted_at IS NULL`, [cardId])
  if (!card) return { ok: false, status: 404, reason: 'entity_not_found' }

  /* Client-generated id, per the sync contract: the server never allocates
     one, so a photo has a final identity before it is ever stored. */
  const id = file.filename?.replace(/\.[a-z0-9]+$/i, '') || randomUUID()
  const dir = join(root, 'uploads', cardId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${id}${MIME_EXT[file.mimetype]}`), file.buffer)

  const now = new Date().toISOString()
  const row = {
    id,
    card_id: cardId,
    work_log_id: workLogId ?? null,
    filename: `${id}${MIME_EXT[file.mimetype]}`,
    photo_type: photoType ?? 'general',
    caption: caption ?? null,
    uploaded_by: employeeId,
    uploaded_at: now,
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
  }

  await db.run(
    `INSERT INTO ${T('photos')} (id, card_id, work_log_id, filename, photo_type, caption, uploaded_by, uploaded_at, gps_lat, gps_lng, rev, version, updated_at, updated_by, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
    [row.id, row.card_id, row.work_log_id, row.filename, row.photo_type, row.caption, row.uploaded_by, row.uploaded_at, row.gps_lat, row.gps_lng, now, employeeId, deviceId],
  )

  await db.run(
    `INSERT INTO ${T('change_log')} (op_id, entity, entity_id, op, version, payload, changed_at, updated_by, device_id)
     VALUES (?, 'photos', ?, 'upsert', 1, ?, ?, ?, ?)`,
    [randomUUID(), row.id, JSON.stringify(row), now, employeeId, deviceId],
  )

  return { ok: true, photo: row }
}

export function uploadDir(root) {
  return join(root, 'uploads')
}