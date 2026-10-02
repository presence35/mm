import { useEffect, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState } from '../ui'
import * as store from '../engines/store/localStore.js'

export default function PeopleScreen() {
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState(() => store.listCustomers())

  useEffect(() => {
    const refresh = () => setCustomers(store.listCustomers())
    return store.subscribe(refresh)
  }, [])

  const q = query.trim().toLowerCase()
  const rows = customers.filter((c) => !q || [c.name, c.phone, c.email].filter(Boolean).some((v) => v.toLowerCase().includes(q)))

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
      <TopBar title="People" />
      <SearchBar value={query} onChange={setQuery} placeholder="Search name, phone, email" />
      {rows.map((c) => (
        <ListItem key={c.id} icon="users" title={c.name} support={[c.phone, c.city].filter(Boolean).join(' · ')} />
      ))}
    </div>
  )
}