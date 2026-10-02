/*
 * Seed fixture — Phase 1 only.
 *
 * Backs the local store so the reference screen has something real to render
 * before the sync engine exists. Replaced by IndexedDB + server reference data
 * in the sync phase. Not a fallback, not a mock mode: the store reads this once
 * on a cold, never-synced device.
 */

export const SEED_EMPLOYEE = { id: 'emp-1', name: 'Dana Whitfield', role: 'office', initials: 'DW' }

export const SEED_STORAGE_LAYOUT = {
  buildings: ['Metal 1', 'Metal 2', 'Metal 3', 'Metal 4'],
  boathouse_count: 8,
  boathouse_slips: 10,
  rows: [1, 2, 3, 4, 5],
  cols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
}

export const SEED_RECEIVED_ITEMS = [
  'battery', 'keys', 'cover', 'paddles', 'life_jackets', 'cushions', 'gas_cans', 'tie_ropes', 'lights',
]

export const SEED_AUTHORIZED_WORK = [
  { key: 'oil_change', label: 'Oil & filter' },
  { key: 'outdrive_service', label: 'Outdrive svc' },
  { key: 'tune_up', label: 'Tune-up' },
  { key: 'lower_unit_drain', label: 'Lower unit' },
  { key: 'prop_rebuild', label: 'Prop rebuild' },
]

export const SEED_CONDITIONS = [
  { key: 'top', label: 'Top / canvas' },
  { key: 'hull', label: 'Hull' },
  { key: 'upholstery', label: 'Upholstery' },
  { key: 'motor', label: 'Motor' },
  { key: 'propeller', label: 'Propeller' },
  { key: 'lower_unit', label: 'Lower unit' },
]

export const SEED_CUSTOMERS = [
  { id: 'c-1', name: 'Marcus Reyes', phone: '250-555-0142', email: 'mreyes@example.com', city: 'Campbell River' },
  { id: 'c-2', name: 'Priya Anand', phone: '250-555-0177', email: 'priya.a@example.com', city: 'Courtenay' },
  { id: 'c-3', name: 'Joelle Tremblay', phone: '250-555-0193', email: 'j.tremblay@example.com', city: 'Comox' },
  { id: 'c-4', name: 'Sam Okafor', phone: '250-555-0110', email: 's.okafor@example.com', city: 'Campbell River' },
]

export const SEED_BOATS = [
  { id: 'b-1', customer_id: 'c-1', name: 'Sea Jay', motor_type: 'Outboard', model: 'Yamaha 200', licence: 'BC 4821 TK', trailer_licence: 'TR-2291', length_ft: 24, rate_type: 'SW' },
  { id: 'b-2', customer_id: 'c-2', name: 'Kestrel', motor_type: 'Outboard', model: 'Mercury 150', licence: 'BC 7734 QJ', trailer_licence: 'TR-8810', length_ft: 19, rate_type: 'SW' },
  { id: 'b-3', customer_id: 'c-3', name: null, motor_type: 'Inboard', model: 'Volvo Penta', licence: 'BC 1180 ZX', trailer_licence: null, length_ft: 31, rate_type: 'LW' },
  { id: 'b-4', customer_id: 'c-4', name: 'Tern', motor_type: 'Outboard', model: 'Honda 90', licence: 'BC 3306 HM', trailer_licence: 'TR-4417', length_ft: 16, rate_type: 'SW' },
]

