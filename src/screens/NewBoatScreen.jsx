import { useEffect, useMemo, useState } from 'react'
import { TopBar, SearchBar, ListItem, Button, TextField, EmptyState, Dialog } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import * as store from '../engines/store/localStore.js'
import { useAuth, CAPABILITIES } from '../engines/auth/AuthProvider.jsx'

/* Two steps: owner → boat.
 *
 * The card flow can create a boat as a side effect of writing a card, but a
 * yard often knows the boat before it knows the job. This is that path, and it
 * deliberately stops at the boat: it does not open a card, because a card has
 * a work order number, a date in and a storage position, and inventing
 * defaults for those to make the flow shorter would put a wrong card on file.
 *
 * The owner is picked from customers already on file. A brand-new customer is
 * offered only to roles that may create one, and that path is the same
 * duplicate-checked form the card flow uses — a second, quieter way to create
 * a customer is how duplicates get in.
 */

const STEPS = ['Owner', 'Boat']

export default function NewBoatScreen() {
  const { navigate, goBack, setDirty } = useRouter()
  const { may, refuseReason } = useAuth()
  const [step, setStep] = useState(0)

  const [query, setQuery] = useState('')
  const [customer, setCustomer] = useState(null)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', city: '' })
  const [newBoat, setNewBoat] = useState({ name: '', motor_type: '', model: '', licence: '', trailer_licence: '', length_ft: '' })
  const [duplicate, setDuplicate] = useState(null)
  const [showNewCustomer, setShowNewCustomer] = useState(false)

  const canCreateBoat = may(CAPABILITIES.CREATE_BOAT)
  const canCreateCustomer = may(CAPABILITIES.CREATE_CUSTOMER)

  const customers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = store.listCustomers()
    return q
      ? all.filter((c) => [c.name, c.phone, c.email].filter(Boolean).some((v) => v.toLowerCase().includes(q)))
      : all
  }, [query])

  const dirty = step > 0 || showNewCustomer
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])

  const chooseCustomer = (c) => {
    setCustomer(c)
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

  const canSaveBoat = Boolean(newBoat.name.trim() || newBoat.model.trim())

  const submitBoat = () => {
    if (!canSaveBoat) return
    const created = store.createBoat({
      ...newBoat,
      customer_id: customer.id,
      length_ft: newBoat.length_ft ? Number(newBoat.length_ft) : null,
    })
    setDirty(false)
    navigate('boat', { id: created.id })
  }

  if (!canCreateBoat) {
    return (
      <div>
        <TopBar title="Add a boat" onBack={goBack} />
        <div className="state-view">
          <p className="state-view__title">Not allowed</p>
          <p className="state-view__body">{refuseReason(CAPABILITIES.CREATE_BOAT)}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <TopBar title={`New boat · ${STEPS[step]}`} onBack={step > 0 ? () => setStep(step - 1) : goBack} />

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
                      Create &amp; continue
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: 'var(--space-4)' }}>
              Your role can add boats to existing customers but not create new ones.
            </p>
          )}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--surface-container-low)' }}>
            <p style={{ font: 'var(--label-m)', color: 'var(--on-surface-variant)' }}>Owner</p>
            <p style={{ font: 'var(--title-m)' }}>{customer.name}</p>
          </div>

          <TextField label="Boat name" value={newBoat.name} onChange={(v) => setNewBoat({ ...newBoat, name: v })} />
          <TextField label="Motor type" value={newBoat.motor_type} onChange={(v) => setNewBoat({ ...newBoat, motor_type: v })} />
          <TextField label="Model" value={newBoat.model} onChange={(v) => setNewBoat({ ...newBoat, model: v })} />
          <TextField label="Licence / reg" value={newBoat.licence} onChange={(v) => setNewBoat({ ...newBoat, licence: v })} />
          <TextField label="Trailer licence" value={newBoat.trailer_licence} onChange={(v) => setNewBoat({ ...newBoat, trailer_licence: v })} />
          <TextField label="Length (ft)" inputMode="decimal" value={newBoat.length_ft} onChange={(v) => setNewBoat({ ...newBoat, length_ft: v })} />

          <div style={{ padding: 'var(--space-4)' }}>
            <Button fullWidth onClick={submitBoat} disabled={!canSaveBoat}>
              Add boat
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
