import { ListItem, StatusPill, Chip, ChipRow, Button } from '../../ui'

/* Intake + authorized work.
   Received items are filter chips (toggling presence). Authorized work is a
   list, because each row carries completion state that must survive greyscale
   — the check and the label, not the colour.

   These render section *bodies* only. The title, the one-line summary and the
   open/closed state belong to the Collapsible that wraps them, so every
   section on a card collapses the same way. */

const words = (item) => item.replace(/_/g, ' ')

export function ReceivedItems({ items, selected, onToggle, onPhotograph }) {
  return (
    <ChipRow>
      {items.map((item) => (
        <span key={item} className="intake-item">
          <Chip selected={selected.includes(item)} onClick={() => onToggle(item)}>
            {words(item)}
          </Chip>
          {/* Evidence, offered at the moment the item is recorded rather than
              later on a separate screen. "It came with life jackets" is a
              claim; a photo of those life jackets is proof, and the customer
              dispute happens months afterwards.

              Only present while the item is. The chip names the item, so the
              button beside it does not repeat the name — it says "Photo",
              which is what tapping it does. */}
          {selected.includes(item) ? (
            <Button variant="text" size="sm" icon="camera" onClick={() => onPhotograph?.(item)}>
              Photo
            </Button>
          ) : null}
        </span>
      ))}
    </ChipRow>
  )
}

export function AuthorizedWork({ work, onToggleAuthorized, onToggleCompleted }) {
  if (!work.length) {
    return (
      <p style={{ font: 'var(--body-m)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-4)' }}>
        Nothing authorized yet. Add work before starting service.
      </p>
    )
  }

  return (
    <>
      {work.map((w) => (
        <ListItem
          key={w.key}
          icon={w.completed ? 'check' : w.authorized ? 'wrench' : 'alert'}
          tone={w.completed ? 'done' : w.authorized ? 'action' : 'neutral'}
          title={words(w.key)}
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
    </>
  )
}

/* Wrap / unwrap. A toggle pair, not a chip — this is a state, not a filter. */
export function WrapControl({ wrapRequired, unwrapDone, onChange }) {
  return (
    <>
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
    </>
  )
}
