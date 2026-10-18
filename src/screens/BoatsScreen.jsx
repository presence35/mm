import { useEffect, useState } from 'react'
import { TopBar, SearchBar, ListItem, EmptyState, StatusPill, Fab } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta } from '../domain/cardStatus.js'
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
  const [rows, setRows] = useState(() => store.listBoats())
  const mayAdd = may(CAPABILITIES.CREATE_BOAT)

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
