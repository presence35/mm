import { Fragment } from 'react'
import { TopBar, Button, Divider, EmptyState, StatusPill, Icon } from '../ui'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useConflicts, differences, describe } from '../features/conflicts/useConflicts.js'
import { useRouter } from '../shell/RouterProvider.jsx'

/*
 * Conflict resolution. Both versions are kept and the worker chooses — never
 * last-write-wins, never a silent merge. Resolution is a queued write, so this
 * works with no signal.
 */

const FIELD_LABEL = {
  name: 'Name', city: 'City', phone: 'Phone', email: 'Email',
  postal_code: 'Postal code', address: 'Address',
  motor_type: 'Motor', model: 'Model', licence: 'Licence',
  trailer_licence: 'Trailer licence', length_ft: 'Length',
  storage_type: 'Storage type', storage_building: 'Building',
  storage_row: 'Row', storage_col: 'Column', boathouse_no: 'Boathouse',
  slip_no: 'Slip', remarks: 'Remarks', other_work: 'Other work',
  pickup_delivery: 'Pickup / delivery', date_in: 'Date in', date_out: 'Date out',
  status: 'Status', wrap_required: 'Shrink wrap', unwrap_done: 'Unwrapped',
  work_order_no: 'Work order', season_year: 'Season',
}

export default function ConflictsScreen() {
  const { goBack } = useRouter()
  const { resolve, online } = useSync()
  const { conflicts } = useConflicts()

  return (
    <div>
      <TopBar title="Needs review" onBack={goBack} />

      {!conflicts.length ? (
        <EmptyState
          icon="check"
          title="Nothing to review"
          body="When two people change the same card while one of them is out of signal, both versions are kept here instead of one overwriting the other."
        />
      ) : (
        <>
          <div className="offline-bar" role="status">
            <Icon name="alert" size={18} />
            {conflicts.length} change{conflicts.length === 1 ? '' : 's'} kept — nothing was lost
          </div>

          {conflicts.map((c) => (
            <Conflict key={c.id} conflict={c} onResolve={resolve} online={online} />
          ))}

          {!online ? (
            <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-6)' }}>
              You are offline. Your choice is saved on this device and pushed when you get signal.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function Conflict({ conflict, onResolve, online }) {
  const rows = differences(conflict)
  const busy = null

  return (
    <section style={{ paddingBottom: 'var(--space-4)' }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-2)' }}>
        <div className="row">
          <span style={{ font: 'var(--label-m)', color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {describe(conflict.entity)}
          </span>
          <span className="spacer" />
          <StatusPill tone="warn" shape="diamond">
            Both kept
          </StatusPill>
        </div>
        <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', marginTop: 'var(--space-1)' }}>
          {new Date(conflict.detected_at).toLocaleString()}
        </p>
      </div>

      {!rows.length ? (
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-3)' }}>
          {conflict.server_payload
            ? 'Both versions agree on every field worth showing.'
            : 'Waiting for this device to pull the other version so you can compare.'}
        </p>
      ) : (
        <div style={{ padding: '0 var(--space-4)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(80px, 1fr) 1fr 1fr',
              gap: 'var(--space-2) var(--space-3)',
            }}
          >
            <span style={{ font: 'var(--label-s)', color: 'var(--on-surface-variant)' }}>Field</span>
            <span style={{ font: 'var(--label-s)', color: 'var(--on-surface-variant)' }}>This device</span>
            <span style={{ font: 'var(--label-s)', color: 'var(--on-surface-variant)' }}>Server</span>

            {rows.map((r) => (
              <Fragment key={r.field}>
                <span style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
                  {FIELD_LABEL[r.field] ?? r.field}
                </span>
                <span
                  style={{
                    font: 'var(--body-m)',
                    background: 'var(--secondary-container)',
                    color: 'var(--on-secondary-container)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--corner-s)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {r.mine}
                </span>
                <span
                  style={{
                    font: 'var(--body-m)',
                    background: 'var(--surface-container-high)',
                    color: 'var(--on-surface)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--corner-s)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {r.theirs}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4) 0' }}>
        <Button
          variant="tonal"
          fullWidth
          onClick={() => onResolve(conflict.id, { resolution: 'kept_local' })}
        >
          Keep mine
        </Button>
        <Button
          variant="outlined"
          fullWidth
          onClick={() => onResolve(conflict.id, { resolution: 'kept_server' })}
        >
          Keep theirs
        </Button>
      </div>

      <Divider />
    </section>
  )
}