import { useEffect, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState, StatusPill } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

/*
 * Every boat on file, searchable.
 *
 * A row opens the boat's card — the one that is neither invoiced nor archived —
 * and falls back to the owner when the boat has no open card, which is the
 * legacy behaviour and the reason the list is useful in the yard: the boat is
 * what a mechanic has in front of them, not the work order number.
 *
 * Editing the boat itself is not behind the row. A row that both opens a card
 * and hides an Edit button puts a second button inside a button, which is
 * invalid and unusable by keyboard and screen reader alike; the boat's own
 * screen is reached from the card it belongs to instead.
 */

export default function BoatsScreen() {
  const { navigate } = useRouter()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState(() => store.listBoats())

  useEffect(() => {
    const refresh = () => setRows(store.listBoats())
    return store.subscribe(refresh)
  }, [])

  const q = query.trim().toLowerCase()
  const shown = rows.filter(({ boat, customer }) =>
    !q
      ? true
      : [boat.name, boat.model, boat.motor_type, boat.licence, customer?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
  )

  const open = ({ customer, card }) => {
    if (card) navigate('card', { id: card.id })
    else if (customer) navigate('people-detail', { id: customer.id })
  }

  if (!rows.length) {
    return (
      <div>
        <TopBar title="Boats" />
        <EmptyState icon="boat" title="No boats yet" body="Boats appear here once a card is created for one." />
      </div>
    )
  }

  return (
    <div>
      <TopBar title={`Boats · ${shown.length}`} />
      <SearchBar value={query} onChange={setQuery} placeholder="Search name, model, licence, owner" />

      {!shown.length ? (
        <div className="state-view">
          <p className="state-view__title">Nothing matches</p>
          <p className="state-view__body">No boat matches “{query.trim()}”.</p>
        </div>
      ) : (
        shown.map((row) => {
          const { boat, customer, card } = row
          const meta = card ? statusMeta(card.status) : null
          return (
            <ListItem
              key={boat.id}
              icon="boat"
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