export const SEED_CARDS = [
  {
    id: 'k-1', boat_id: 'b-1', work_order_no: 'WO-2481', season_year: 2026,
    storage_type: 'storage_building', storage_building: 'Metal 2', storage_row: 3, storage_col: 'D',
    boathouse_no: null, slip_no: null,
    date_in: '2026-10-01', date_out: null, status: 'storage',
    remarks: 'Winter storage 2026–2027. Shrink wrap required.',
    other_work: 'Trim sticking when lifting — customer flagged in September, wants it looked at before spring.',
    wrap_required: true, unwrap_done: false, pickup_delivery: null,
    invoice_number: null, invoice_status: null, tax_rate: 0, is_fake: 0, is_scanned: 0,
    received_items: ['battery', 'keys', 'cover', 'tie_ropes'],
    authorized_work: [
      { key: 'outdrive_service', authorized: true, completed: true },
      { key: 'lower_unit_drain', authorized: true, completed: false },
    ],
    condition: [
      { area: 'hull', rating: 'fair', note: 'Scuff on starboard at waterline' },
      { area: 'upholstery', rating: 'poor', note: 'Cushion split, will need replacing' },
    ],
    logs: [
      { id: 'l-1', employee_id: 'emp-2', name: 'Bo', date: '2026-10-01', description: 'Intake — vessel inspected, damage photographed.', transcription: null },
      { id: 'l-2', employee_id: 'emp-3', name: 'Rin', date: '2026-10-01', description: 'Lower unit drained, refill scheduled.', transcription: null },
    ],
    photos: [
      { id: 'p-1', caption: 'Hull at waterline', gps: null },
      { id: 'p-2', caption: 'Cushion split', gps: null },
    ],
  },
  {
    id: 'k-2', boat_id: 'b-2', work_order_no: 'WO-2482', season_year: 2026,
    storage_type: 'marina_boathouse', storage_building: null, storage_row: null, storage_col: null,
    boathouse_no: 3, slip_no: 7,
    date_in: '2026-10-01', date_out: null, status: 'intake',
    remarks: 'Liveaboard — needs power during storage.',
    other_work: null,
    wrap_required: false, unwrap_done: false, pickup_delivery: 'Deliver to slip',
    invoice_number: null, invoice_status: null, tax_rate: 0, is_fake: 0, is_scanned: 1,
    received_items: ['keys', 'cover', 'paddles', 'life_jackets', 'gas_cans'],
    authorized_work: [{ key: 'oil_change', authorized: true, completed: false }],
    condition: [{ area: 'motor', rating: 'good', note: null }],
    logs: [{ id: 'l-3', employee_id: 'emp-2', name: 'Bo', date: '2026-10-01', description: 'Walk-in, paperwork scanned.', transcription: null }],
    photos: [],
  },
  {
    id: 'k-3', boat_id: 'b-3', work_order_no: 'WO-2479', season_year: 2026,
    storage_type: 'water', storage_building: null, storage_row: null, storage_col: null,
    boathouse_no: null, slip_no: null,
    date_in: '2026-09-28', date_out: null, status: 'ready',
    remarks: 'In water over winter — no haul-out.',
    other_work: null,
    wrap_required: false, unwrap_done: false, pickup_delivery: null,
    invoice_number: 'INV-1180', invoice_status: 'issued', tax_rate: 0.05, is_fake: 0, is_scanned: 0,
    received_items: ['keys', 'cover'],
    authorized_work: [{ key: 'tune_up', authorized: true, completed: true }],
    condition: [{ area: 'hull', rating: 'good', note: null }],
    logs: [],
    photos: [],
  },
  {
    id: 'k-4', boat_id: 'b-4', work_order_no: 'WO-2484', season_year: 2026,
    storage_type: 'dry_land', storage_building: null, storage_row: null, storage_col: null,
    boathouse_no: null, slip_no: null,
    date_in: '2026-10-02', date_out: null, status: 'intake',
    remarks: 'Trail-in, arrives on trailer.',
    other_work: 'Paddle loose in port locker.',
    wrap_required: false, unwrap_done: false, pickup_delivery: null,
    invoice_number: null, invoice_status: null, tax_rate: 0, is_fake: 0, is_scanned: 0,
    received_items: ['keys', 'paddles', 'tie_ropes'],
    authorized_work: [],
    condition: [],
    logs: [],
    photos: [],
  },
]

export const SEED_CONFLICT_CARD_ID = 'k-2'