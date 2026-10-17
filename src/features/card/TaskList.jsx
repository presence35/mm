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
    <>
      <ChipRow>
        {items.map((item) => (
          <Chip key={item} selected={selected.includes(item)} onClick={() => onToggle(item)}>
            {words(item)}
          </Chip>
        ))}
      </ChipRow>

      {/* Evidence, offered at the moment the item is recorded rather than
          later on a separate screen. "It came with life jackets" is a claim;
          a photo of those life jackets is proof, and the customer dispute
          happens months afterwards. */}
      {selected.length ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            alignItems: 'center',
            padding: 'var(--space-2) var(--space-4) var(--space-3)',
          }}
        >
          <span style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>Photograph what was handed over:</span>
          {selected.map((item) => (
            /* Named, not a bare camera glyph: the button opens a file picker,
               so it has to say what the photo is of before it is tapped. */
            <Button key={item} variant="tonal" size="sm" icon="camera" onClick={() => onPhotograph?.(item)}>
              {words(item)}
            </Button>
          ))}
        </div>
      ) : null}

      <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)', padding: '0 var(--space-4) var(--space-4)' }}>
        {selected.length} of {items.length} accounted for
      </p>
    </>
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
          title={words(w.key)}
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
