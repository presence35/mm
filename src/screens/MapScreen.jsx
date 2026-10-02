import { TopBar, StatusPill, EmptyState } from '../ui'
import { useCards } from '../features/card/useCard.js'
import * as store from '../engines/store/localStore.js'
import { locationSummary } from '../domain/storageLocation.js'
import { statusMeta } from '../domain/cardStatus.js'

/* Where the boat physically is, grouped by storage type. Built in the sync
   phase — for now it reads the same local store as every other screen. */
export default function MapScreen() {
  const cards = useCards()

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
            {items.map(({ card, boat }) => {
              const meta = statusMeta(card.status)
              return (
                <div
                  key={card.id}
                  className="list-item"
                  style={{ cursor: 'default' }}
                >
                  <span className="list-item__text">
                    <span className="list-item__title">{boat?.name || boat?.model || 'Unnamed boat'}</span>
                    <span className="list-item__support">{locationSummary(card)}</span>
                  </span>
                  <span className="list-item__trailing">
                    <StatusPill tone={meta.tone} shape={meta.shape}>
                      {meta.label}
                    </StatusPill>
                  </span>
                </div>
              )
            })}
          </section>
        ))
      )}
    </div>
  )
}