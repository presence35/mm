import { useCallback, useEffect, useState } from 'react'
import * as idb from '../../engines/store/idb.js'

/* The resolver needs both versions side by side to be usable: what this device
   wrote, and what the server has. `transport.pullAll` attaches the server's
   side after the pull, so an open conflict eventually shows both. */

export function useConflicts() {
  const [conflicts, setConflicts] = useState([])

  const refresh = useCallback(async () => {
    setConflicts(await idb.openConflicts())
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 4000)
    return () => clearInterval(timer)
  }, [refresh])

  return { conflicts, refresh }
}

const LABELS = {
  service_cards: 'card',
  boats: 'boat',
  customers: 'customer',
  work_logs: 'log entry',
  received_items: 'received item',
  authorized_work: 'authorised work',
  condition_assessment: 'condition note',
  invoice_items: 'invoice line',
}

/* Only fields worth a human decision. Showing every column would bury the
   difference that matters. */
const INTERESTING = [
  'name', 'city', 'phone', 'email', 'postal_code', 'address',
  'motor_type', 'model', 'licence', 'trailer_licence', 'length_ft',
  'storage_type', 'storage_building', 'storage_row', 'storage_col',
  'boathouse_no', 'slip_no', 'remarks', 'other_work', 'pickup_delivery',
  'date_in', 'date_out', 'status', 'wrap_required', 'unwrap_done',
  'work_order_no', 'season_year',
]

export function describe(entity) {
  return LABELS[entity] ?? entity
}

export function differences(conflict) {
  const mine = conflict.local_payload ?? {}
  const theirs = conflict.server_payload ?? {}
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)])
  const rows = []
  for (const k of INTERESTING) {
    if (!keys.has(k)) continue
    const a = normalise(mine[k])
    const b = normalise(theirs[k])
    if (a === b) continue
    rows.push({ field: k, mine: a, theirs: b })
  }
  return rows
}

function normalise(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (v === true) return 'yes'
  if (v === false) return 'no'
  return String(v)
}