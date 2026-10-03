import { useEffect, useState } from 'react'
import { TopBar, ListItem, KeyValue, Divider, Button, StatusPill, EmptyState } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { statusMeta } from '../domain/cardStatus.js'
import { locationSummary } from '../domain/storageLocation.js'

export default function PeopleDetailScreen({ params = {} }) {
  const { goBack, navigate } = useRouter()
  const [record, setRecord] = useState(() => store.getCustomer(params.id))

  useEffect(() => {
    const refresh = () => setRecord(store.getCustomer(params.id))
    store.subscribe(refresh)
    refresh()
    return () => store.subscribe(refresh)
  }, [params.id])

  if (!record?.customer) {
    return (
      <div>
        <TopBar title="Customer" onBack={goBack} />
        <EmptyState icon="users" title="Customer not found" />
      </div>
    )
  }

  const { customer, boats } = record
  const cards = store.cardsForCustomer(customer.id)

  return (
    <div>
      <TopBar title={customer.name} onBack={goBack} />

      <KeyValue
        rows={[
          { k: 'Phone', v: customer.phone },
          { k: 'Email', v: customer.email },
          { k: 'City', v: customer.city },
          { k: 'Boats', v: boats.length },
        ]}
      />

      <Divider />

      <div className="section-head">Boats</div>
      {!boats.length ? (
        <EmptyState icon="boat" title="No boats on file" />
      ) : (
        boats.map((b) => (
          <ListItem
            key={b.id}
            icon="boat"
            title={b.name || '(no name)'}
            support={[b.motor_type, b.model, b.licence, b.length_ft && `${b.length_ft} ft`].filter(Boolean).join(' · ')}
          />
        ))
      )}

      <Divider />

      <div className="section-head">Service history</div>
      {!cards.length ? (
        <EmptyState
          icon="cards"
          title="No cards yet"
          body="Start a service card to begin tracking work."
          action={{ label: 'New card', icon: 'plus', onClick: () => navigate('new-card') }}
        />
      ) : (
        cards.map((c) => {
          const boat = boats.find((b) => b.id === c.boat_id)
          const meta = statusMeta(c.status)
          return (
            <ListItem
              key={c.id}
              title={`${c.work_order_no} · ${boat?.name || boat?.model || 'Unnamed boat'}`}
              support={`${locationSummary(c)} · in ${c.date_in ?? '—'}`}
              onClick={() => navigate('card', { id: c.id })}
              trailing={
                <StatusPill tone={meta.tone} shape={meta.shape}>
                  {meta.label}
                </StatusPill>
              }
            />
          )
        })
      )}

      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        <Button variant="tonal" fullWidth icon="plus" onClick={() => navigate('new-card')}>
          New service card
        </Button>
      </div>
    </div>
  )
}