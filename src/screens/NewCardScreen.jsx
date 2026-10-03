import { useEffect, useMemo, useState } from 'react'
import {
  TopBar,
  SearchBar,
  ListItem,
  Button,
  TextField,
  SelectField,
  Chip,
  ChipRow,
  EmptyState,
  Dialog,
} from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'
import { STORAGE_TYPES, normalizeLocation, isBoathouse, needsLocation } from '../domain/storageLocation.js'
import { SEED_STORAGE_LAYOUT } from '../engines/store/seed.js'

/* Three steps: customer → boat → card.
 *
 * The card step is the paper intake card. Constraint 11 — field set, order and
 * grouping are frozen. Nothing here is tidied for aesthetics.
 *
 * Constraint 12 — location fields are stripped, not hidden: changing storage
 * type runs normalizeLocation, so no combination can be persisted.
 */

const STEPS = ['Customer', 'Boat', 'Card']

export default function NewCardScreen() {
  const { navigate, goBack, setDirty } = useRouter()
  const { may, refuseReason } = useAuth()
  const [step, setStep] = useState(0)

  const [query, setQuery] = useState('')
  const [customer, setCustomer] = useState(null)
  const [boats, setBoats] = useState([])
  const [boat, setBoat] = useState(null)

  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', city: '' })
  const [newBoat, setNewBoat] = useState({ name: '', motor_type: '', model: '', licence: '', trailer_licence: '', length_ft: '' })
  const [duplicate, setDuplicate] = useState(null)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [showNewBoat, setShowNewBoat] = useState(false)

  const [card, setCard] = useState(() => ({
    work_order_no: store.nextWorkOrderNo(new Date()),
    date_in: new Date().toISOString().slice(0, 10),
    storage_type: '',
    remarks: '',
    other_work: '',
    wrap_required: false,
    pickup_delivery: '',
  }))

  const canCreateCustomer = may(CAPABILITIES.CREATE_CUSTOMER)

  const customers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = store.listCustomers()
    return q
      ? all.filter((c) => [c.name, c.phone, c.email].filter(Boolean).some((v) => v.toLowerCase().includes(q)))
      : all
  }, [query])

  const dirty = step > 0 || showNewCustomer || showNewBoat || Boolean(card.storage_type)
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])

  const chooseCustomer = (c) => {
    setCustomer(c)
    setBoats(store.boatsForCustomer(c.id))
    setStep(1)
  }

  const submitCustomer = () => {
    if (!newCustomer.name.trim()) return
    const existing = store.findDuplicateCustomer(newCustomer)
    if (existing) {
      setDuplicate(existing)
      return
    }
    chooseCustomer(store.createCustomer({ ...newCustomer, name: newCustomer.name.trim() }))
  }

  const chooseBoat = (b) => {
    setBoat(b)
    setStep(2)
  }

  const submitBoat = () => {
    if (!newBoat.name.trim() && !newBoat.model.trim()) return
    chooseBoat(store.createBoat({ ...newBoat, customer_id: customer.id, length_ft: newBoat.length_ft ? Number(newBoat.length_ft) : null }))
  }

  const setStorageType = (value) => {
    const next = value ? value : ''
    setCard((c) => normalizeLocation({ ...c, storage_type: next }, next))
  }

  const setLoc = (field, value) => setCard((c) => ({ ...c, [field]: value }))

  const canSave = card.storage_type && card.date_in && (!needsLocation(card.storage_type) || hasLocation(card))

  const submit = () => {
    const created = store.createCard({
      ...card,
      boat_id: boat.id,
      season_year: new Date().getFullYear(),
    })
    setDirty(false)
    navigate('card', { id: created.id })
  }

  return (
    <div>
      <TopBar title={`New card · ${STEPS[step]}`} onBack={step > 0 ? () => setStep(step - 1) : goBack} />

      <div style={{ display: 'flex', gap: 'var(--space-1)', padding: '0 var(--space-4) var(--space-3)' }}>
        {STEPS.map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div
              style={{
                height: 4,
                borderRadius: 'var(--corner-full)',
                background: i <= step ? 'var(--primary)' : 'var(--surface-container-highest)',
              }}
            />
            <span style={{ font: 'var(--label-s)', color: 'var(--on-surface-variant)' }}>{label}</span>
          </div>
        ))}
      </div>

      {step === 0 ? (
        <>
          <SearchBar value={query} onChange={setQuery} placeholder="Search customer" />
          {!customers.length ? (
            <EmptyState
              icon="users"
              title="No customers found"
              body="Search by name, phone or email, or add a new customer below."
            />
          ) : (
            <div>
              {customers.map((c) => (
                <ListItem
                  key={c.id}
                  icon="users"
                  title={c.name}
                  support={[c.phone, c.city].filter(Boolean).join(' · ')}
                  onClick={() => chooseCustomer(c)}
                />
              ))}
            </div>
          )}

          {canCreateCustomer ? (
            <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-6)' }}>
              <Button
                variant={showNewCustomer ? 'text' : 'tonal'}
                fullWidth
                icon={showNewCustomer ? undefined : 'plus'}
                onClick={() => setShowNewCustomer((v) => !v)}
              >
                {showNewCustomer ? 'Cancel' : 'New customer'}
              </Button>

              {showNewCustomer ? (
                <>
                  <TextField label="Name" required value={newCustomer.name} onChange={(v) => setNewCustomer({ ...newCustomer, name: v })} />
                  <TextField label="Phone" type="tel" inputMode="tel" value={newCustomer.phone} onChange={(v) => setNewCustomer({ ...newCustomer, phone: v })} />
                  <TextField label="Email" type="email" inputMode="email" value={newCustomer.email} onChange={(v) => setNewCustomer({ ...newCustomer, email: v })} />
                  <TextField label="City" value={newCustomer.city} onChange={(v) => setNewCustomer({ ...newCustomer, city: v })} />
                  <div style={{ padding: 'var(--space-4)' }}>
                    <Button fullWidth onClick={submitCustomer} disabled={!newCustomer.name.trim()}>
                      Create & continue
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: 'var(--space-4)' }}>
              Your role can attach cards to existing customers but not create new ones.
            </p>
          )}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--surface-container-low)' }}>
            <p style={{ font: 'var(--label-m)', color: 'var(--on-surface-variant)' }}>Customer</p>
            <p style={{ font: 'var(--title-m)' }}>{customer.name}</p>
          </div>

          {!boats.length ? (
            <EmptyState icon="boat" title="No boats on file" body="Add this customer's first boat." />
          ) : (
            <div>
              {boats.map((b) => (
                <ListItem
                  key={b.id}
                  icon="boat"
                  title={b.name || '(no name)'}
                  support={[b.motor_type, b.model, b.licence].filter(Boolean).join(' · ')}
                  onClick={() => chooseBoat(b)}
                />
              ))}
            </div>
          )}

          <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-6)' }}>
            <Button variant={showNewBoat ? 'text' : 'tonal'} fullWidth icon={showNewBoat ? undefined : 'plus'} onClick={() => setShowNewBoat((v) => !v)}>
              {showNewBoat ? 'Cancel' : 'New boat'}
            </Button>
            {showNewBoat ? (
              <>
                <TextField label="Boat name" value={newBoat.name} onChange={(v) => setNewBoat({ ...newBoat, name: v })} />
                <TextField label="Motor type" value={newBoat.motor_type} onChange={(v) => setNewBoat({ ...newBoat, motor_type: v })} />
                <TextField label="Model" value={newBoat.model} onChange={(v) => setNewBoat({ ...newBoat, model: v })} />
                <TextField label="Licence / reg" value={newBoat.licence} onChange={(v) => setNewBoat({ ...newBoat, licence: v })} />
                <TextField label="Trailer licence" value={newBoat.trailer_licence} onChange={(v) => setNewBoat({ ...newBoat, trailer_licence: v })} />
                <TextField label="Length (ft)" inputMode="decimal" value={newBoat.length_ft} onChange={(v) => setNewBoat({ ...newBoat, length_ft: v })} />
                <div style={{ padding: 'var(--space-4)' }}>
                  <Button fullWidth onClick={submitBoat} disabled={!newBoat.name.trim() && !newBoat.model.trim()}>
                    Create & continue
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          {/* Paper intake card, in the paper's order. */}
          <KeyValueRow label="Work order #" value={card.work_order_no} />
          <TextField label="Date in" type="date" required value={card.date_in} onChange={(v) => setCard({ ...card, date_in: v })} />

          <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
            <span className="field__label">Storage type</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {STORAGE_TYPES.map((t) => (
                <Chip key={t.value} selected={card.storage_type === t.value} onClick={() => setStorageType(t.value)}>
                  {t.label}
                </Chip>
              ))}
            </div>
          </div>

          {isBoathouse(card.storage_type) ? (
            <SelectField
              label="Boathouse #"
              value={card.boathouse_no ?? ''}
              onChange={(v) => setLoc('boathouse_no', v ? Number(v) : null)}
              options={[{ value: '', label: 'Boathouse #' }, ...Array.from({ length: SEED_STORAGE_LAYOUT.boathouse_count }, (_, i) => ({ value: String(i + 1), label: `Boathouse ${i + 1}` }))]}
            />
          ) : null}
          {isBoathouse(card.storage_type) ? (
            <SelectField
              label="Slip #"
              value={card.slip_no ?? ''}
              onChange={(v) => setLoc('slip_no', v ? Number(v) : null)}
              options={[{ value: '', label: 'Slip #' }, ...Array.from({ length: SEED_STORAGE_LAYOUT.boathouse_slips }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
            />
          ) : null}
          {card.storage_type === 'storage_building' ? (
            <>
              <SelectField
                label="Building"
                value={card.storage_building ?? ''}
                onChange={(v) => setLoc('storage_building', v)}
                options={[{ value: '', label: 'Building' }, ...SEED_STORAGE_LAYOUT.buildings.map((b) => ({ value: b, label: b }))]}
              />
              <SelectField
                label="Row"
                value={card.storage_row ?? ''}
                onChange={(v) => setLoc('storage_row', v ? Number(v) : null)}
                options={[{ value: '', label: 'Row' }, ...SEED_STORAGE_LAYOUT.rows.map((r) => ({ value: String(r), label: `Row ${r}` }))]}
              />
              <SelectField
                label="Column"
                value={card.storage_col ?? ''}
                onChange={(v) => setLoc('storage_col', v)}
                options={[{ value: '', label: 'Column' }, ...SEED_STORAGE_LAYOUT.cols.map((c) => ({ value: c, label: `Column ${c}` }))]}
              />
            </>
          ) : null}

          <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
            <Chip selected={card.wrap_required} onClick={() => setCard({ ...card, wrap_required: !card.wrap_required })}>
              Shrink wrap required
            </Chip>
          </div>

          <TextField
            label="Other work / notes"
            multiline
            value={card.other_work}
            onChange={(v) => setCard({ ...card, other_work: v })}
            placeholder="Trim not working, additional work requested…"
          />
          <TextField
            label="Remarks"
            multiline
            value={card.remarks}
            onChange={(v) => setCard({ ...card, remarks: v })}
            placeholder="Winter storage 2026–2027…"
          />
          <TextField
            label="Pickup / delivery"
            value={card.pickup_delivery}
            onChange={(v) => setCard({ ...card, pickup_delivery: v })}
          />

          <div style={{ padding: 'var(--space-4)' }}>
            <Button fullWidth onClick={submit} disabled={!canSave}>
              Create service card
            </Button>
          </div>
        </>
      ) : null}

      <Dialog
        open={Boolean(duplicate)}
        title="Customer already exists"
        body={`${duplicate?.name} already has this email or phone. Continue with that customer?`}
        onDismiss={() => setDuplicate(null)}
        actions={
          <>
            <Button variant="text" onClick={() => setDuplicate(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                chooseCustomer(duplicate)
                setDuplicate(null)
              }}
            >
              Use existing
            </Button>
          </>
        }
      />
    </div>
  )
}

function hasLocation(card) {
  if (isBoathouse(card.storage_type)) return Boolean(card.boathouse_no && card.slip_no)
  if (card.storage_type === 'storage_building') {
    return Boolean(card.storage_building && card.storage_row && card.storage_col)
  }
  return true
}

function KeyValueRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)' }}>
      <span className="kv__k" style={{ minWidth: '34%' }}>{label}</span>
      <span className="kv__v">{value}</span>
    </div>
  )
}