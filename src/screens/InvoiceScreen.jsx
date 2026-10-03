import { useEffect, useState } from 'react'
import { TopBar, Button, TextField, SelectField, KeyValue, Divider, ListItem, StatusPill } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { Dialog } from '../ui'
import * as store from '../engines/store/localStore.js'

/* Invoicing is office/admin only, and per behaviours-auth.md constraint 5 it
   never queues offline — a cached permission snapshot may predate a demotion. */

const money = (n) => `$${Number(n || 0).toFixed(2)}`

export default function InvoiceScreen({ params = {} }) {
  const { goBack } = useRouter()
  const { may, refuseReason } = useAuth()
  const sync = useSync()
  const [record, setRecord] = useState(() => store.getCard(params.id))
  const [items, setItems] = useState([])
  const [blocked, setBlocked] = useState(null)

  useEffect(() => {
    const refresh = () => {
      const next = store.getCard(params.id)
      setRecord(next)
      setItems(next?.card?.invoice_items ?? [])
    }
    store.subscribe(refresh)
    refresh()
    return () => store.subscribe(refresh)
  }, [params.id])

  if (!record) {
    return (
      <div>
        <TopBar title="Invoice" onBack={goBack} />
        <div className="state-view">
          <p className="state-view__title">Card not found</p>
        </div>
      </div>
    )
  }

  const { card, boat, customer } = record
  const subtotal = items.reduce((acc, i) => acc + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
  const tax = subtotal * Number(card.tax_rate || 0)
  const total = subtotal + tax

  const update = (i, patch) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    setItems(next)
    store.patchCard(card.id, { invoice_items: next })
  }

  const issue = () => {
    const number = card.invoice_number || `INV-${String(Date.now()).slice(-5)}`
    store.patchCard(card.id, {
      invoice_number: number,
      invoice_status: 'issued',
      status: 'invoiced',
      invoice_items: items,
    })
    goBack()
  }

  return (
    <div>
      <TopBar title={`Invoice · ${card.work_order_no}`} onBack={goBack} />

      <KeyValue
        rows={[
          { k: 'Customer', v: customer?.name },
          { k: 'Boat', v: [boat?.name, boat?.model].filter(Boolean).join(' · ') },
          { k: 'Invoice #', v: card.invoice_number },
          { k: 'Status', v: card.invoice_status },
        ]}
      />

      <Divider />

      <div className="section-head">Line items</div>
      {!items.length ? (
        <div className="state-view">
          <p className="state-view__title">No line items</p>
          <p className="state-view__body">Add what was actually done before issuing.</p>
        </div>
      ) : (
        <div>
          {items.map((item, i) => (
            <div key={i} style={{ padding: '0 var(--space-4) var(--space-3)' }}>
              <TextField label={`Item ${i + 1}`} value={item.description} onChange={(v) => update(i, { description: v })} />
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <TextField label="Qty" inputMode="decimal" value={String(item.quantity ?? 1)} onChange={(v) => update(i, { quantity: Number(v) || 0 })} />
                <TextField label="Unit price" inputMode="decimal" value={String(item.unit_price ?? 0)} onChange={(v) => update(i, { unit_price: Number(v) || 0 })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ font: 'var(--label-m)', color: 'var(--on-surface-variant)' }}>
                  {money(Number(item.quantity) * Number(item.unit_price))}
                </span>
                <Button
                  variant="text"
                  size="sm"
                  icon="trash"
                  aria-label="Remove item"
                  onClick={() => {
                    const next = items.filter((_, idx) => idx !== i)
                    setItems(next)
                    store.patchCard(card.id, { invoice_items: next })
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '0 var(--space-4)' }}>
        <Button
          variant="tonal"
          fullWidth
          icon="plus"
          onClick={() => {
            const next = [...items, { description: '', quantity: 1, unit_price: 0 }]
            setItems(next)
            store.patchCard(card.id, { invoice_items: next })
          }}
        >
          Add line item
        </Button>
      </div>

      <Divider />

      <SelectField
        label="Tax rate"
        value={String(card.tax_rate ?? 0)}
        onChange={(v) => store.patchCard(card.id, { tax_rate: Number(v) })}
        options={[
          { value: '0', label: 'No tax' },
          { value: '0.05', label: '5%' },
          { value: '0.07', label: '7%' },
        ]}
      />

      <div style={{ padding: 'var(--space-2) var(--space-4) var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="kv__k">Subtotal</span>
          <span className="kv__v">{money(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="kv__k">Tax</span>
          <span className="kv__v">{money(tax)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--space-2)' }}>
          <span style={{ font: 'var(--title-m)' }}>Total</span>
          <span style={{ font: 'var(--title-m)' }}>{money(total)}</span>
        </div>
      </div>

      {card.invoice_status === 'issued' ? (
        <ListItem
          icon="receipt"
          title={`Invoice ${card.invoice_number} issued`}
          trailing={<StatusPill tone="done" shape="ring">Issued</StatusPill>}
        />
      ) : (
        <div style={{ padding: '0 var(--space-4) var(--space-6)' }}>
          <Button
            fullWidth
            disabled={!items.length}
            onClick={() => {
              if (!may(CAPABILITIES.INVOICE)) setBlocked(refuseReason(CAPABILITIES.INVOICE))
              else issue()
            }}
          >
            Issue invoice
          </Button>
        </div>
      )}

      <Dialog
        open={Boolean(blocked)}
        title="Can't issue this invoice"
        body={blocked}
        onDismiss={() => setBlocked(null)}
        actions={
          <Button onClick={() => setBlocked(null)}>
            Got it
          </Button>
        }
      />

      {sync.state === 'offline' && may(CAPABILITIES.INVOICE) ? (
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-5)' }}>
          Invoicing needs a connection. Everything else you have entered is kept on this device.
        </p>
      ) : null}
    </div>
  )
}