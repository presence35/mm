import test from 'node:test'
import assert from 'node:assert/strict'

import { CAPABILITIES, can, canOffline, canBeAssignedWork } from './permissions.js'

test('mechanic works on cards and nothing else', () => {
  assert.ok(can('mechanic', CAPABILITIES.WORK_ON_CARD))
  assert.ok(!can('mechanic', CAPABILITIES.CREATE_CUSTOMER))
  assert.ok(!can('mechanic', CAPABILITIES.CREATE_CARD))
  assert.ok(!can('mechanic', CAPABILITIES.INVOICE))
  assert.ok(!can('mechanic', CAPABILITIES.MANAGE_EMPLOYEES))
})

test('office does everything except employees', () => {
  assert.ok(can('office', CAPABILITIES.CREATE_CUSTOMER))
  assert.ok(can('office', CAPABILITIES.INVOICE))
  assert.ok(can('office', CAPABILITIES.BOOK_APPOINTMENT))
  assert.ok(!can('office', CAPABILITIES.MANAGE_EMPLOYEES))
})

test('a mechanic cannot book an appointment, only work on cards', () => {
  assert.ok(!can('mechanic', CAPABILITIES.BOOK_APPOINTMENT))
})

test('admin holds every capability', () => {
  for (const c of Object.values(CAPABILITIES)) assert.ok(can('admin', c), c)
})

test('only card work is allowed offline; office and admin actions refuse', () => {
  assert.ok(canOffline('mechanic', CAPABILITIES.WORK_ON_CARD))
  assert.ok(!canOffline('office', CAPABILITIES.INVOICE))
  assert.ok(!canOffline('office', CAPABILITIES.CREATE_CUSTOMER))
  assert.ok(!canOffline('admin', CAPABILITIES.MANAGE_EMPLOYEES))
  /* Booking is the case that matters most: two phones off the network would
     otherwise both believe they hold the ramp. */
  assert.ok(!canOffline('office', CAPABILITIES.BOOK_APPOINTMENT))
  assert.ok(!canOffline('admin', CAPABILITIES.BOOK_APPOINTMENT))
})

test('unknown role or capability is denied, never throws', () => {
  assert.ok(!can('cleaner', CAPABILITIES.WORK_ON_CARD))
  assert.ok(!can('mechanic', 'card.launch'))
  assert.ok(!canOffline('mechanic', 'card.launch'))
})

/* ------------------------------------------------------- editing a boat */

test('editing and assigning a boat are office and admin work, not the yard', () => {
  assert.ok(can('office', CAPABILITIES.EDIT_BOAT))
  assert.ok(can('office', CAPABILITIES.ASSIGN_BOAT))
  assert.ok(can('admin', CAPABILITIES.EDIT_BOAT))
  assert.ok(can('admin', CAPABILITIES.ASSIGN_BOAT))
  assert.ok(!can('mechanic', CAPABILITIES.EDIT_BOAT))
  assert.ok(!can('mechanic', CAPABILITIES.ASSIGN_BOAT))
})

test('a boat edit refuses offline rather than queueing, like every other office action', () => {
  assert.ok(!canOffline('office', CAPABILITIES.EDIT_BOAT))
  assert.ok(!canOffline('admin', CAPABILITIES.EDIT_BOAT))
  assert.ok(!canOffline('office', CAPABILITIES.ASSIGN_BOAT))
})

test('only mechanics can be assigned work, which is what replaced the old cleaner role', () => {
  assert.ok(canBeAssignedWork('mechanic'))
  assert.ok(!canBeAssignedWork('office'))
  assert.ok(!canBeAssignedWork('admin'))
  assert.ok(!canBeAssignedWork('cleaner'))
  assert.ok(!canBeAssignedWork(undefined))
})
