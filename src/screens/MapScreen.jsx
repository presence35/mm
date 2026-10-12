import { useState } from 'react'
import { TopBar, StatusPill, EmptyState, Card, Segmented, Chip, ChipRow, SlotGrid, ListItem } from '../ui'
import { useRouter } from '../shell/RouterProvider.jsx'
import { useCards } from '../features/card/useCard.js'
import * as store from '../engines/store/localStore.js'
import {
  locationSummary,
  sizeClassFor,
  dimensionSummary,
  findPosition,
  groupByStorageType,
  buildingsToDraw,
  buildingGrid,
  boathousesToDraw,
  boathouseGrid,
} from '../domain/storageLocation.js'
import { statusMeta } from '../domain/cardStatus.js'

/* Where the boat physically is.
 *
 * Three views of one fact, in the order the legacy app offered them: a flat list
 * grouped by storage type, the buildings laid out as a grid, and the boathouses
 * laid out by slip. Workers already read the map this way, and the switcher only
 * offers a view the data can actually fill — a Buildings tab over four empty
 * buildings is worse than no tab.
 *
 * The grid itself is not built here. "Which boat is in Metal 2 row 3 column D"
 * is the same question `positionCode` answers, and the answer lives in
 * domain/storageLocation.js so the list and the grid cannot drift apart.
 *
 * Dimensions and the size class belong to the *position*, never to the boat, so
 * a spot the layout does not describe says "No size" rather than guessing one
 * from the boat — a wrong size class is worse than an absent one when someone is
 * deciding whether a boat will fit.
 */

/* A cell is 48px: enough for a few letters before the ellipsis. The full name
   and the status are always in the accessible label, so nothing is lost. */
const SLOT_TEXT_CHARS = 5

