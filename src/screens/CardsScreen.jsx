import { useMemo, useState } from 'react'
import { TopBar, SearchBar, Chip, ChipRow, ListItem, StatusPill, Fab, EmptyState, Card, IconButton } from '../ui'
import { useCards, useRecentCards } from '../features/card/useCard.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth } from '../engines/auth/AuthProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta, statusOptions, stageFraction, countsByStatus } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

export default function CardsScreen({ embedded = false }) {
  const cards = useCards()
  const { navigate } = useRouter()
  const { employee } = useAuth()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const recentIds = useRecentCards(employee?.id)

  /* Every stage is offered, in lifecycle order, from the one place stages are
     declared, and several can be on at once — a panel of toggles rather than a
     sheet you could only take one answer out of. The count on a chip is the
     number of rows in that stage, which is what makes the chip worth tapping. */
  const counts = useMemo(() => countsByStatus(cards), [cards])

  const filterOptions = useMemo(
    () => statusOptions().map((s) => ({ ...s, count: counts[s.value] ?? 0 })),
    [counts],
  )

  const toggleFilter = (value) =>
    setFilters((on) => (on.includes(value) ? on.filter((v) => v !== value) : [...on, value]))

  /* `All` is a select-all, not a "no filter" chip: it is on only when every
     stage is on, and tapping it flips between all nine and none, whatever the
     partial selection was. Nothing chosen and everything chosen narrow the same
     list, so the funnel and the Recent band read `filtered`, not the chip. */
  const allOn = filters.length === filterOptions.length
  const filtered = filters.length > 0 && !allOn

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cards
      .map((card) => {
        const boat = store.getCard(card.id)?.boat
        const customer = store.getCard(card.id)?.customer
        return { card, boat, customer }
      })
      .filter(({ card, boat, customer }) => {
        if (filters.length && !filters.includes(card.status)) return false
        if (!q) return true
        return [card.work_order_no, boat?.name, boat?.model, boat?.licence, customer?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
  }, [cards, query, filters])

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

  /* The shortcut back to the cards you were on. It is not a search result, so
     it stands aside while the list is being filtered — "Recent" sitting above
     "Nothing matches" would be a lie about what the screen is showing. A card
     that has left the store (synced away, or never arrived here) drops out
     rather than rendering a dead row. Two at most: the card just left, and the
     one before it; one would only repeat the row you tapped. */
  const recent = useMemo(() => {
    if (filtered || query.trim()) return []
    const byId = new Map(rows.map((row) => [row.card.id, row]))
    return recentIds.map((id) => byId.get(id)).filter(Boolean)
  }, [recentIds, rows, query, filtered])

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
          <StatusPill tone={meta.tone} variant="quiet" progress={stageFraction(card.status)}>
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

      <div className="search-row">
        <SearchBar value={query} onChange={setQuery} placeholder="Search work order, boat, customer" />
        <IconButton
          icon="filter"
          className={filtered ? 'filter-btn--on' : undefined}
          filled={filtered}
          aria-expanded={filtersOpen}
          label={filtered ? `Filters: ${filters.length} on` : 'Filter by stage'}
          onClick={() => setFiltersOpen((open) => !open)}
        />
      </div>

      {/* The chips are only on screen while the panel is open, so the funnel is
          the one thing that says a filter is on: it is solid and in full-strength
          ink exactly then, and its label counts them. */}
      {filtersOpen ? (
        <ChipRow className="chip-row--flush">
          <Chip
            selected={allOn}
            onClick={() => setFilters(allOn ? [] : filterOptions.map((o) => o.value))}
          >
            All
            <span className="chip__count">{cards.length}</span>
          </Chip>
          {filterOptions.map((option) => (
            <Chip
              key={option.value}
              tone={option.tone}
              selected={filters.includes(option.value)}
              onClick={() => toggleFilter(option.value)}
            >
              {option.label}
              <span className="chip__count">{option.count}</span>
            </Chip>
          ))}
        </ChipRow>
      ) : null}
      {recent.length ? (
        <div className="recent">
          <p className="recent__head">Recent</p>
          {recent.map(renderRow)}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {query ? `No card matches “${query}”.` : 'No cards at the chosen stages.'}
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
