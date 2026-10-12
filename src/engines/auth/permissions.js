/*
 * Roles → capabilities.
 *
 * Constraint: screens and engines ask "may I do X", never "what is my role".
 * Nothing outside this file compares a role string.
 */

export const CAPABILITIES = {
  CREATE_CUSTOMER: 'customer.create',
  EDIT_CUSTOMER: 'customer.edit',
  CREATE_BOAT: 'boat.create',
  EDIT_BOAT: 'boat.edit',
  ASSIGN_BOAT: 'boat.assign',
  CREATE_CARD: 'card.create',
  WORK_ON_CARD: 'card.work',
  INVOICE: 'card.invoice',
  MANAGE_EMPLOYEES: 'admin.employees',
  BOOK_APPOINTMENT: 'schedule.book',
}

const BY_ROLE = {
  admin: new Set(Object.values(CAPABILITIES)),
  office: new Set([
    CAPABILITIES.CREATE_CUSTOMER,
    CAPABILITIES.EDIT_CUSTOMER,
    CAPABILITIES.CREATE_BOAT,
    CAPABILITIES.EDIT_BOAT,
    CAPABILITIES.ASSIGN_BOAT,
    CAPABILITIES.CREATE_CARD,
    CAPABILITIES.WORK_ON_CARD,
    CAPABILITIES.INVOICE,
    CAPABILITIES.BOOK_APPOINTMENT,
  ]),
  mechanic: new Set([CAPABILITIES.WORK_ON_CARD]),
}

/* Who can be handed a boat to work on.
 *
 * The legacy app offered this to its `mechanic` and `cleaner` roles. Those two
 * no longer exist here — the roles are admin, office and mechanic — so the yard
 * side of the roster is `mechanic` alone. Office and admin keep the capability
 * to *assign*, which is a different question from being assigned. */
const ASSIGNABLE_ROLES = new Set(['mechanic'])

export function canBeAssignedWork(role) {
  return ASSIGNABLE_ROLES.has(role)
}

/* Behaviour 5: office and admin actions never queue offline. Cached
   permissions can be stale, so a permission-gated action refuses rather than
   trusting a snapshot that may predate a demotion. */
const OFFLINE_ALLOWED = new Set([CAPABILITIES.WORK_ON_CARD])

export function can(role, capability) {
  return BY_ROLE[role]?.has(capability) ?? false
}

export function canOffline(role, capability) {
  return can(role, capability) && OFFLINE_ALLOWED.has(capability)
}

export const ROLE_LABEL = {
  admin: 'Admin',
  office: 'Office',
  mechanic: 'Mechanic',
}