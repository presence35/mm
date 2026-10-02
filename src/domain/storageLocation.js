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
export function locationSummary(card) {
  switch (card.storage_type) {
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