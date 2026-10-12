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
  const code = positionCode(card)
  if (!code) return null
  return (layout ?? []).find((row) => row?.kind === 'position' && row?.value === code) ?? null
}