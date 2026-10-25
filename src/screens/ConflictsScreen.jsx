import { useState } from 'react'
import { TopBar, Button, Divider, EmptyState, StatusPill, Icon, ListItem } from '../ui'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useConflicts } from '../features/conflicts/useConflicts.js'
import { useRouter } from '../shell/RouterProvider.jsx'

/*
 * Conflict resolution. Both versions are kept and the worker chooses — never
 * last-write-wins, never a silent merge. Resolution is a queued write, so this
 * works with no signal.
 *
 * Only real disagreements reach this screen. A conflict raised by a version
 * that moved while the content did not is closed by the sweep in the store
 * (idb.closeSettledConflicts), which owns that rule — so this screen never has
 * to offer a choice that does not exist, and what is left is two cases: a
 * genuine difference, and a row whose server side has not been pulled yet.
 *
 * Every difference is open on arrival. This screen exists to be read once and
 * cleared, and a collapsed row makes the worker tap before they can find out
 * whether there is anything to do.
 *
 * The side label is the control. Two generic "Keep mine / Keep theirs" buttons
 * under a list of fields asked the worker to choose a whole version without
 * saying which field they were choosing about — and cost a row of screen for a
 * decision that belongs beside each value. Tapping This device or Server picks
 * that side for that field; one button commits the result.
 *
 * A worker who already knows they want their whole version gets the All fields
 * row above the list: it fills every field with that side and commits nothing,
 * so it costs no more state or risk than tapping each field in turn, and the
 * same single button still commits. It is hidden on a one-field conflict, where
 * it would be the per-field choice repeated under a second label.
 *
 * Server is preselected because the server's version is what the entity
 * currently holds (behaviors-sync.md §Conflicts). Choosing "This device" is the
 * deviation, so the default is the state that already exists.
 */

export default function ConflictsScreen() {
  const { goBack } = useRouter()
  const { resolve, online } = useSync()
  const { conflicts, refresh } = useConflicts()

  const act = async (id, choice) => {
    await resolve(id, choice)
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
  /* field → 'mine' | 'theirs'. Absent means server, so a field the worker
     never looked at keeps the value the entity already holds. */
  const [chosen, setChosen] = useState({})

  const heading = conflict.detail ? `${conflict.type} · ${conflict.detail}` : conflict.type
  const waiting = !conflict.server_payload
  const kept = conflict.rows.filter((r) => chosen[r.field] === 'mine')

  /* Which side the All row is on is derived from `chosen`, never a second flag:
     strip one field back to the server and the row stops being marked, with
     nothing to keep in step. Server is the empty map, so it stays the absence
     it already is. */
  const allMine = conflict.rows.every((r) => chosen[r.field] === 'mine')
  const allServer = conflict.rows.every((r) => chosen[r.field] !== 'mine')
  const pickAll = (side) =>
    setChosen(
      side === 'mine' ? Object.fromEntries(conflict.rows.map((r) => [r.field, 'mine'])) : {},
    )

  const apply = () => {
    if (!kept.length) return onResolve(conflict.id, { resolution: 'kept_server' })
    /* Start from what the server holds and override only the fields the worker
       chose. Everything they did not touch keeps the value the entity already
       has, which is the whole point of picking per field. */
    const payload = { ...conflict.server_payload }
    for (const r of kept) payload[r.field] = conflict.local_payload?.[r.field] ?? null
    return onResolve(conflict.id, { resolution: 'merged', payload })
  }

  if (waiting) {
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
      <section style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
          <span
            style={{
              font: 'var(--label-m)',
              color: 'var(--on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {heading}
          </span>
          <span className="spacer" />
          <span style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
            {conflict.rows.length} field{conflict.rows.length === 1 ? '' : 's'} differ
          </span>
        </div>
        {conflict.record ? (
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>{conflict.record}</p>
        ) : null}
        {conflict.changedBy ? (
          <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>{conflict.changedBy}</p>
        ) : null}
      </section>

      {conflict.rows.length > 1 ? (
        <div role="group" aria-label="All fields" style={{ padding: 'var(--space-2) var(--space-4) 0' }}>
          <div
            style={{
              font: 'var(--title-s)',
              color: 'var(--on-surface)',
              paddingBottom: 'var(--space-1)',
            }}
          >
            All fields
          </div>
          <Side label="This device" selected={allMine} onSelect={() => pickAll('mine')} />
          <Side label="Server" selected={allServer} onSelect={() => pickAll('theirs')} />
          <Divider />
        </div>
      ) : null}

      <div style={{ padding: 'var(--space-2) var(--space-4) 0' }}>
        {conflict.rows.map((r) => (
          <div key={r.field} style={{ paddingBottom: 'var(--space-3)' }}>
            <div
              style={{
                font: 'var(--label-s)',
                color: 'var(--on-surface-variant)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: 'var(--space-2) 0 var(--space-1)',
              }}
            >
              {r.label}
            </div>
            <Side
              label="This device"
              value={r.mine}
              selected={chosen[r.field] === 'mine'}
              onSelect={() => setChosen((c) => ({ ...c, [r.field]: 'mine' }))}
            />
            <Side
              label="Server"
              value={r.theirs}
              selected={chosen[r.field] !== 'mine'}
              onSelect={() => setChosen((c) => ({ ...c, [r.field]: 'theirs' }))}
            />
          </div>
        ))}
      </div>

      <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
        <Button fullWidth onClick={apply}>
          {kept.length === 0
            ? 'Keep the server version'
            : kept.length === conflict.rows.length
              ? `Use this device for all ${kept.length}`
              : `Apply — ${kept.length} from this device, ${conflict.rows.length - kept.length} from the server`}
        </Button>
      </div>
      <Divider />
    </>
  )
}

/*
 * One side of one choice. The label is the control: pressing it chooses this
 * side, and the chosen one is marked with a tick as well as a fill, so the
 * choice survives greyscale (architecture.md constraint 9). `value` is omitted
 * on the All row, where there is no single value to show.
 */
function Side({ label, value, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        minHeight: 'var(--target-min)',
        padding: 'var(--space-1) var(--space-2)',
        marginBottom: 'var(--space-1)',
        borderRadius: 'var(--corner-m)',
        textAlign: 'left',
        background: selected ? 'var(--secondary-container)' : 'var(--surface-container-high)',
        color: selected ? 'var(--on-secondary-container)' : 'var(--on-surface)',
        boxShadow: selected ? 'inset 0 0 0 2px var(--primary)' : 'inset 0 0 0 1px var(--outline-variant)',
      }}
    >
      <span
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          minWidth: 96,
          font: 'var(--label-m)',
        }}
      >
        {selected ? <Icon name="check" size={16} /> : null}
        {label}
      </span>
      {value === undefined ? null : (
        <span style={{ font: 'var(--body-m)', overflowWrap: 'anywhere' }}>{value}</span>
      )}
    </button>
  )
}
