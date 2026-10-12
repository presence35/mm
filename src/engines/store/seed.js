/*
 * Studio defaults — what the app needs before it has ever reached a server.
 *
 * Deliberately *not* sample data. This file used to carry a whole fabricated
 * marina — five customers, five boats, five cards, appointments, measured
 * positions — and the cold-device path not only rendered it, it queued it. A
 * brand-new phone pointed at production therefore pushed five invented customers
 * and their boats into the real database. `server/legacy/import.js` still carries
 * a message apologising for that having happened once.
 *
 * So there is no sample marina any more, and none of this is a fallback to
 * render in its place. What is left is the three things the app genuinely cannot
 * invent a first-run substitute for:
 *
 *   - the roster, so the sign-in picker is not empty (you cannot sync until you
 *     have signed in)
 *   - the marina's shape, so the location pickers and the map have buildings,
 *     rows, columns and boathouses before the server has said what they are
 *     (behaviors-sync.md §Reference data — server-owned, bootstrapped once)
 *   - the paper card's field sets, which are the form itself and not data
 *
 * None of it is queued: the roster and the layout are server-owned reference
 * data, and the field sets never leave the client.
 */

/*
 * The roster a fresh install starts with.
 *
 * One person, and it is the same one the server seeds. Anything else is a name
 * that does not exist there: picking them at sign-in fails, which reads as a
 * broken app rather than a placeholder. The server's real roster replaces this
 * on the first sync and everyone is offered from then on.
 *
 * It exists because the alternative is a sign-in picker with nobody in it, and
 * you cannot sync until you have signed in.
 */
export const SEED_STAFF = [{ id: 'emp-admin', name: 'Admin', role: 'admin', initials: 'AD', active: 1 }]

/*
 * The marina's shape: buildings, rows, columns, boathouses, slips.
 *
 * A bootstrap snapshot of server-owned reference data, not a fixture the app
 * falls back to: `getStorageShape()` prefers `storage_layout` rows of kind
 * `building` / `row` / `col` / `boathouse` / `slip` and only reaches for this
 * when the device has never synced. A marina that adds a fifth building is a row
 * on the server, not a release.
 *
 * Dimensions are not here. A position's size belongs to the position, which is
 * reference data the server owns; inventing one here would be a size guessed for
 * a spot nobody measured.
 */
export const SEED_STORAGE_LAYOUT = {
  buildings: ['Metal 1', 'Metal 2', 'Metal 3', 'Metal 4'],
  boathouse_count: 8,
  boathouse_slips: 10,
  rows: [1, 2, 3, 4, 5],
  cols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
}

/* The paper intake card's field sets. Constraint 11 freezes the field set, the
   order and the grouping — these are that card, and they are not sample rows. */

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
