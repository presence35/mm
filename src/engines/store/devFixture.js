/*
 * Development fixture — **not** shipped.
 *
 * The app is local-first, so a fresh origin starts with an empty store and there
 * is nothing on screen to look at. This fills a dev store once, through the same
 * `localStore` writes the app uses, so every row behaves like a real one
 * (pending flag, version, ids) and the UI can be judged against a full list.
 *
 * Only `import.meta.env.DEV` reaches this module: `App.jsx` imports it inside a
 * dead branch in a production build. The seed in `seed.js` still invents nothing
 * customer-shaped — that rule is about a real device, not a laptop.
 */

import * as store from './localStore.js'

const CUSTOMERS = [
  { name: 'Sam Okafor', phone: '613-555-0141', city: 'Brockville' },
  { name: 'Joelle Tremblay', phone: '613-555-0172', city: 'Prescott' },
  { name: 'Dana Campbell', phone: '613-555-0118', city: 'Gananoque' },
  { name: 'Chris Craft', phone: '613-555-0163', city: 'Kingston' },
  { name: 'Maple Holdings', phone: '613-555-0199', email: 'dock@maple.example', city: 'Morrisburg' },
]

/* owner is the customer index; the rest is the paper card's boat block. */
const BOATS = [
  { owner: 1, name: 'Tern', motor_type: 'Grew', model: '214', length_ft: 21, licence: 'ON 1104', trailer_licence: 'TR 5540' },
  { owner: 2, name: 'Volvo Penta', motor_type: 'Cobalt', model: 'R5', length_ft: 25, licence: 'ON 7781', trailer_licence: 'TR 2210' },
  { owner: 0, name: 'Sea Ray 270', motor_type: 'Sea Ray', model: '270 Sundancer', length_ft: 28, licence: 'ON 4412', trailer_licence: 'TR 8810' },
  { owner: 3, name: 'Boston Whaler', motor_type: 'Boston Whaler', model: 'Outrage 240', length_ft: 24, licence: 'ON 6690', trailer_licence: 'TR 3372' },
  { owner: 3, name: 'Chris Craft Pirate', motor_type: 'Chris Craft', model: 'Catalina 281', length_ft: 30, licence: 'ON 3308', trailer_licence: 'TR 9915' },
  { owner: 2, name: 'Bayliner', motor_type: 'Bayliner', model: 'VR5', length_ft: 22, licence: 'ON 5540', trailer_licence: 'TR 1180' },
  { owner: 0, name: 'Seadoo', motor_type: 'Sea-Doo', model: 'GTI 130', length_ft: 11, licence: null, trailer_licence: 'TR 4420' },
  { owner: 4, name: 'Northern Spirit', motor_type: 'Stanley', model: '22 Sport', length_ft: 22, licence: 'ON 8873', trailer_licence: 'TR 6601' },
  { owner: 4, name: 'Blue Heron', motor_type: 'Doral', model: '230 BR', length_ft: 23, licence: 'ON 2219', trailer_licence: 'TR 7702' },
  { owner: 1, name: 'Riverbend', motor_type: 'Legend', model: '18 Xcalibur', length_ft: 18, licence: 'ON 4410', trailer_licence: 'TR 3305' },
]

/* One card per stage, plus repeats so a filtered list is more than one row, and
   both storage kinds appear — the map is half the point of the data. */
const CARDS = [
  { boat: 0, status: 'intake', dry: ['1', '1', 'A'], wrap: false },
  { boat: 1, status: 'fall_checklist', dry: ['1', '2', 'B'], wrap: true },
  { boat: 2, status: 'storage', dry: ['2', '3', 'C'], wrap: false },
  { boat: 3, status: 'spring_checklist', dry: ['2', '4', 'D'], wrap: true },
  { boat: 4, status: 'service', water: [1, 3], wrap: false },
  { boat: 5, status: 'cleaning', water: [1, 4], wrap: false },
  { boat: 6, status: 'ready', house: [2, 1], wrap: false },
  { boat: 7, status: 'invoiced', dry: ['3', '1', 'E'], wrap: true },
  { boat: 8, status: 'archived', dry: ['3', '2', 'F'], wrap: false },
  { boat: 9, status: 'service', dry: ['4', '5', 'G'], wrap: false },
  { boat: 2, status: 'ready', house: [2, 2], wrap: false },
  { boat: 5, status: 'cleaning', dry: ['1', '5', 'H'], wrap: true },
]

function locationOf(entry) {
  if (entry.dry) {
    const [storage_building, storage_row, storage_col] = entry.dry
    return { storage_type: 'storage_building', storage_building, storage_row, storage_col }
  }
  const [boathouse_no, slip_no] = entry.water ?? entry.house
  return { storage_type: entry.water ? 'marina_boathouse' : 'customer_boathouse', boathouse_no, slip_no }
}

/* Idempotent: a dev store that already has cards is left alone, so a reload
   never doubles the list and the fixture never argues with synced data. */
export async function seedDevData() {
  if (!import.meta.env.DEV) return { seeded: false }
  if (store.listCards().length) return { seeded: false }

  const now = new Date()
  const dateIn = now.toISOString().slice(0, 10)

  const customers = CUSTOMERS.map((fields) => store.createCustomer(fields))
  const boats = BOATS.map(({ owner, ...fields }) =>
    store.createBoat({ ...fields, customer_id: customers[owner].id }),
  )

  CARDS.forEach((entry, i) => {
    store.createCard({
      customer_id: customers[BOATS[entry.boat].owner].id,
      boat_id: boats[entry.boat].id,
      work_order_no: `WO-${now.getFullYear()}${4100 + i}`,
      status: entry.status,
      date_in: dateIn,
      season_year: now.getFullYear(),
      wrap_required: entry.wrap,
      ...locationOf(entry),
    })
  })

  return { seeded: true, cards: CARDS.length }
}
