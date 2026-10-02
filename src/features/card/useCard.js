import { useCallback, useEffect, useState } from 'react'
import * as store from '../../engines/store/localStore.js'

/* Feature-level data access.
   Screens compose this; they never call the store or fetch directly. */

export function useCards() {
  const [cards, setCards] = useState(() => store.listCards())

  useEffect(() => {
    const refresh = () => setCards(store.listCards())
    return store.subscribe(refresh)
  }, [])

  return cards
}

export function useCard(id) {
  const [record, setRecord] = useState(() => (id ? store.getCard(id) : null))

  const refresh = useCallback(() => {
    setRecord(id ? store.getCard(id) : null)
  }, [id])

  // Re-read when the id changes, not just when the store mutates — otherwise
  // opening a second card keeps showing the first card's (empty) record.
  useEffect(() => {
    setRecord(id ? store.getCard(id) : null)
  }, [id])

  useEffect(() => {
    if (!id) return undefined
    return store.subscribe(refresh)
  }, [id, refresh])

  const patch = useCallback(
    (p) => {
      store.patchCard(id, p)
      refresh()
    },
    [id, refresh],
  )

  const toggleReceivedItem = useCallback(
    (item) => {
      const next = record.card.received_items.includes(item)
        ? record.card.received_items.filter((i) => i !== item)
        : [...record.card.received_items, item]
      patch({ received_items: next })
    },
    [record, patch],
  )

  const toggleAuthorized = useCallback(
    (key) => {
      store.setAuthorizedWork(id, key, { authorized: true })
      refresh()
    },
    [id, refresh],
  )

  const toggleCompleted = useCallback(
    (key) => {
      const current = record.card.authorized_work.find((w) => w.key === key)
      store.setAuthorizedWork(id, key, { completed: !current.completed })
      refresh()
    },
    [record, id, refresh],
  )

  const rate = useCallback(
    (area, rating) => {
      const existing = record.card.condition ?? []
      const found = existing.find((c) => c.area === area)
      if (rating === null) {
        patch({ condition: existing.filter((c) => c.area !== area) })
      } else if (found) {
        patch({ condition: existing.map((c) => (c.area === area ? { ...c, rating } : c)) })
      } else {
        patch({ condition: [...existing, { area, rating, note: null }] })
      }
    },
    [record, patch],
  )

  const addLog = useCallback(
    (entry) => {
      store.addLog(id, {
        id: `l-${Date.now()}`,
        employee_id: 'emp-1',
        name: 'You',
        date: new Date().toISOString().slice(0, 10),
        description: entry.description,
        transcription: null,
      })
      refresh()
    },
    [id, refresh],
  )

  return {
    record,
    patch,
    toggleReceivedItem,
    toggleAuthorized,
    toggleCompleted,
    rate,
    addLog,
  }
}