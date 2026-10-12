import { useState } from 'react'
import { TopBar, Button, Divider, EmptyState, StatusPill, Icon, Collapsible, ListItem } from '../ui'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useConflicts } from '../features/conflicts/useConflicts.js'
import { useRouter } from '../shell/RouterProvider.jsx'

/*
 * Conflict resolution. Both versions are kept and the worker chooses — never
 * last-write-wins, never a silent merge. Resolution is a queued write, so this
 * works with no signal.
 *
 * Most conflicts have nothing to decide: the same edit landed twice, so the
 * version moved and no field changed. Those get one line and one tap, and can
 * be cleared in bulk. Only a real disagreement opens into the comparison.
 *
 * The comparison is stacked, not three columns. At 360px a
 * `field | mine | theirs` grid squeezes two values into ~120px each, which is
 * how a worker ends up choosing without reading.
 */

function stateOf(conflict) {
  if (!conflict.server_payload) return 'waiting'
  return conflict.rows.length ? 'differs' : 'same'
}

export default function ConflictsScreen() {
  const { goBack } = useRouter()
  const { resolve, online } = useSync()
  const { conflicts, refresh } = useConflicts()
  const [busy, setBusy] = useState(false)

  const settled = conflicts.filter((c) => stateOf(c) === 'same')

  const acceptAll = async () => {
    setBusy(true)
    for (const c of settled) {
      /* kept_server, because the two versions are the same. Nothing is
         re-written and nothing is lost. */
      await resolve(c.id, { resolution: 'kept_server' })
    }
    await refresh()
    setBusy(false)
  }

  const act = async (id, resolution) => {
    await resolve(id, { resolution })
    await refresh()
  }

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
            {settled.length ? (
              <>
                <span className="spacer" />
                <Button variant="text" size="sm" onClick={acceptAll} loading={busy} disabled={busy}>
                  Accept {settled.length} identical
                </Button>
              </>
            ) : null}
          </div>

          {conflicts.map((c) => (
            <Row key={c.id} conflict={c} onResolve={act} />
          ))}

          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: 'var(--space-2) var(--space-4) var(--space-6)' }}>
            {online
              ? 'Your choice is pushed to the server on the next sync.'
              : 'You are offline. Your choice is saved on this device and pushed when you get signal.'}
          </p>
        </>
      )}
    </div>
  )
}

function Row({ conflict, onResolve }) {
  const state = stateOf(conflict)
  const heading = conflict.detail ? `${conflict.type} · ${conflict.detail}` : conflict.type

  if (state === 'same') {
    return (
      <ListItem
        title={heading}
        support={[conflict.record, 'No differences'].filter(Boolean).join(' · ')}
        trailing={
          <Button variant="text" size="sm" onClick={() => onResolve(conflict.id, 'kept_server')}>
            Accept
          </Button>
        }
      />
    )
  }

  if (state === 'waiting') {
    return (
      <ListItem
        title={heading}
        support={[conflict.record, 'Waiting for this device to pull the other version'].filter(Boolean).join(' · ')}
        trailing={
          <StatusPill tone="neutral" shape="square">
            Not comparable yet
          </StatusPill>
        }
      />
    )
  }

  return (
    <>
      <Collapsible title={heading} count={conflict.rows.length} summary={conflict.record}>
        <div style={{ padding: '0 var(--space-4) var(--space-2)' }}>
          {conflict.rows.map((r) => (
            <div key={r.field} style={{ padding: 'var(--space-3) 0', boxShadow: 'inset 0 1px 0 var(--outline-variant)' }}>
              <div style={{ font: 'var(--label-s)', color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {r.label}
              </div>
              <Side label="This device" value={r.mine} kind="mine" />
              <Side label="Server" value={r.theirs} kind="theirs" />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-4) var(--space-4)' }}>
          <Button variant="tonal" size="sm" onClick={() => onResolve(conflict.id, 'kept_local')}>
            Keep mine
          </Button>
          <Button variant="text" size="sm" onClick={() => onResolve(conflict.id, 'kept_server')}>
            Keep theirs
          </Button>
        </div>
      </Collapsible>
      <Divider />
    </>
  )
}

/* Stacked, mine above theirs, each named. Two columns of prose side by side on
   a phone is a design that assumes the reader is comparing, which they are not
   — they are reading one, then the other. */
function Side({ label, value, kind }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', marginTop: 'var(--space-1)' }}>
      <span style={{ font: 'var(--label-s)', color: 'var(--on-surface-variant)', minWidth: 64, flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          font: 'var(--body-m)',
          background: kind === 'mine' ? 'var(--secondary-container)' : 'var(--surface-container-high)',
          color: kind === 'mine' ? 'var(--on-secondary-container)' : 'var(--on-surface)',
          padding: 'var(--space-1) var(--space-2)',
          borderRadius: 'var(--corner-s)',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </span>
    </div>
  )
}
