import { useEffect, useMemo, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState, StatusPill, Fab, Chip, ChipRow, IconButton } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta, statusOptions, stageFraction } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

/* A boat's card as a filter value. `none` is "no card", and a status the app
   does not recognise lands under that same chip rather than vanishing from both
   the count and the list. */
const NO_CARD = 'none'
const STAGE_VALUES = new Set(statusOptions().map((s) => s.value))
const stageOf = (card) => (card?.status && STAGE_VALUES.has(card.status) ? card.status : NO_CARD)

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
  const [filters, setFilters] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [rows, setRows] = useState(() => store.listBoats())
  const mayAdd = may(CAPABILITIES.CREATE_BOAT)

  useEffect(() => {
    const refresh = () => setRows(store.listBoats())
    return store.subscribe(refresh)
  }, [])

  /* The stages a card can be in, offered the same way the Cards list offers
     them, plus the boats that have no card at all — a boat can be on file
     before anyone has written one. Counted over the boats, not the cards, and
     from the same `stageOf` the list filters by, so a chip's number and the
     rows it shows can never disagree. */
  const filterOptions = useMemo(() => {
    const counts = Object.fromEntries([...STAGE_VALUES, NO_CARD].map((value) => [value, 0]))
    for (const row of rows) counts[stageOf(row.card)] += 1
    return [
      ...statusOptions().map((s) => ({ ...s, count: counts[s.value] ?? 0 })),
      { value: NO_CARD, label: 'No card', count: counts[NO_CARD] },
    ]
  }, [rows])

  const toggleFilter = (value) =>
    setFilters((on) => (on.includes(value) ? on.filter((v) => v !== value) : [...on, value]))

  /* Nothing chosen and everything chosen show the same list, so `All` is on in
     both and tapping it flips between them. */
  const allOn = filters.length === filterOptions.length
  const filtered = filters.length > 0 && !allOn

  const q = query.trim().toLowerCase()
  const shown = rows.filter(({ boat, customer, card }) => {
    if (filters.length && !filters.includes(stageOf(card))) return false
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
      <div className="search-row">
        <SearchBar value={query} onChange={setQuery} placeholder="Search name, model, licence, owner" />
        <IconButton
          icon="filter"
          className={filtered ? 'filter-btn--on' : undefined}
          filled={filtered}
          aria-expanded={filtersOpen}
          label={filtered ? `Filters: ${filters.length} on` : 'Filter by stage'}
          onClick={() => setFiltersOpen((open) => !open)}
        />
      </div>

      {filtersOpen ? (
        <ChipRow className="chip-row--flush">
          <Chip
            selected={!filtered}
            onClick={() => setFilters(filtered ? [] : filterOptions.map((o) => o.value))}
          >
            All
            <span className="chip__count">{rows.length}</span>
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

      {!shown.length ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {q ? `No boat matches “${query.trim()}”.` : 'No boat is in those stages.'}
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
                  <StatusPill tone={meta.tone} variant="quiet" progress={stageFraction(card.status)}>
                    {meta.label}
                  </StatusPill>
                ) : (
                  <StatusPill tone="neutral" variant="quiet">
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
