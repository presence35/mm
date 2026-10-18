import { useEffect, useMemo, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState, StatusPill, Fab, Chip, ChipRow, IconButton, FilterSheet } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta, statusOptions } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

/*
 * Every boat on file, searchable.
 *
 * A row opens the boat itself. It used to open the boat's open card, which
 * meant the boat's own screen — serial numbers, length, who it is assigned to
 * — was reachable only by first finding that card in the list. The boat is
 * what a mechanic has in front of them, and the card, the owner and the
 * storage location all hang off it; the boat screen links to its card in one
 * tap, so the card is no further away than it was.
 *
 * Adding a boat is the "plus". A boat could otherwise only come into being as
 * a side effect of writing a card, which is the wrong way round for a yard
 * that takes a boat into storage before anyone works on it.
 */

export default function BoatsScreen() {
  const { navigate } = useRouter()
  const { may } = useAuth()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [rows, setRows] = useState(() => store.listBoats())
  const mayAdd = may(CAPABILITIES.CREATE_BOAT)

  useEffect(() => {
    const refresh = () => setRows(store.listBoats())
    return store.subscribe(refresh)
  }, [])

  /* The stages a card can be in, offered the same way the Cards list offers
     them, plus the boats that have no card at all — a boat can be on file
     before anyone has written one. Counted over the boats, not the cards. */
  const filterOptions = useMemo(() => {
    const counts = Object.fromEntries(statusOptions().map((s) => [s.value, 0]))
    let noCard = 0
    for (const row of rows) {
      const key = row.card?.status
      if (!key || !(key in counts)) noCard += 1
      else counts[key] += 1
    }
    return [
      { value: 'all', label: 'All', count: rows.length },
      ...statusOptions().map((s) => ({ ...s, count: counts[s.value] ?? 0 })),
      { value: 'none', label: 'No card', shape: 'square', count: noCard },
    ]
  }, [rows])

  const activeFilter = filterOptions.find((o) => o.value === filter) ?? filterOptions[0]

  const q = query.trim().toLowerCase()
  const matchesFilter = (card) => {
    if (filter === 'all') return true
    if (filter === 'none') return !card
    return card?.status === filter
  }
  const shown = rows.filter(({ boat, customer, card }) => {
    if (!matchesFilter(card)) return false
    if (!q) return true
    return [boat.name, boat.model, boat.motor_type, boat.licence, customer?.name]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
  })

  const open = (row) => navigate('boat', { id: row.boat.id })

  if (!rows.length) {
    return (
      <div>
        <TopBar
          title="Boats"
          actions={mayAdd ? <Fab icon="plus" aria-label="Add a boat" onClick={() => navigate('new-boat')} /> : undefined}
        />
        <EmptyState
          icon="boat"
          title="No boats yet"
          body="A boat arrives with its first service card — or add one now to have it on file first."
          action={mayAdd ? { label: 'Add a boat', icon: 'plus', onClick: () => navigate('new-boat') } : undefined}
        />
      </div>
    )
  }

  return (
    <div>
      <TopBar
        title={`Boats · ${shown.length}`}
        actions={mayAdd ? <Fab icon="plus" aria-label="Add a boat" onClick={() => navigate('new-boat')} /> : undefined}
      />
      <SearchBar
        className="search-bar--flush"
        value={query}
        onChange={setQuery}
        placeholder="Search name, model, licence, owner"
        trailing={
          <IconButton
            icon="filter"
            label={activeFilter.value === 'all' ? 'Filter by stage' : `Showing ${activeFilter.label}`}
            onClick={() => setFilterOpen(true)}
          />
        }
      />

      {activeFilter.value === 'all' ? null : (
        <ChipRow className="chip-row--flush">
          <Chip
            icon="close"
            tone={activeFilter.tone}
            aria-label={`Clear the ${activeFilter.label} filter`}
            onClick={() => setFilter('all')}
          >
            {activeFilter.label}
            <span className="chip__count">{activeFilter.count}</span>
          </Chip>
        </ChipRow>
      )}

      <FilterSheet
        open={filterOpen}
        title="Show stage"
        options={filterOptions}
        value={filter}
        onSelect={(value) => {
          setFilter(value)
          setFilterOpen(false)
        }}
        onDismiss={() => setFilterOpen(false)}
      />

      {!shown.length ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {q ? `No boat matches “${query.trim()}”.` : `No boat is in ${activeFilter.label}.`}
          </p>
        </div>
      ) : (
        shown.map((row) => {
          const { boat, customer, card } = row
          const meta = card ? statusMeta(card.status) : null
          return (
            <ListItem
              key={boat.id}
              icon="boat"
              tone={meta?.tone}
              title={boat.name || boat.model || 'Unnamed boat'}
              support={[
                [boat.model, boat.motor_type].filter(Boolean).join(' · '),
                card ? locationSummary(card) : 'No location',
                customer?.name,
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => open(row)}
              trailing={
                meta ? (
                  <StatusPill tone={meta.tone} shape={meta.shape}>
                    {meta.label}
                  </StatusPill>
                ) : (
                  <StatusPill tone="neutral" shape="square">
                    No card
                  </StatusPill>
                )
              }
            />
          )
        })
      )}
    </div>
  )
}
