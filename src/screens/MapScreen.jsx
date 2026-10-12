import { TopBar, StatusPill, EmptyState, Card } from '../ui'
import { useCards } from '../features/card/useCard.js'
import * as store from '../engines/store/localStore.js'
import { locationSummary, sizeClassFor, dimensionSummary, findPosition } from '../domain/storageLocation.js'
import { statusMeta } from '../domain/cardStatus.js'

/* Where the boat physically is, grouped by storage type.
 *
 * Each slot is its own container: the dimensions and the size class belong to
 * the position, not to the card, and a flat run of rows made a building's
 * slots read as one continuous list. The size class is colour *and* a label
 * *and* a shape, so the chart survives greyscale and a colour-blind worker.
 *
 * A position the layout does not describe says "No size" rather than guessing
 * one from the boat — a wrong size class is worse than an absent one when
 * someone is deciding whether a boat will fit. */
export default function MapScreen() {
  const cards = useCards()
  const layout = store.listStorageLayout()

  const groups = cards.reduce((acc, card) => {
    const key = card.storage_type ?? 'unset'
    const loc = store.getCard(card.id)
    ;(acc[key] ||= []).push({ card, boat: loc?.boat, customer: loc?.customer })
    return acc
  }, {})

  return (
    <div>
      <TopBar title="Map" />
      {!cards.length ? (
        <EmptyState icon="map" title="Nothing placed yet" body="Cards appear here once they are given a storage location." />
      ) : (
        Object.entries(groups).map(([type, items]) => (
          <section key={type}>
            <div className="section-head">
              {type.replace(/_/g, ' ')} · {items.length}
            </div>
            <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {items.map(({ card, boat, customer }) => {
                const meta = statusMeta(card.status)
                const position = findPosition(layout, card)
                const size = sizeClassFor(position)
                const dims = dimensionSummary(position)
                return (
                  <Card key={card.id} variant="outlined">
                    <div className="list-item" style={{ cursor: 'default' }}>
                      <span className="list-item__text">
                        <span className="list-item__title">{boat?.name || boat?.model || 'Unnamed boat'}</span>
                        <span className="list-item__support">{locationSummary(card)}</span>
                        {customer?.name ? (
                          <span className="list-item__support">{customer.name}</span>
                        ) : null}
                      </span>
                      <span className="list-item__trailing">
                        <StatusPill tone={meta.tone} shape={meta.shape}>
                          {meta.label}
                        </StatusPill>
                      </span>
                    </div>
                    <div
                      className="row"
                      style={{
                        gap: 'var(--space-2)',
                        padding: 'var(--space-2) var(--space-4) var(--space-3)',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <StatusPill tone={size.tone} shape={size.shape}>
                        {size.label}
                      </StatusPill>
                      {dims ? (
                        <span style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>{dims}</span>
                      ) : (
                        <span style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
                          No dimensions recorded
                        </span>
                      )}
                      {/* A hint for who is asking for the spot back, never a
                          reservation. */}
                      {position?.prior_year_customer ? (
                        <span style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
                          Last year: {position.prior_year_customer}
                        </span>
                      ) : null}
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
