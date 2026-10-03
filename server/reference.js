import { REFERENCE } from './entities.js'

/*
 * Reference data is server-owned so the marina can change its physical layout
 * or its checklist wording without an app release. It ships in the same stream
 * as everything else, under the same metadata rules, but it is pulled whole
 * rather than delta-synced — it is small and changes rarely.
 */

export async function referenceSnapshot(db) {
  const out = {}
  for (const [entity, spec] of Object.entries(REFERENCE)) {
    const rows = await db.all(`SELECT * FROM ${spec.table} WHERE deleted_at IS NULL`)
    out[entity] = rows.map((row) => {
      const o = {}
      for (const c of [spec.pk, ...spec.columns]) o[c] = row[c] ?? null
      return o
    })
  }
  return out
}