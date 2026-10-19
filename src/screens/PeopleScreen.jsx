import { useEffect, useMemo, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState, Chip, ChipRow, IconButton } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { STANDINGS, standingOf } from '../domain/dockState.js'

/*
 * Everyone the marina has a boat for.
 *
 * The filter is about standing, not about stages: whether a customer's boat is
 * in dock now, whether it has been here this season, or whether they have no
 * boat on file. That question is answered once, in domain/dockState.js, because
 * the row list, the filter sheet and the counts on each option all have to mean
 * the same thing by "docked".
 */
export default function PeopleScreen() {
  const { navigate } = useRouter()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customers, setCustomers] = useState(() => store.listCustomers())

  useEffect(() => {
    const refresh = () => setCustomers(store.listCustomers())
    return store.subscribe(refresh)
  }, [])

  /* Read once per visit. The season turns over once a year, and a standing is
     not worth re-deriving on every keystroke. */
  const now = useMemo(() => new Date(), [])

  /* One pass, one standing per customer: the list, the counts and the filter
     all read the same value rather than each asking their own question. */
  const people = useMemo(
    () =>
      customers.map((customer) => {
        const boats = store.boatsForCustomer(customer.id)
        return { customer, standing: standingOf({ boats, cards: store.cardsForCustomer(customer.id), now }) }
      }),
    [customers, now],
  )

  const filterOptions = useMemo(() => {
    const counts = Object.fromEntries(STANDINGS.map((s) => [s.value, 0]))
    for (const person of people) counts[person.standing] += 1
    return STANDINGS.map((s) => ({ ...s, count: counts[s.value] ?? 0 }))
  }, [people])

  const toggleFilter = (value) =>
    setFilters((on) => (on.includes(value) ? on.filter((v) => v !== value) : [...on, value]))

  /* Nothing chosen and everything chosen show the same list, so `All` is on in
     both and tapping it flips between them. */
  const allOn = filters.length === filterOptions.length
  const filtered = filters.length > 0 && !allOn

  const q = query.trim().toLowerCase()
  const rows = people.filter(({ customer, standing }) => {
    if (filters.length && !filters.includes(standing)) return false
    if (!q) return true
    return [customer.name, customer.phone, customer.email].filter(Boolean).some((v) => v.toLowerCase().includes(q))
  })

  if (!customers.length) {
    return (
      <div>
        <TopBar title="People" />
        <EmptyState icon="users" title="No customers yet" body="Customers appear here once a card is created." />
      </div>
    )
  }

  return (
    <div>
      <TopBar title={`People · ${rows.length}`} />
      <div className="search-row">
        <SearchBar value={query} onChange={setQuery} placeholder="Search name, phone, email" />
        <IconButton
          icon="filter"
          className={filtered ? 'filter-btn--on' : undefined}
          filled={filtered}
          aria-expanded={filtersOpen}
          label={filtered ? `Filters: ${filters.length} on` : 'Filter by standing'}
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
            <span className="chip__count">{people.length}</span>
          </Chip>
          {filterOptions.map((option) => (
            <Chip
              key={option.value}
              selected={filters.includes(option.value)}
              onClick={() => toggleFilter(option.value)}
            >
              {option.label}
              <span className="chip__count">{option.count}</span>
            </Chip>
          ))}
        </ChipRow>
      ) : null}

      {!rows.length ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {q ? `No one matches “${query.trim()}”.` : 'No one is in those standings.'}
          </p>
        </div>
      ) : (
        rows.map(({ customer }) => (
          <ListItem
            key={customer.id}
            icon="users"
            title={customer.name}
            support={[customer.phone, customer.city].filter(Boolean).join(' · ')}
            onClick={() => navigate('people-detail', { id: customer.id })}
          />
        ))
      )}
    </div>
  )
}
