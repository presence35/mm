import { Button, Icon, StatusPill, EmptyState } from '../../ui'

/* Photos.
   Photos are online-only by decision (behaviors-sync.md §Photos). The camera
   stays available — a worker must never lose the ability to look at a boat —
   but the shutter lands in a clear, non-dismissible "waiting for signal" state
   that cannot be mistaken for a saved photo. */

export default function PhotoStrip({ photos, online, onAdd, onRetry }) {
  return (
    <section>
      <div className="section-head">Photos</div>

      {!photos.length ? (
        <EmptyState
          icon="camera"
          title="No photos yet"
          body="Photograph any damage at intake — it protects you and the customer later."
          action={{ label: 'Take a photo', icon: 'camera', onClick: onAdd }}
        />
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              overflowX: 'auto',
              padding: 'var(--space-2) var(--space-4)',
            }}
          >
            {photos.map((p) => (
              <figure
                key={p.id}
                style={{
                  margin: 0,
                  minWidth: 132,
                  height: 100,
                  borderRadius: 'var(--corner-m)',
                  background: 'var(--surface-container-highest)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--on-surface-variant)',
                }}
              >
                <Icon name="camera" size={28} />
                {p.caption ? (
                  <figcaption
                    style={{
                      position: 'absolute',
                      font: 'var(--label-s)',
                      color: 'var(--on-surface-variant)',
                      marginTop: 120,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>

          {online ? (
            <div style={{ padding: 'var(--space-2) var(--space-4) 0' }}>
              <Button variant="tonal" icon="camera" onClick={onAdd}>
                Add photo
              </Button>
            </div>
          ) : (
            <div
              style={{
                margin: 'var(--space-3) var(--space-4) 0',
                padding: 'var(--space-4)',
                borderRadius: 'var(--corner-m)',
                background: 'var(--warning-container)',
                color: 'var(--on-warning-container)',
              }}
              role="status"
            >
              <div className="row">
                <StatusPill tone="warn" shape="bar">
                  Waiting for signal
                </StatusPill>
              </div>
              <p style={{ font: 'var(--body-s)', marginTop: 'var(--space-2)' }}>
                The camera works offline, but photos upload when you have service again. Anything you
                write on the card in the meantime is already saved on this device.
              </p>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Button variant="outlined" size="sm" icon="sync" onClick={onRetry}>
                  Retry now
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}