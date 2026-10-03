import { REFERENCE } from './entities.js'

/*
 * Reference data is server-owned so the marina can change its physical layout
 * or its checklist wording without an app release.
 *
 * Served from an explicit `expose` allow-list, never SELECT *. Employees carry
 * PIN hashes in the same table they are listed in, so a wildcard here would
 * hand every client a credential — the same discipline as the public card
 * endpoint.
 */

export async function referenceSnapshot(db) {
  const out = {}
  for (const [entity, spec] of Object.entries(REFERENCE)) {
    const cols = spec.expose ?? [spec.pk]
    const rows = await db.all(
      `SELECT ${cols.join(', ')} FROM ${spec.table} WHERE ${spec.pk} IS NOT NULL`,
    )
    out[entity] = rows.map((row) => {
      const o = {}
      for (const c of cols) o[c] = row[c] ?? null
      return o
    })
  }
  return out
}