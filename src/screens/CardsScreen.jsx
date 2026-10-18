import { useMemo, useState } from 'react'
import { TopBar, SearchBar, Chip, ChipRow, ListItem, StatusPill, Fab, EmptyState, Card, Collapsible, IconButton } from '../ui'
import { useCards, useRecentCards } from '../features/card/useCard.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta, countsByStatus } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'intake', label: 'Intake' },
  { value: 'storage', label: 'Storage' },
  { value: 'service', label: 'Service' },
  { value: 'ready', label: 'Ready' },
  { value: 'invoiced', label: 'Invoiced' },
]

export default function CardsScreen({ embedded = false }) {
  const cards = useCards()
  const { navigate } = useRouter()
  const { employee } = useAuth()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const recentIds = useRecentCards(employee?.id)

  /* The count belongs on the chip: "Storage 4" answers "do I need to open
     this filter" without opening it, which is the whole value of the number. */
  const counts = useMemo(() => countsByStatus(cards), [cards])

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

  /* One boat usually holds one card, and a bubble around a single row is
     noise. A boat holding several gets a container, so its work reads as one
     group rather than as unrelated rows that happen to share a name. */
  const groups = useMemo(() => {
    const order = []
    const byBoat = new Map()
    for (const row of rows) {
      const key = row.boat?.id ?? `solo-${row.card.id}`
      if (!byBoat.has(key)) {
        byBoat.set(key, [])
        order.push(key)
      }
      byBoat.get(key).push(row)
    }
    return order.map((key) => ({
      key,
      boat: byBoat.get(key)[0].boat,
      rows: byBoat.get(key),
    }))
  }, [rows])

  /* The shortcut back to the card you were just on. It is not a search result,
     so it stands aside while the list is being filtered — "Recent" sitting
     above "Nothing matches" would be a lie about what the screen is showing.
     An id whose card has left the store (synced away, or never arrived here)
     drops out rather than rendering a dead row. */
  const recentRows = useMemo(() => {
    if (filter !== 'all' || query.trim()) return []
    const byId = new Map(rows.map((row) => [row.card.id, row]))
    return recentIds.map((id) => byId.get(id)).filter(Boolean)
  }, [recentIds, rows, query, filter])

  const renderRow = ({ card, boat, customer }) => {
    const meta = statusMeta(card.status)
    return (
      <ListItem
        key={card.id}
        tone={meta.tone}
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
  }

  if (!cards.length) {
    return (
      <div>
        {!embedded ? <TopBar title="Cards" /> : null}
        <EmptyState
          icon="cards"
          title="No cards yet"
          body="Create the first service card to start tracking work."
          action={{ label: 'New service card', icon: 'plus', onClick: () => navigate('new-card') }}
        />
      </div>
    )
  }

  return (
    <div>
      {!embedded ? (
        <TopBar
          title={`Cards · ${rows.length}`}
          actions={
            <>
              <IconButton icon="calendar" label="Schedule" onClick={() => navigate('schedule')} />
              <Fab icon="plus" aria-label="New service card" onClick={() => navigate('new-card')} />
            </>
          }
        />
      ) : null}

      <SearchBar value={query} onChange={setQuery} placeholder="Search work order, boat, customer" />
      <ChipRow>
        {FILTERS.map((f) => {
          const n = f.value === 'all' ? cards.length : counts[f.value] ?? 0
          return (
            <Chip
              key={f.value}
              selected={filter === f.value}
              tone={f.value === 'all' ? undefined : statusMeta(f.value).tone}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              <span className="chip__count">{n}</span>
            </Chip>
          )
        })}
      </ChipRow>

      {recentRows.length ? (
        <div className="recent">
          <Collapsible title="Recent" stateKey="cards.recent" count={recentRows.length} defaultOpen align="end">
            {recentRows.map(renderRow)}
          </Collapsible>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {query ? `No card matches “${query}”.` : 'No cards at this stage.'}
          </p>
        </div>
      ) : (
        <div className="list-inset" style={{ marginTop: 'var(--space-4)' }}>
          {groups.map((group) =>
            group.rows.length > 1 ? (
              <div key={group.key} style={{ marginBottom: 'var(--space-4)' }}>
                <Card variant="outlined">
                  <div className="section-head">
                    {group.boat?.name || group.boat?.model || 'Unnamed boat'} · {group.rows.length} cards
                  </div>
                  {group.rows.map(renderRow)}
                </Card>
              </div>
            ) : (
              <div key={group.key}>{group.rows.map(renderRow)}</div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
