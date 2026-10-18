/*
 * Storage type and its conditional location fields.
 *
 * Constraint 12: an invalid combination must be *unrepresentable*, not merely
 * hidden. `normalizeLocation` is the only sanctioned way to change storage
 * type or location — it strips every field that the chosen type cannot use, so
 * no caller can persist `storage_type: 'storage_building'` alongside a stray
 * `slip_no`.
 */

export const STORAGE_TYPES = [
  { value: 'customer_boathouse', label: 'Customer boathouse' },
  { value: 'marina_boathouse', label: 'Marina boathouse' },
  { value: 'storage_building', label: 'Storage building' },
  { value: 'dry_land', label: 'Dry land' },
  { value: 'covered', label: 'Covered' },
  { value: 'water', label: 'In water' },
]

const BOATHOUSE_TYPES = ['customer_boathouse', 'marina_boathouse']

const FIELDS_BY_TYPE = {
  customer_boathouse: ['boathouse_no', 'slip_no'],
  marina_boathouse: ['boathouse_no', 'slip_no'],
  storage_building: ['storage_building', 'storage_row', 'storage_col'],
  dry_land: [],
  covered: [],
  water: [],
}

const ALL_LOCATION_FIELDS = ['boathouse_no', 'slip_no', 'storage_building', 'storage_row', 'storage_col']

export function locationFieldsFor(storageType) {
  return FIELDS_BY_TYPE[storageType] ?? []
}

export function isBoathouse(storageType) {
  return BOATHOUSE_TYPES.includes(storageType)
}

export function needsLocation(storageType) {
  return locationFieldsFor(storageType).length > 0
}

/* Strip every location field the new type cannot use. Returns a new object. */
export function normalizeLocation(card, storageType) {
  const allowed = new Set(locationFieldsFor(storageType))
  const next = { ...card, storage_type: storageType }
  for (const f of ALL_LOCATION_FIELDS) {
    if (!allowed.has(f)) next[f] = null
  }
  return next
}

/* Human summary for list rows and the map. */
export function locationSummary(card) {  switch (card.storage_type) {
    case 'customer_boathouse':
    case 'marina_boathouse':
      return [card.boathouse_no && `BH ${card.boathouse_no}`, card.slip_no && `Slip ${card.slip_no}`]
        .filter(Boolean)
        .join(' · ') || 'Boathouse — no location'
    case 'storage_building':
      return (
        [card.storage_building, card.storage_row && `Row ${card.storage_row}`, card.storage_col && `Col ${card.storage_col}`]
          .filter(Boolean)
          .join(' · ') || 'Storage — no location'
      )
    case 'dry_land':
      return 'Dry land'
    case 'covered':
      return 'Covered'
    case 'water':
      return 'In water'
    default:
      return '—'
  }
}

/* ------------------------------------------------------- position size
 *
 * A storage position carries imperial dimensions, because the marina's
 * measurements are imperial and the paper card is too. There is no metric
 * toggle; a toggle would have to pick a canonical unit, and picking metric
 * would silently disagree with every existing number.
 *
 * Classed by LENGTH, not volume: length is what decides whether a boat fits,
 * which is why `Boat.length_ft` exists. Height is reported separately because
 * a top spot's roof slopes, and height is what decides whether a boat with a
 * tower can go in at all.
 */

export const SIZE_CLASSES = [
  { key: 'small', label: 'Small', tone: 'neutral', shape: 'square', maxLengthFt: 20 },
  { key: 'medium', label: 'Medium', tone: 'progress', shape: 'diamond', maxLengthFt: 26 },
  { key: 'large', label: 'Large', tone: 'action', shape: 'round', maxLengthFt: Infinity },
]

export const UNKNOWN_SIZE = { key: 'unknown', label: 'No size', tone: 'neutral', shape: 'square', maxLengthFt: 0 }

export function sizeClassFor(position) {
  const length = Number(position?.length_ft)
  if (!Number.isFinite(length) || length <= 0) return UNKNOWN_SIZE
  return SIZE_CLASSES.find((c) => length <= c.maxLengthFt) ?? UNKNOWN_SIZE
}