export default function MapScreen() {
  const { navigate } = useRouter()
  const cards = useCards()
  const layout = store.listStorageLayout()
  const shape = store.getStorageShape()
  const [view, setView] = useState('list')
  const [building, setBuilding] = useState(null)

  /* Boat and customer per card, looked up once for whichever view is showing.
     Every occupied cell needs the boat's name, and a per-cell lookup would walk
     the boats list dozens of times per render. */
  const aboard = new Map(cards.map((c) => [c.id, store.getCard(c.id)]))
  const nameOf = (card) => {
    const boat = aboard.get(card.id)?.boat
    return boat?.name || boat?.model || 'Unnamed boat'
  }

  const buildings = buildingsToDraw({ cards, layout, shape })
  const boathouses = boathousesToDraw(shape)
  const hasBoathouses = cards.some((c) => c.storage_type === 'marina_boathouse' || c.storage_type === 'customer_boathouse')

  const views = [
    { value: 'list', label: 'List' },
    ...(buildings.length ? [{ value: 'buildings', label: 'Buildings' }] : []),
    ...(hasBoathouses ? [{ value: 'boathouses', label: 'Boathouses' }] : []),
  ]
  /* A view can stop being offered while it is selected — the last boat leaves
     the buildings, or a sync replaces the layout. Fall back rather than render
     a tab that is no longer there. */
  const active = views.some((v) => v.value === view) ? view : 'list'

  /* One cell model, shared by both grids: tone and shape for the eye, words for
     the screen reader. Built from statusMeta and sizeClassFor, so a cell and a
     pill showing the same status are decided in one place. */
  const cellFor = (cell) => {
    const position = cell.position
    const size = sizeClassFor(position)
    const dims = dimensionSummary(position)

    if (!cell.card) {
      return {
        key: cell.code,
        text: '',
        tone: position ? size.tone : null,
        shape: position ? size.shape : null,
        label: position
          ? `${cell.code} — vacant. ${size.label}${dims ? `, ${dims}` : ''}`
          : `${cell.code} — vacant, no size recorded`,
      }
    }

    const meta = statusMeta(cell.card.status)
    const name = nameOf(cell.card)
    return {
      key: cell.code,
      card: cell.card,
      tone: meta.tone,
      shape: meta.shape,
      text: name.slice(0, SLOT_TEXT_CHARS),
      label: `${cell.code} — ${name}. ${meta.label}. ${position ? size.label : 'No size recorded'}`,
    }
  }

  const openCard = (card) => navigate('card', { id: card.id })

  if (!cards.length) {
    return (
      <div>
        <TopBar title="Map" />
        <EmptyState icon="map" title="Nothing placed yet" body="Cards appear here once they are given a storage location." />
      </div>
    )
  }

  return (
    <div>
      <TopBar title="Map" />

      {views.length > 1 ? (
        <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
          <Segmented options={views} value={active} onChange={setView} ariaLabel="Map view" />
        </div>
      ) : null}

      {active === 'list' ? <ListView cards={cards} aboard={aboard} layout={layout} /> : null}

      {active === 'buildings' ? (
        <div>
          {buildings.length > 1 ? (
            <div style={{ paddingBottom: 'var(--space-3)' }}>
              <ChipRow>
                <Chip selected={!building} onClick={() => setBuilding(null)}>
                  All
                </Chip>
                {buildings.map((b) => (
                  <Chip key={b} selected={building === b} onClick={() => setBuilding(building === b ? null : b)}>
                    {b}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          ) : null}

          {buildings
            .filter((b) => !building || b === building)
            .map((b) => {
              const grid = buildingGrid({ building: b, cards, layout, shape })
              const occupied = grid.rows.reduce((n, r) => n + r.cells.filter((c) => c.card).length, 0)
              return (
                <section key={b}>
                  <div className="section-head">
                    {b} · {occupied} of {grid.rows.length * grid.cols.length}
                  </div>
                  <SlotGrid
                    caption={`${b}: ${grid.rows.length} rows by ${grid.cols.length} columns`}
                    columns={grid.cols}
                    rows={grid.rows.map((r) => ({
                      key: r.row,
                      label: r.row,
                      cells: r.cells.map(cellFor),
                    }))}
                    onSelect={openCard}
                  />
                  {grid.unplaced.length ? (
                    <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                      <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
                        {grid.unplaced.length} boat{grid.unplaced.length === 1 ? '' : 's'} in {b} with no row or
                        column recorded:
                      </p>
                      {grid.unplaced.map((c) => (
                        <ListItem
                          key={c.id}
                          icon="boat"
                          title={`${c.work_order_no} · ${nameOf(c)}`}
                          support={locationSummary(c)}
                          onClick={() => openCard(c)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              )
            })}
        </div>
      ) : null}

      {active === 'boathouses' ? (
        <div>
          {boathouses.map((no) => {
            const grid = boathouseGrid({ boathouse: no, cards, layout, shape })
            return (
              <section key={no}>
                {/* Legacy's heading, kept: "2/10 occupied" is the number people
                    ask for out loud. */}
                <div className="section-head">
                  Boathouse {no} · {grid.occupied}/{grid.slips.length} occupied
                </div>
                <SlotGrid
                  caption={`Boathouse ${no}, slips 1 to ${grid.slips.length}`}
                  columns={grid.slips.map((s) => s.col)}
                  rows={[{ key: 'slips', label: 'Slip', cells: grid.slips.map(cellFor) }]}
                  onSelect={openCard}
                />
                {grid.unplaced.length ? (
                  <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                    <p style={{ font: 'var(--body-s)', color: 'var(--on-surface-variant)' }}>
                      {grid.unplaced.length} boat{grid.unplaced.length === 1 ? '' : 's'} here with no slip recorded:
                    </p>
                    {grid.unplaced.map((c) => (
                      <ListItem
                        key={c.id}
                        icon="boat"
                        title={`${c.work_order_no} · ${nameOf(c)}`}
                        support={locationSummary(c)}
                        onClick={() => openCard(c)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/* The list keeps the detail the grid cannot carry: dimensions, the size class in
   words, and last year's occupant, who is a hint for who will ask for the spot
   back and never a reservation. Rows are read-only, as they were before. */
function ListView({ cards, aboard, layout }) {
  return (
    <div>
      {groupByStorageType(cards).map((group) => (
        <section key={group.type}>
          <div className="section-head">
            {group.label} · {group.items.length}
          </div>
          <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {group.items.map((card) => {
              const loc = aboard.get(card.id)
              const meta = statusMeta(card.status)
              const position = findPosition(layout, card)
              const size = sizeClassFor(position)
              const dims = dimensionSummary(position)
              return (
                <Card key={card.id} variant="outlined">
                  <div className="list-item" style={{ cursor: 'default' }}>
                    <span className="list-item__text">
                      <span className="list-item__title">{loc?.boat?.name || loc?.boat?.model || 'Unnamed boat'}</span>
                      <span className="list-item__support">{locationSummary(card)}</span>
                      {loc?.customer?.name ? <span className="list-item__support">{loc.customer.name}</span> : null}
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
      ))}
    </div>
  )
}
