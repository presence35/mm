import { useCallback, useEffect, useState } from 'react'
import * as idb from '../../engines/store/idb.js'
import * as store from '../../engines/store/localStore.js'
import { describe, differences } from '../../domain/conflictDiff.js'

/*
 * The resolver needs both versions side by side to be usable: what this device
 * wrote, and what the server has. `transport.pullAll` attaches the server's
 * side after the pull, so an open conflict eventually shows both.
 *
 * Each conflict is also joined to the record it belongs to. "CARD" and
 * "RECEIVED ITEM" name a table; a worker needs to know *which* boat. That join
 * needs the local store, which is why it lives here and not in the screen.
 */

const DETAIL_FIELD = {
  received_items: 'item',
  work_logs: 'description',
  condition_assessment: 'area',
  authorized_work: 'service_type',
  invoice_items: 'description',
  photos: 'caption',
  appointments: 'task_type',
  boat_serials: 'serial_number',
}

function recordOf(conflict, payload) {
  if (conflict.entity === 'customers') return payload.name ?? null
  if (conflict.entity === 'boats') return payload.name ?? payload.model ?? null

  const cardId = payload.card_id ?? (conflict.entity === 'service_cards' ? conflict.entity_id : null)
  const record = cardId ? store.getCard(cardId) : null
  if (!record) return null

  const boat = record.boat?.name || record.boat?.model || 'Unnamed boat'
  return `${record.card.work_order_no} · ${boat}`
}

function detailOf(conflict, payload) {
  const field = DETAIL_FIELD[conflict.entity]
  if (!field) return null
  const value = payload[field]
  if (value === null || value === undefined || value === '') return null
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

function decorate(conflict) {
  const payload = conflict.server_payload ?? conflict.local_payload ?? {}
  return {
    ...conflict,
    type: describe(conflict.entity),
    record: recordOf(conflict, payload),
    detail: detailOf(conflict, payload),
    rows: differences(conflict),
  }
}

export function useConflicts() {
  const [conflicts, setConflicts] = useState([])

  const refresh = useCallback(async () => {
    const open = await idb.openConflicts()
    setConflicts(open.map(decorate))
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 4000)
    return () => clearInterval(timer)
  }, [refresh])

  return { conflicts, refresh }
}