/* Heights differ front to back when the roof slopes. Returns the range, or one
   number when they match — a single "7 ft" reads better than "7–7 ft". */
export function heightSummary(position) {
  const front = Number(position?.height_front_ft)
  const back = Number(position?.height_back_ft)
  const hasFront = Number.isFinite(front) && front > 0
  const hasBack = Number.isFinite(back) && back > 0
  if (hasFront && hasBack) return front === back ? `${front} ft` : `${Math.min(front, back)}–${Math.max(front, back)} ft`
  if (hasFront) return `${front} ft`
  if (hasBack) return `${back} ft`
  return null
}

export function dimensionSummary(position) {
  const length = Number(position?.length_ft)
  const width = Number(position?.width_ft)
  const height = heightSummary(position)
  const parts = []
  if (Number.isFinite(length) && length > 0) parts.push(`${length} ft long`)
  if (Number.isFinite(width) && width > 0) parts.push(`${width} ft wide`)
  if (height) parts.push(`${height} high`)
  return parts.join(' · ') || null
}

/* ---------------------------------------------------- position identity
 *
 * A card names a position; `storage_layout` describes it. They meet on a code.
 *
 * This is a stated convention, not a discovery: a layout row of `kind:
 * 'position'` whose `value` is this code carries that position's dimensions
 * and its prior-year occupant. A row that does not exist is not an error — the
 * map says "no size" rather than guessing one from the boat.
 */
export function positionCode(card) {
  switch (card?.storage_type) {
    case 'storage_building':
      return [card.storage_building, card.storage_row, card.storage_col].filter((v) => v !== null && v !== undefined && v !== '').join('/') || null
    case 'customer_boathouse':
    case 'marina_boathouse':
      return `BH${card.boathouse_no ?? '?'}/S${card.slip_no ?? '?'}`
    default:
      return null
  }
}

export function findPosition(layout, card) {
  return positionByCode(layout, positionCode(card))
}

/* ----------------------------------------------------------- the map views
 *
 * The Map draws three views of the same fact: where boats are. A flat list,
 * a building grid, and a boathouse grid.
 *
 * All three are built here rather than in the screen, because the grid is a rule
 * about positions, not a layout detail: a cell exists at building/row/column and
 * the boat in it is the card whose location code is that cell. Written in the
 * screen, "which boat is in Metal 2 row 3 column D" would be answered a second
 * time, next to the answer in positionCode, and the two would drift.
 *
 * Pure: the marina's shape arrives as an argument. It is never read from the
 * seed fixture here, so a server that learns a new building changes the grid
 * without a release.
 */

const present = (v) => v !== null && v !== undefined && v !== ''

export function buildingCode(building, row, col) {
  return [building, row, col].join('/')
}

export function boathouseCode(no, slip) {
  return `BH${no}/S${slip}`
}

export function positionByCode(layout, code) {
  if (!code) return null
  return (layout ?? []).find((row) => row?.kind === 'position' && row?.value === code) ?? null
}

export function cardsInBuilding(cards, building) {
  return (cards ?? []).filter((c) => c.storage_type === 'storage_building' && c.storage_building === building)
}

export function cardsInBoathouse(cards, boathouseNo) {
  return (cards ?? []).filter((c) => isBoathouse(c.storage_type) && Number(c.boathouse_no) === Number(boathouseNo))
}

/* A building is drawn when it holds something: a boat, or a measured position
 * that no boat currently occupies (last year's spot, which is exactly what
 * someone is asking about). A building the app knows nothing about stays out
 * rather than appearing as a page of empty boxes. */
export function buildingsToDraw({ cards, layout, shape }) {
  return (shape?.buildings ?? []).filter(
    (b) =>
      cardsInBuilding(cards, b).length > 0 ||
      (layout ?? []).some((r) => r?.kind === 'position' && String(r.value ?? '').startsWith(`${b}/`)),
  )
}

