import { useMemo, useState } from 'react'
import { TopBar, SearchBar, Chip, ChipRow, ListItem, StatusPill, Fab, EmptyState } from '../ui'
import { useCards } from '../features/card/useCard.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'intake', label: 'Intake' },
  { value: 'storage', label: 'In storage' },
  { value: 'service', label: 'Service' },
  { value: 'ready', label: 'Ready' },
  { value: 'invoiced', label: 'Invoiced' },
]

export default function CardsScreen({ embedded = false }) {
  const cards = useCards()
  const { navigate } = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cards
      .map((card) => {
        const boat = store.getCard(card.id)?.boat
        const customer = store.getCard(card.id)?.customer
        return { card, boat, customer }
      })
      .filter(({ card, boat, customer }) => {
        if (filter !== 'all' && card.status !== filter) return false
        if (!q) return true
        return [card.work_order_no, boat?.name, boat?.model, boat?.licence, customer?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
  }, [cards, query, filter])

  if (!cards.length) {
    return (
      <div>
        {!embedded ? <TopBar title="Cards" /> : null}
        <EmptyState
          icon="cards"
          title="No cards yet"
          body="Create the first service card to start tracking work."
          action={{ label: 'New card', icon: 'plus', onClick: () => navigate('scan') }}
        />
      </div>
    )
  }

  return (
    <div>
      {!embedded ? <TopBar title="Cards" actions={<Fab icon="plus" />} /> : null}

      <SearchBar value={query} onChange={setQuery} placeholder="Search work order, boat, customer" />
      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </ChipRow>

      {rows.length === 0 ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {query ? `No card matches “${query}”.` : 'No cards at this stage.'}
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {rows.map(({ card, boat, customer }) => {
            const meta = statusMeta(card.status)
            return (
              <ListItem
                key={card.id}
                title={`${card.work_order_no} · ${boat?.name || boat?.model || 'Unnamed boat'}`}
                support={[customer?.name, locationSummary(card)].filter(Boolean).join(' · ')}
                onClick={() => navigate('card', { id: card.id })}
                trailing={
                  <StatusPill tone={meta.tone} shape={meta.shape}>
                    {meta.label}
                  </StatusPill>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}