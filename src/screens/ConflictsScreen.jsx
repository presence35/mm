import { useEffect, useRef, useState } from 'react'
import { TopBar, EmptyState, Icon } from '../ui'
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
 * separated, a worker settles one and can leave the rest. On a wide screen the
 * field cards flow across the conflict card — the queue turned on its side — so
 * a four-field disagreement is one glance, not four scrolls.
 *
 * There is no selection and no Apply. Every tap is a decision: the phone string
 * keeps that field from this device and the rest from the server, the server
 * string keeps the server's version, and the two All targets keep one whole
 * side. A screen where a tap chooses and a button then commits was two steps
 * for one decision, and it left cards looking undecided while they were already
 * answered. The phone and server icons are the legend; the words live once, on
 * the screen-level pair.
 *
 * Server is the default by omission: the server's version is what the entity
 * currently holds (behaviors-sync.md §Conflicts). Choosing "This device" is the
 * deviation.
 *
 * A conflict whose server side never arrived has nothing to compare. It is not
 * hidden — a disagreement is never silently dropped — but it is one line with
 * the single decision that exists, rather than a card that looks broken and
 * offers nothing to tap.
 */

export default function ConflictsScreen() {
  const { goBack } = useRouter()
  const { resolve, online } = useSync()
  const { conflicts, refresh } = useConflicts()
  const width = useWindowClass()
  const root = useRef(null)

  const act = async (id, choice) => {
    await resolve(id, choice)
    await refresh()
  }

  /* Every card, one side. Resolving keeps both payloads on both sides and only
     closes the disagreement, so this deletes nothing — it is the same choice
     the worker would make card by card, made once. */
  const allSide = async (side) => {
    for (const conflict of conflicts) {
      if (!conflict.server_payload) continue
      await resolve(conflict.id, { resolution: side === 'mine' ? 'kept_local' : 'kept_server' })
    }
    await refresh()
  }

  const reviewable = conflicts.filter((c) => c.server_payload)
  const waiting = conflicts.filter((c) => !c.server_payload)

  return (
    <div className="conflicts" data-width={width} ref={root}>
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

          <div className="conflict-intro">
            <p className="conflict-intro__how">Tap the version you want to keep — it applies straight away.</p>
            <p className="conflict-intro__sync">
              {online
                ? 'Your choice is pushed to the server on the next sync.'
                : 'You are offline. Your choice is saved on this device and pushed when you get signal.'}
            </p>
          </div>

          {reviewable.length > 1 ? (
            <div className="conflict-all">
              <span className="conflict-all__label">All {reviewable.length}</span>
              <Bulk large onPick={allSide} />
            </div>
          ) : null}

          {reviewable.map((conflict) => (
            <Card key={conflict.id} conflict={conflict} onResolve={act} />
          ))}

          {waiting.map((conflict) => (
            <Waiting key={conflict.id} conflict={conflict} onResolve={act} />
          ))}

          <ScrollTop targetRef={root} />
        </>
      )}
    </div>
  )
}

/* The two sides as one control. On the screen-level pair the words are the
   legend for every icon-only row below it; on a card the side is carried by the
   icon and the word is All. */
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
  const heading = conflict.detail ? `${conflict.type} · ${conflict.detail}` : conflict.type
  const count = conflict.rows.length

  /* One tap, one answer. With a field, the server's version is the base and
     only that field comes from this device — everything the worker did not
     touch keeps the value the entity already holds. */
  const keep = (field) => {
    if (!field) return onResolve(conflict.id, { resolution: 'kept_server' })
    const payload = { ...conflict.server_payload }
    payload[field] = conflict.local_payload?.[field] ?? null
    return onResolve(conflict.id, { resolution: 'merged', payload })
  }

  const keepSide = (side) =>
    onResolve(conflict.id, { resolution: side === 'mine' ? 'kept_local' : 'kept_server' })

  return (
    <article className="conflict-card">
      <div className="conflict-card__head">
        <h2 className="conflict-card__name">{heading}</h2>
        {conflict.record ? <p className="conflict-card__meta">{conflict.record}</p> : null}
        {conflict.changedBy ? <p className="conflict-card__meta">{conflict.changedBy}</p> : null}
      </div>

      <div className="conflict-card__bar">
        <span className="conflict-card__count">{count} different</span>
        <span className="spacer" />
        <Bulk onPick={keepSide} count={count} />
      </div>

      <div className="conflict-fields">
        {conflict.rows.map((row) => (
          <div className="conflict-field" key={row.field}>
            <div className="conflict-field__name">{row.label}</div>
            <Value
              source="phone"
              label="This device"
              value={row.mine}
              onSelect={() => keep(row.field)}
            />
            <Value
              source="server"
              label="Server"
              value={row.theirs}
              onSelect={() => keep(null)}
            />
          </div>
        ))}
      </div>
    </article>
  )
}

/* Nothing to compare yet: no second version, so the only honest decision is to
   keep what the server holds and stop the row sitting here forever. */
function Waiting({ conflict, onResolve }) {
  return (
    <div className="conflict-waiting">
      <div className="conflict-waiting__text">
        <span className="conflict-waiting__name">{conflict.type}</span>
        <span className="conflict-waiting__meta">
          {conflict.record ? `${conflict.record} · ` : ''}Waiting for this device to pull the other version
        </span>
      </div>
      <button
        type="button"
        className="conflict-bulk__btn"
        onClick={() => onResolve(conflict.id, { resolution: 'kept_server' })}
        aria-label={`Keep the server's version for ${conflict.type}`}
      >
        Keep server
      </button>
    </div>
  )
}

/*
 * One candidate string. Tapping it keeps it; the icon at the left says where it
 * came from, and that is the whole control — no box, no selected state, because
 * there is nothing to select.
 */
function Value({ source, label, value, onSelect }) {
  return (
    <button
      type="button"
      className="conflict-value"
      aria-label={`Keep ${label}: ${value}`}
      onClick={onSelect}
    >
      <Icon name={source} size={18} />
      <span className="conflict-value__text">{value}</span>
    </button>
  )
}

/* The list is long enough to lose the top of it. Fixed rather than in flow, so
   appearing does not move the card under the worker's thumb. */
function ScrollTop({ targetRef }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = targetRef.current?.closest('.screen-body')
    if (!el) return undefined
    const onScroll = () => setShown(el.scrollTop > 400)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetRef])

  if (!shown) return null

  return (
    <button
      type="button"
      className="scroll-top"
      aria-label="Back to the top"
      onClick={() => targetRef.current?.closest('.screen-body')?.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <Icon name="up" size={24} />
    </button>
  )
}
