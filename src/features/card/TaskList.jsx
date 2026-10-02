import { ListItem, Icon, StatusPill, Chip, ChipRow } from '../../ui'

/* Intake + authorized work.
   Received items are filter chips (toggling presence). Authorized work is a
   list, because each row carries completion state that must survive greyscale
   — the check and the label, not the colour. */

export function ReceivedItems({ items, selected, onToggle }) {
  return (
    <section>
      <div className="section-head">Items received at intake</div>
      <ChipRow>
        {items.map((item) => (
          <Chip key={item} selected={selected.includes(item)} onClick={() => onToggle(item)}>
            {item.replace(/_/g, ' ')}
          </Chip>
        ))}
      </ChipRow>
      <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: 'var(--space-2) var(--space-4) var(--space-4)' }}>
        {selected.length} of {items.length} accounted for
      </p>
    </section>
  )
}

export function AuthorizedWork({ work, onToggleAuthorized, onToggleCompleted }) {
  if (!work.length) {
    return (
      <section>
        <div className="section-head">Authorized work</div>
        <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-4)' }}>
          Nothing authorized yet. Add work before starting service.
        </p>
      </section>
    )
  }

  return (
    <section>
      <div className="section-head">Authorized work</div>
      {work.map((w) => (
        <ListItem
          key={w.key}
          icon={w.completed ? 'check' : w.authorized ? 'wrench' : 'alert'}
          title={w.key.replace(/_/g, ' ')}
          support={w.completed ? 'Completed' : w.authorized ? 'Authorized — not started' : 'Not authorized'}
          onClick={() => (w.authorized ? onToggleCompleted(w.key) : onToggleAuthorized(w.key))}
          trailing={
            w.completed ? (
              <StatusPill tone="done" shape="ring">
                Done
              </StatusPill>
            ) : w.authorized ? (
              <StatusPill tone="action" shape="round">
                To do
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" shape="square">
                Not auth
              </StatusPill>
            )
          }
        />
      ))}
    </section>
  )
}

/* Wrap / unwrap. A toggle pair, not a chip — this is a state, not a filter. */
export function WrapControl({ wrapRequired, unwrapDone, onChange }) {
  return (
    <section>
      <div className="section-head">Storage prep</div>
      <ListItem
        icon="bolt"
        title="Shrink wrap required"
        support={wrapRequired ? 'Worker will wrap before storage' : 'Not being wrapped'}
        onClick={() => onChange({ wrap_required: !wrapRequired })}
        trailing={
          <StatusPill tone={wrapRequired ? 'action' : 'neutral'} shape={wrapRequired ? 'diamond' : 'square'}>
            {wrapRequired ? 'Wrap' : 'No wrap'}
          </StatusPill>
        }
      />
      {wrapRequired ? (
        <ListItem
          icon="check"
          title="Unwrapped"
          support={unwrapDone ? 'Boat has been unwrapped' : 'Still wrapped'}
          onClick={() => onChange({ unwrap_done: !unwrapDone })}
          trailing={
            <StatusPill tone={unwrapDone ? 'done' : 'warn'} shape={unwrapDone ? 'ring' : 'bar'}>
              {unwrapDone ? 'Done' : 'Wrapped'}
            </StatusPill>
          }
        />
      ) : null}
    </section>
  )
}