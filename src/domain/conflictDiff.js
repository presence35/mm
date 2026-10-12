/*
 * Comparing two versions of the same row.
 *
 * Pure. No React, no store, no clock — this is the part that decides whether a
 * human is being asked a real question, so it is the part that has to be
 * testable. It lives in `domain/` because two layers need it: the conflict
 * screen, and the sweep that closes conflicts nobody needs to see.
 *
 * It used to whitelist ~27 card, boat and customer column names. Child
 * entities — received items, work logs, authorised work, condition notes,
 * invoice lines — contain none of those names, so a conflict on any of them
 * always reported "both versions agree on every field worth showing" while
 * still offering Keep mine / Keep theirs. A worker could discard their own
 * note and never see what they chose between.
 *
 * So the field list is now the union of the two payloads' own keys, minus
 * bookkeeping, and the labels are per entity.
 */

/* Never worth a human decision: row metadata, and columns that describe where
   a row sits rather than what it says. */
const BOOKKEEPING = new Set([
  'version', 'rev', 'updated_at', 'updated_by', 'device_id', 'deleted_at', 'created_at', 'local_pending',
  'id', 'card_id', 'work_log_id', 'boat_id', 'customer_id', 'uploaded_by', 'completed_by', 'assigned_by',
])

const LABELS = {
  customers: 'Customer',
  boats: 'Boat',
  boat_serials: 'Serial number',
  service_cards: 'Card',
  received_items: 'Received item',
  authorized_work: 'Authorised work',
  condition_assessment: 'Condition note',
  work_logs: 'Log entry',
  parts_used: 'Part used',
  photos: 'Photo',
  checklist_completions: 'Checklist',
  status_history: 'Status change',
  invoice_items: 'Invoice line',
  appointments: 'Appointment',
}

/* Field names as they should read on screen, per entity where the same column
   means different things. Falls back to the raw name, which is ugly but never
   absent — an unlabelled difference still beats a hidden one. */
const FIELD_LABELS = {
  customers: {
    name: 'Name', address: 'Address', city: 'City', postal_code: 'Postal code',
    phone: 'Phone', email: 'Email',
  },
  boats: {
    name: 'Name', motor_type: 'Motor', model: 'Model', licence: 'Licence',
    trailer_licence: 'Trailer licence', rate_type: 'Rate', length_ft: 'Length (ft)',
  },
  boat_serials: { type: 'Type', serial_number: 'Serial number', notes: 'Notes' },
  service_cards: {
    storage_type: 'Storage type', storage_building: 'Building', storage_row: 'Row', storage_col: 'Column',
    boathouse_no: 'Boathouse', slip_no: 'Slip', remarks: 'Remarks', other_work: 'Other work',
    pickup_delivery: 'Pickup / delivery', date_in: 'Date in', date_out: 'Date out',
    status: 'Status', wrap_required: 'Shrink wrap', unwrap_done: 'Unwrapped',
    work_order_no: 'Work order', season_year: 'Season', invoice_number: 'Invoice number',
    invoice_status: 'Invoice status', tax_rate: 'Tax rate',
  },
  received_items: { item: 'Item', present: 'Handed over', notes: 'Notes' },
  authorized_work: {
    service_type: 'Service', authorized: 'Authorised', completed: 'Completed',
    notes: 'Notes', completed_at: 'Completed at', products_used: 'Products used',
  },
  condition_assessment: { area: 'Area', rating: 'Rating', notes: 'Note' },
  work_logs: { log_date: 'Date', description: 'Description', transcription: 'Transcription', employee_id: 'Employee' },
  parts_used: { part_number: 'Part number', description: 'Description', quantity: 'Quantity' },
  photos: { filename: 'File', photo_type: 'Category', caption: 'Caption', gps_lat: 'Latitude', gps_lng: 'Longitude' },
  invoice_items: { description: 'Description', quantity: 'Quantity', unit_price: 'Unit price', total: 'Total', sort_order: 'Order' },
  appointments: {
    task_type: 'Task', scheduled_start: 'Starts', scheduled_end: 'Ends',
    status: 'Status', notes: 'Notes', assigned_employee_id: 'Assigned to',
  },
}

export function describe(entity) {
  return LABELS[entity] ?? entity
}

export function fieldLabel(entity, field) {
  return FIELD_LABELS[entity]?.[field] ?? field.replace(/_/g, ' ')
}

/* Columns that are booleans on the wire but integers in the row. Read as words
   so a difference reads as a decision, not as "1" versus "0". */
const BOOLEAN_FIELDS = new Set([
  'present', 'authorized', 'completed', 'wrap_required', 'unwrap_done', 'is_fake', 'is_scanned', 'active',
])

function normalise(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (BOOLEAN_FIELDS.has(field)) {
    if (value === true || value === 1 || value === '1') return 'yes'
    if (value === false || value === 0 || value === '0') return 'no'
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/* Every field that genuinely differs, from the union of both payloads. */
export function differences(conflict) {
  const mine = conflict?.local_payload ?? {}
  const theirs = conflict?.server_payload ?? {}
  const entity = conflict?.entity
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].sort()

  const rows = []
  for (const field of keys) {
    if (BOOKKEEPING.has(field)) continue
    const a = normalise(field, mine[field])
    const b = normalise(field, theirs[field])
    if (a === b) continue
    rows.push({ field, label: fieldLabel(entity, field), mine: a, theirs: b })
  }
  return rows
}

/*
 * A conflict with nothing to decide. Deliberately requires the server's side to
 * be present: "no differences" before the pull has landed means "not comparable
 * yet", which is a different thing and must not be presented as agreement.
 */
export function isSettled(conflict) {
  if (!conflict?.server_payload) return false
  return differences(conflict).length === 0
}
