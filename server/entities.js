/*
 * Syncable entity registry.
 *
 * The sync engine is generic. Every mutable table declares its columns here
 * once; pull, push and the change log all work off this. No per-entity
 * handler exists, so adding an entity cannot mean forgetting to wire it into
 * sync.
 *
 * Row metadata (behaviors-sync.md §Row metadata) is not listed per column —
 * it is added to every table by schema.js. Columns here are domain columns.
 */

const META = ['rev', 'version', 'updated_at', 'updated_by', 'device_id', 'deleted_at']

export const ENTITIES = {
  customers: {
    table: 'customers',
    pk: 'id',
    columns: ['name', 'address', 'city', 'postal_code', 'phone', 'email', 'created_at'],
  },
  boats: {
    table: 'boats',
    pk: 'id',
    columns: ['customer_id', 'name', 'motor_type', 'model', 'licence', 'trailer_licence', 'rate_type', 'length_ft', 'created_at'],
  },
  boat_serials: {
    table: 'boat_serials',
    pk: 'id',
    columns: ['boat_id', 'type', 'serial_number', 'notes', 'created_at'],
  },
  service_cards: {
    table: 'service_cards',
    pk: 'id',
    columns: [
      'boat_id', 'season_year', 'work_order_no', 'storage_type', 'storage_building', 'storage_row',
      'storage_col', 'boathouse_no', 'slip_no', 'wrap_required', 'unwrap_done', 'remarks',
      'other_work', 'date_in', 'date_out', 'invoice_number', 'invoice_status', 'tax_rate',
      'status', 'created_by', 'customer_token', 'pickup_delivery', 'is_fake', 'is_scanned', 'created_at',
    ],
  },
  received_items: {
    table: 'received_items',
    pk: 'id',
    columns: ['card_id', 'item', 'present', 'notes'],
  },
  authorized_work: {
    table: 'authorized_work',
    pk: 'id',
    columns: ['card_id', 'service_type', 'authorized', 'completed', 'notes', 'completed_by', 'completed_at', 'products_used'],
  },
  condition_assessment: {
    table: 'condition_assessment',
    pk: 'id',
    columns: ['card_id', 'area', 'rating', 'notes'],
  },
  work_logs: {
    table: 'work_logs',
    pk: 'id',
    columns: ['card_id', 'employee_id', 'log_date', 'description', 'transcription', 'created_at'],
  },
  parts_used: {
    table: 'parts_used',
    pk: 'id',
    columns: ['work_log_id', 'part_number', 'description', 'quantity'],
  },
  photos: {
    table: 'photos',
    pk: 'id',
    columns: ['card_id', 'work_log_id', 'filename', 'photo_type', 'caption', 'uploaded_by', 'uploaded_at', 'gps_lat', 'gps_lng'],
  },
  checklist_completions: {
    table: 'checklist_completions',
    pk: 'id',
    columns: ['card_id', 'checklist_type', 'employee_id', 'items_json', 'completed_at'],
  },
  status_history: {
    table: 'status_history',
    pk: 'id',
    columns: ['card_id', 'from_status', 'to_status', 'employee_id', 'changed_at'],
  },
  invoice_items: {
    table: 'invoice_items',
    pk: 'id',
    columns: ['card_id', 'description', 'quantity', 'unit_price', 'total', 'sort_order'],
  },
  boat_assignments: {
    table: 'boat_assignments',
    pk: 'id',
    columns: ['boat_id', 'employee_id', 'assigned_by', 'created_at'],
  },
}

/* Reference data: server-owned, delivered through the same stream.
   `expose` is the allow-list sent to clients; anything absent stays server-side. */
export const REFERENCE = {
  products: {
    table: 'products',
    pk: 'id',
    columns: ['name', 'part_number', 'unit', 'category', 'unit_price', 'active'],
    expose: ['id', 'name', 'part_number', 'unit', 'category', 'unit_price', 'active'],
  },
  service_item_templates: {
    table: 'service_item_templates',
    pk: 'id',
    columns: ['item_key', 'label', 'category', 'cleaning_cat', 'sort_order', 'active', 'unit_price'],
    expose: ['id', 'item_key', 'label', 'category', 'cleaning_cat', 'sort_order', 'active', 'unit_price'],
  },
  storage_layout: {
    table: 'storage_layout',
    pk: 'id',
    columns: ['kind', 'value', 'label', 'sort_order'],
    expose: ['id', 'kind', 'value', 'label', 'sort_order'],
  },
  checklist_templates: {
    table: 'checklist_templates',
    pk: 'id',
    columns: ['checklist_type', 'item_key', 'label', 'category', 'sort_order'],
    expose: ['id', 'checklist_type', 'item_key', 'label', 'category', 'sort_order'],
  },
  employees: {
    table: 'employees',
    pk: 'id',
    columns: ['name', 'role', 'initials', 'pin_salt', 'pin_hash', 'active', 'created_at'],
    /* Explicit allow-list. pin_salt and pin_hash stay on the server — the
       same discipline as the public card endpoint. */
    expose: ['id', 'name', 'role', 'initials', 'active'],
  },
}

export const ALL_TABLES = { ...ENTITIES, ...REFERENCE }

/* Includes the primary key: an insert without it silently produces a row with
   a NULL id, which then cannot be read back. */
export function columnsFor(entity) {
  const spec = ALL_TABLES[entity]
  if (!spec) throw new Error(`Unknown entity: ${entity}`)
  return [spec.pk, ...spec.columns.filter((c) => c !== spec.pk), ...META]
}

export function isKnown(entity) {
  return Object.hasOwn(ENTITIES, entity)
}