/*
 * One building's grid.
 *
 * Drawn the way the shed is stencilled: the letters run down the side and the
 * numbers across the top, so a building 26 columns wide is a tall list on a
 * phone instead of a table that has to be scrolled sideways. The code a cell
 * carries is untouched by that — it is still "building/row/column" — so nothing
 * downstream has to know which axis it is drawn on.
 *
 * Dimensions belong to the position, so a cell carries the position as well as
 * the card: an empty cell with a recorded size is still worth showing, and a
 * boat in a cell the layout does not describe gets "No size" rather than a size
 * guessed from the boat. `unplaced` holds cards parked in this building with no
 * row or column — a half-entered location is a thing to fix, not a thing to
 * silently drop off the map.
 */
export function buildingGrid({ building, cards, layout, shape }) {
  const here = cardsInBuilding(cards, building)
  const across = shape?.rows ?? []
  const down = shape?.cols ?? []

  const cells = new Map()
  const unplaced = []
  for (const card of here) {
    if (!present(card.storage_row) || !present(card.storage_col)) {
      unplaced.push(card)
      continue
    }
    cells.set(`${building}/${card.storage_row}/${card.storage_col}`, card)
  }

  return {
    building,
    cols: across,
    unplaced,
    rows: down.map((letter) => ({
      row: letter,
      cells: across.map((number) => {
        const code = buildingCode(building, number, letter)
        return { code, col: number, card: cells.get(code) ?? null, position: positionByCode(layout, code) }
      }),
    })),
  }
}

/*
 * How full the marina is.
 *
 * Capacity is what the marina has declared — every building's rows and columns,
 * every boathouse's slips — so it does not shrink as buildings empty out: an
 * empty building is the emptiest state, not a smaller marina. A boat occupies a
 * slot by being in a storage building or a marina boathouse; dry land has no
 * slots to fill, and a customer's own boathouse is not the marina's to count.
 */
export function marinaFill({ cards, shape }) {
  const capacity =
    (shape?.buildings ?? []).length * (shape?.rows ?? []).length * (shape?.cols ?? []).length +
    Number(shape?.boathouseCount ?? 0) * Number(shape?.boathouseSlips ?? 0)
  const occupied = (cards ?? []).filter(
    (c) => c.storage_type === 'storage_building' || c.storage_type === 'marina_boathouse',
  ).length
  return { occupied, capacity }
}

export function boathousesToDraw(shape) {
  return Array.from({ length: Number(shape?.boathouseCount ?? 0) }, (_, i) => i + 1)
}
/* Same shape as a building grid, one row of slips instead of rows of columns. */
export function boathouseGrid({ boathouse, cards, layout, shape }) {
  const here = cardsInBoathouse(cards, boathouse)
  const slips = Array.from({ length: Number(shape?.boathouseSlips ?? 0) }, (_, i) => i + 1)

  const cells = new Map()
  const unplaced = []
  for (const card of here) {
    if (!present(card.slip_no)) {
      unplaced.push(card)
      continue
    }
    cells.set(`${boathouse}/${card.slip_no}`, card)
  }

  return {
    boathouse,
    unplaced,
    slips: slips.map((slip) => {
      const code = boathouseCode(boathouse, slip)
      return { code, col: slip, card: cells.get(`${boathouse}/${slip}`) ?? null, position: positionByCode(layout, code) }
    }),
  }
}

/*
 * The List view: every card with a location, grouped by storage type.
 *
 * Grouped in the storage types' declared order rather than by whatever key the
 * cards happen to come in, so the screen reads the same way twice, and "Dry
 * land" does not float above "Storage building" on a different day.
 *
 * `unset` is a real answer here: a card with no storage type yet is a card
 * nobody has placed, and the group says so instead of hiding it.
 */
export function groupByStorageType(cards) {
  const groups = new Map()
  for (const card of cards ?? []) {
    const key = card.storage_type ?? 'unset'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(card)
  }
  const order = [...STORAGE_TYPES.map((t) => t.value), 'unset']
  return order
    .filter((key) => groups.has(key))
    .map((key) => ({
      type: key,
      label: STORAGE_TYPES.find((t) => t.value === key)?.label ?? 'No location set',
      items: groups.get(key),
    }))
}