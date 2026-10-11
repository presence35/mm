/* Zero-dependency .env loader. Plesk's panel env section does not reliably
   reach the process on this host (diag proved every var MISSING), so a
   `.env` file at the app root is the supported way to configure production.
   Panel variables still win when present: nothing here overwrites them. */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const candidates = [join(here, '..', '.env'), join(here, '.env'), join(process.cwd(), '.env')]

for (const file of candidates) {
  let text
  try {
    if (!existsSync(file)) continue
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = val
  }
  break
}
