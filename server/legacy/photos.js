/*
 * Photo migration.
 *
 * The legacy app stored files under data/photos/ and served them at /photos.
 * This app stores them under uploads/<cardId>/<id>.<ext> and serves them from
 * the new route, so the bytes have to move and `filename` has to be rewritten
 * to match. A row whose file is missing would render as a broken thumbnail with
 * no explanation, so files are copied before rows are written and any
 * photograph without a file is reported rather than imported as a dead link.
 *
 * Files are copied, not moved. The legacy directory is left intact so rolling
 * back to the old app still shows its photographs.
 */

import { mkdir, copyFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'

const EXT = /\.(jpe?g|png|webp|heic)$/i

export async function planPhotoCopies(legacyPhotoRows, { legacyDir, uploadsRoot }) {
  const available = new Set()
  try {
    for (const name of await readdir(legacyDir)) {
      if (EXT.test(name)) available.add(name)
    }
  } catch {
    return { copies: [], missing: legacyPhotoRows.map((r) => r.filename), available: 0 }
  }

  const copies = []
  const missing = []
  const seen = new Set()

  for (const row of legacyPhotoRows) {
    const name = String(row.filename ?? '').replace(/^'|'$/g, '')
    /* Two rows can reference one file in the legacy data. Copy once. */
    if (seen.has(name)) continue
    seen.add(name)
    /* A photo whose card did not migrate has nowhere to live. Reported rather
       than written to a stray directory nothing will ever serve. */
    if (!row.cardId) {
      missing.push(`${name} (no migrated card)`)
      continue
    }
    if (!name || !available.has(name)) {
      missing.push(name || '(empty filename)')
      continue
    }
    copies.push({ from: join(legacyDir, name), to: join(uploadsRoot, row.cardId, name) })
  }

  return { copies, missing, available: available.size }
}

export async function copyPhotos(copies) {
  let copied = 0
  for (const { from, to } of copies) {
    await mkdir(join(to, '..'), { recursive: true })
    /* Skip if already present: the migration must be safe to repeat, and
       re-copying 88 MB on a retry is both slow and pointless. */
    const done = await access(to).then(
      () => true,
      () => false,
    )
    if (done) continue
    await copyFile(from, to)
    copied++
  }
  return copied
}