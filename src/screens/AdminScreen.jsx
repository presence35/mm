import { useState } from 'react'
import { TopBar, Segmented, ListItem, TextField, Button, Icon, StatusPill, EmptyState } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { ROLE_LABEL } from '../engines/auth/permissions.js'
import { SEED_EMPLOYEE } from '../engines/store/seed.js'

/* Admin is admin-only and reachable from behind Setup. Employee, catalogue and
   template management all arrive with the sync phase's server routes; what
   ships now is the shell and the capability gate. */

const TABS = [
  { value: 'employees', label: 'Staff' },
  { value: 'catalogue', label: 'Parts' },
  { value: 'templates', label: 'Labels' },
]

const EMPLOYEES = [
  SEED_EMPLOYEE,
  { id: 'emp-2', name: 'Bo Lindqvist', role: 'mechanic', initials: 'BL' },
  { id: 'emp-3', name: 'Rin Oyelaran', role: 'mechanic', initials: 'RO' },
]

const CATALOGUE = [
  { id: 'p-1', name: 'Oil 10W-30 (qt)', part_number: 'OIL-30', unit_price: 18.5 },
  { id: 'p-2', name: 'Lower unit oil (L)', part_number: 'LU-01', unit_price: 24.0 },
  { id: 'p-3', name: 'Spark plug', part_number: 'SP-09', unit_price: 12.75 },
  { id: 'p-4', name: 'Impeller kit', part_number: 'IMP-2', unit_price: 64.0 },
]

export default function AdminScreen() {
  const { goBack } = useRouter()
  const [tab, setTab] = useState('employees')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  return (
    <div>
      <TopBar title="Admin" onBack={goBack} />

      <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="Admin section" />
      </div>

      {tab === 'employees' ? (
        <>
          <div className="section-head">Staff · {EMPLOYEES.length}</div>
          {EMPLOYEES.map((e) => (
            <ListItem
              key={e.id}
              icon="users"
              title={e.name}
              support={ROLE_LABEL[e.role]}
              trailing={<StatusPill tone="neutral" shape="square">{e.role}</StatusPill>}
            />
          ))}
          <div style={{ padding: 'var(--space-4)' }}>
            <TextField label="New staff member" value={query} onChange={setQuery} help="Server routes arrive with the sync phase." />
            <div style={{ paddingTop: 'var(--space-3)' }}>
              <Button fullWidth icon="plus" disabled>
                Add staff member
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'catalogue' ? (
        <>
          <div className="section-head">Parts catalogue · {CATALOGUE.length}</div>
          {CATALOGUE.map((p) => (
            <ListItem key={p.id} icon="wrench" title={p.name} support={p.part_number} trailing={<Icon name="right" size={20} />} />
          ))}
        </>
      ) : null}

      {tab === 'templates' ? (
        <>
          <div className="section-head">Checklist labels</div>
          <EmptyState
            icon="tune"
            title="Server-owned templates"
            body="Checklist wording and the marina's storage layout come from the server, so they change without an app release."
          />
        </>
      ) : null}
    </div>
  )
}