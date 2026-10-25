import { useState } from 'react'
import { TopBar, Button, EmptyState, StatusPill, Icon } from '../ui'
import { useSync } from '../engines/sync/SyncProvider.jsx'
import { useConflicts } from '../features/conflicts/useConflicts.js'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useWindowClass } from '../shell/useWindowClass.js'

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
 * One conflict per card, one differing field per card inside it. The queue in
 * the marina is dozens of rows, and a single running column reads as a wall:
 * separated, a worker settles one and is able to leave the rest. On a wide
 * screen the field cards flow across the conflict card — the queue turned on
 * its side — so a four-field disagreement is one glance, not four scrolls.
 *
 * The value is the control. It is the string itself, prefixed by the phone or
 * the server icon and a small label, because the question was never "which
 * button" but "which of these two strings is the one I mean". The chosen row
 * is tinted and ticked, never colour alone.
 *
 * The heading commits. A worker who has already decided should not hunt for a
 * button at the bottom of the card, so the whole header is the commit and says
 * Apply on its right; the footer button exists only for a mixed choice, where
 * the count is worth spelling out. Each card also carries the two bulk targets
 * — everything from this device, everything from the server — and the screen
 * carries them once for the whole queue, because thirty-six one-field
 * conflicts are a queue nobody reads.
 *
 * Server is preselected because the server's version is what the entity
 * currently holds (behaviors-sync.md §Conflicts). Choosing "This device" is the
 * deviation, so the default is the state that already exists.
 */

export default function ConflictsScreen() {
  const { goBack } = useRouter()
  const { resolve, online } = useSync()
  const { conflicts, refresh } = useConflicts()
  const width = useWindowClass()

  const act = async (id, choice) => {
    await resolve(id, choice)
    await refresh()
  }

  /* Every card, one side. Resolving keeps both payloads on both sides and only
     closes the disagreement, so this deletes nothing — it is the same choice
     the worker would make card by card, made once. A card waiting for its
     server version has nothing to choose between and is left alone. */
  const allSide = async (side) => {
    for (const conflict of conflicts) {
      if (!conflict.server_payload) continue
      await resolve(conflict.id, { resolution: side === 'mine' ? 'kept_local' : 'kept_server' })
    }
    await refresh()
  }

  return (
    <div className="conflicts" data-width={width}>
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

          {conflicts.length > 1 ? (
            <div className="conflict-all">
              <span className="conflict-all__label">All {conflicts.length}</span>
              <span className="spacer" />
              <Bulk large onPick={allSide} />
            </div>
          ) : null}

          {conflicts.map((conflict) => (
            <Card key={conflict.id} conflict={conflict} onResolve={act} />
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

/* The two sides as one control, so "all of it from here" is a single glance.
   On a card the side is carried by the icon and the word is All; the
   screen-level bar has no card context, so it names the side instead. */
function Bulk({ onPick, large = false, count = 0 }) {
  const scope = large ? 'everywhere' : `all ${count} field${count === 1 ? '' : 's'}`
  return (
    <div className="conflict-bulk">
      <button
        type="button"
        className="conflict-bulk__btn"
        onClick={() => onPick('mine')}
        aria-label={`Keep this device's version for ${scope}`}
      >
        <Icon name="phone" size={large ? 22 : 20} />
        {large ? 'This device' : 'All'}
      </button>
      <button
        type="button"
        className="conflict-bulk__btn"
        onClick={() => onPick('theirs')}
        aria-label={`Keep the server's version for ${scope}`}
      >
        <Icon name="server" size={large ? 22 : 20} />
        {large ? 'Server' : 'All'}
      </button>
    </div>
  )
}

function Card({ conflict, onResolve }) {
  /* field → 'mine' | 'theirs'. Absent means server, so a field the worker
     never looked at keeps the value the entity already holds. */
  const [chosen, setChosen] = useState({})

  const heading = conflict.detail ? `${conflict.type} · ${conflict.detail}` : conflict.type
  const count = conflict.rows.length
  const waiting = !conflict.server_payload
  const kept = conflict.rows.filter((r) => chosen[r.field] === 'mine')
  const mixed = kept.length > 0 && kept.length < count

  const choose = (field, side) => setChosen((c) => ({ ...c, [field]: side }))

  const apply = () => {
    if (!kept.length) return onResolve(conflict.id, { resolution: 'kept_server' })
    /* Start from what the server holds and override only the fields the worker
       chose. Everything they did not touch keeps the value the entity already
       has, which is the whole point of picking per field. */
    const payload = { ...conflict.server_payload }
    for (const r of kept) payload[r.field] = conflict.local_payload?.[r.field] ?? null
    return onResolve(conflict.id, { resolution: 'merged', payload })
  }

  const resolveSide = (side) =>
    onResolve(conflict.id, { resolution: side === 'mine' ? 'kept_local' : 'kept_server' })

  if (waiting) {
    return (
      <article className="conflict-card">
        <div className="conflict-card__head">
          <h2 className="conflict-card__name">{heading}</h2>
          {conflict.record ? <p className="conflict-card__meta">{conflict.record}</p> : null}
          <p className="conflict-card__meta">Waiting for this device to pull the other version</p>
        </div>
        <div className="conflict-card__bar">
          <StatusPill tone="neutral" shape="square">
            Not comparable yet
          </StatusPill>
        </div>
      </article>
    )
  }

  return (
    <article className="conflict-card">
      <div className="conflict-card__head">
        <button
          type="button"
          className="conflict-card__title"
          onClick={apply}
          aria-label={`Apply the chosen versions for ${heading}`}
        >
          <span className="conflict-card__name">{heading}</span>
          <span className="conflict-card__apply">
            <Icon name="check" size={18} />
            Apply
          </span>
        </button>
        {conflict.record ? <p className="conflict-card__meta">{conflict.record}</p> : null}
        {conflict.changedBy ? <p className="conflict-card__meta">{conflict.changedBy}</p> : null}
      </div>

      <div className="conflict-card__bar">
        <span className="conflict-card__count">{count} different</span>
        <span className="spacer" />
        <Bulk onPick={resolveSide} count={count} />
      </div>

      <div className="conflict-fields">
        {conflict.rows.map((row) => (
          <div className="conflict-field" key={row.field}>
            <div className="conflict-field__name">{row.label}</div>
            <Value
              source="phone"
              label="This device"
              value={row.mine}
              selected={chosen[row.field] === 'mine'}
              onSelect={() => choose(row.field, 'mine')}
            />
            <Value
              source="server"
              label="Server"
              value={row.theirs}
              selected={chosen[row.field] !== 'mine'}
              onSelect={() => choose(row.field, 'theirs')}
            />
          </div>
        ))}
      </div>

      {mixed ? (
        <div className="conflict-card__foot">
          <Button fullWidth onClick={apply}>
            {`Apply — ${kept.length} from this device, ${count - kept.length} from the server`}
          </Button>
        </div>
      ) : null}
    </article>
  )
}

/*
 * One candidate string. Tapping it keeps it; the source icon and label say
 * where it came from, and the tick says it is the one being kept.
 */
function Value({ source, label, value, selected, onSelect }) {
  return (
    <button
      type="button"
      className="conflict-value"
      aria-pressed={selected}
      aria-label={`Keep ${label}: ${value}`}
      onClick={onSelect}
    >
      <Icon name={source} size={16} />
      <span className="conflict-value__source">{label}</span>
      <span className="conflict-value__text">{value}</span>
      {selected ? <Icon name="check" size={16} /> : null}
    </button>
  )
}
