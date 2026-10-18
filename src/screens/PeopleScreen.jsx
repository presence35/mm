import { useEffect, useMemo, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState, Chip, ChipRow, IconButton, FilterSheet } from '../ui'
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
  const [filter, setFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
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
    return [
      { value: 'all', label: 'All', count: people.length },
      ...STANDINGS.map((s) => ({ ...s, count: counts[s.value] ?? 0 })),
    ]
  }, [people])

  const activeFilter = filterOptions.find((o) => o.value === filter) ?? filterOptions[0]

  const q = query.trim().toLowerCase()
  const rows = people.filter(({ customer, standing }) => {
    if (filter !== 'all' && standing !== filter) return false
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
      <SearchBar
        className="search-bar--flush"
        value={query}
        onChange={setQuery}
        placeholder="Search name, phone, email"
        trailing={
          <IconButton
            icon="filter"
            label={activeFilter.value === 'all' ? 'Filter by standing' : `Showing ${activeFilter.label}`}
            onClick={() => setFilterOpen(true)}
          />
        }
      />

      {activeFilter.value === 'all' ? null : (
        <ChipRow className="chip-row--flush">
          <Chip
            icon="close"
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
        title="Show who"
        options={filterOptions}
        value={filter}
        onSelect={(value) => {
          setFilter(value)
          setFilterOpen(false)
        }}
        onDismiss={() => setFilterOpen(false)}
      />

      {!rows.length ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">
            {q ? `No one matches “${query.trim()}”.` : `No one is ${activeFilter.label.toLowerCase()}.`}
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
