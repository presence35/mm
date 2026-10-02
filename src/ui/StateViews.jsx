import Icon from './Icon'
import { Button } from './Button'

/* The state matrix from architecture.md §8, one component per state.
   A screen missing any of these is incomplete. */

export function Skeleton({ height = 16, width = '100%', radius = 's', style }) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius: `var(--corner-${radius})`, ...style }}
      aria-hidden="true"
    />
  )
}

/* Loading skeleton shaped like the final layout — never a spinner on blank. */
export function LoadingList({ count = 5, lines = 2 }) {
  return (
    <div className="measure" role="status" aria-label="Loading" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <Skeleton height={18} width="55%" />
          {Array.from({ length: lines - 1 }).map((__, j) => (
            <Skeleton key={j} height={12} width={j === 0 ? '80%' : '40%'} style={{ marginTop: 8 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/* Empty must say what would be here AND offer the action that creates it. */
export function EmptyState({ icon = 'cards', title, body, action }) {
  return (
    <div className="state-view">
      <Icon name={icon} size={48} className="state-view__icon" />
      <p className="state-view__title">{title}</p>
      {body ? <p className="state-view__body">{body}</p> : null}
      {action ? (
        <Button variant="tonal" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

/* Error must say what failed and offer a retry that can work. */
export function ErrorState({ title = 'Something went wrong', body, onRetry }) {
  return (
    <div className="state-view" role="alert">
      <Icon name="alert" size={48} className="state-view__icon" />
      <p className="state-view__title">{title}</p>
      {body ? <p className="state-view__body">{body}</p> : null}
      {onRetry ? (
        <Button variant="tonal" icon="sync" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/* Offline is persistent and non-blocking — reads still work. */
export function OfflineBar({ state, pending }) {
  if (state === 'synced' || state === 'idle') return null

  if (state === 'conflict') {
    return (
      <div className="offline-bar offline-bar--conflict" role="status">
        <Icon name="alert" size={18} />
        Needs review — {pending} change{pending === 1 ? '' : 's'} conflicted
      </div>
    )
  }

  if (state === 'syncing') {
    return (
      <div className="offline-bar offline-bar--syncing" role="status" aria-live="polite">
        <Icon name="sync" size={18} />
        Syncing…
      </div>
    )
  }

  return (
    <div className="offline-bar" role="status">
      <Icon name="offline" size={18} />
      Offline — {pending} change{pending === 1 ? '' : 's'} saved on this device
    </div>
  )
}

export function ProgressLinear({ value, indeterminate }) {
  return (
    <div
      className={`progress-linear ${indeterminate ? 'progress-linear--indeterminate' : ''}`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-linear__bar" style={{ width: indeterminate ? undefined : `${value}%` }} />
    </div>
  )
}