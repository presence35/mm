/*
 * Reader for the legacy export.
 *
 * The export is INSERT-only: every statement names its own columns, so it is
 * self-describing and immune to the schema drift between the legacy repo's
 * schema.sql and what production actually runs. That is why there is no DDL
 * here — the dump is the authority on shape, not the old repository.
 *
 * This is deliberately a parser rather than a loader: the dump must be read
 * without a MySQL server present, because the migration is rehearsed locally
 * against SQLite before it ever meets production.
 */

const INSERT_RE = /INSERT INTO `(\w+)` \(([^)]*)\) VALUES\s*([\s\S]*?);\s*\n/g

/* Splits a VALUES body into per-row strings. Parenthesis depth, not commas,
   because a quoted caption can contain either. */
export function splitRows(body) {
  const rows = []
  let cur = ''
  let inStr = false
  let depth = 0
  for (const ch of body) {
    if (ch === "'") {
      inStr = !inStr
      cur += ch
      continue
    }
    if (!inStr) {
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          rows.push(cur)
          cur = ''
          continue
        }
      } else if (depth === 0) {
        /* Separator between rows: a comma and its newline. Dropped, so each row
           starts at its own opening paren. */
        continue
      }
    }
    cur += ch
  }
  return rows
}

/* One row to one value per column. Doubled quotes are a literal quote. */
export function splitValues(row) {
  const inner = row.trim().replace(/^\(/, '').replace(/\)$/, '')
  const out = []
  let cur = ''
  let inStr = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === "'") {
      if (inStr && inner[i + 1] === "'") {
        cur += "'"
        i++
        continue
      }
      inStr = !inStr
      cur += ch
      continue
    }
    if (!inStr && ch === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

export function unquote(v) {
  if (v === 'NULL' || v === undefined) return null
  const s = v.trim()
  if (s === 'NULL') return null
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  return s
}

/*
 * Yields { table, columns, rows } where each row is an object keyed by column.
 * Values stay as raw SQL text; coercion is the migrator's job, because only it
 * knows the target column type.
 */
export function* readInsertBlocks(sql) {
  INSERT_RE.lastIndex = 0
  let m
  while ((m = INSERT_RE.exec(sql))) {
    const columns = m[2].split(',').map((c) => c.trim().replace(/`/g, ''))
    const rows = splitRows(m[3]).map((r) => {
      const values = splitValues(r)
      /* A row with the wrong arity means the dump is not what we think it is.
         Guessing which value is missing would corrupt a customer's history. */
      if (values.length !== columns.length) {
        throw new Error(
          `${m[1]}: row has ${values.length} values for ${columns.length} columns: ${r.slice(0, 120)}`,
        )
      }
      return Object.fromEntries(columns.map((c, i) => [c, values[i]]))
    })
    yield { table: m[1], columns, rows }
  }
}

export function readTables(sql) {
  const out = new Map()
  for (const block of readInsertBlocks(sql)) {
    /* One block per table in practice. If a dump ever splits a table across
       two statements, appending is correct and overwriting would not be. */
    const prior = out.get(block.table)
    out.set(block.table, prior ? { columns: block.columns, rows: [...prior.rows, ...block.rows] } : block)
  }
  return out
}