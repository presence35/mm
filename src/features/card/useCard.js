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
        /* Clearing the rating must not take the note with it. Removing the row
           discarded whatever the worker had typed, which is the one thing this
           app must never lose. A note with no rating is a real state: seen,
           not gradable. */
        if (!found) return
        patch({ condition: existing.map((c) => (c.area === area ? { ...c, rating: null } : c)) })
      } else if (found) {
        patch({ condition: existing.map((c) => (c.area === area ? { ...c, rating } : c)) })
      } else {
        patch({ condition: [...existing, { area, rating, note: null }] })
      }
    },
    [record, patch],
  )

  const note = useCallback(
    (area, text) => {
      /* TextField hands over the string, not the event. Reading .target off a
         string yields undefined, and the empty-note guard below would swallow
         that and report success — a note that silently refuses to save. A
         caller that gets this wrong is a programmer error, so say so. */
      if (typeof text !== 'string') {
        throw new TypeError(`note() expects the field value as a string, got ${typeof text}`)
      }
      const existing = record.card.condition ?? []
      const found = existing.find((c) => c.area === area)
      const next = text.trim() ? text : null
      if (!next && !found?.note) return
      if (found) {
        patch({ condition: existing.map((c) => (c.area === area ? { ...c, note: next } : c)) })
      } else {
        /* A note with no rating yet. Kept rather than dropped, so the text is
           not lost if the worker types before choosing a grade. */
        patch({ condition: [...existing, { area, rating: null, note: next }] })
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
    note,
    addLog,
  }
}