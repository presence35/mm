import test from 'node:test'
import assert from 'node:assert/strict'

import { CAPABILITIES, can, canOffline } from './permissions.js'

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
  assert.ok(!can('office', CAPABILITIES.MANAGE_EMPLOYEES))
})

test('admin holds every capability', () => {
  for (const c of Object.values(CAPABILITIES)) assert.ok(can('admin', c), c)
})

test('only card work is allowed offline; office and admin actions refuse', () => {
  assert.ok(canOffline('mechanic', CAPABILITIES.WORK_ON_CARD))
  assert.ok(!canOffline('office', CAPABILITIES.INVOICE))
  assert.ok(!canOffline('office', CAPABILITIES.CREATE_CUSTOMER))
  assert.ok(!canOffline('admin', CAPABILITIES.MANAGE_EMPLOYEES))
})

test('unknown role or capability is denied, never throws', () => {
  assert.ok(!can('cleaner', CAPABILITIES.WORK_ON_CARD))
  assert.ok(!can('mechanic', 'card.launch'))
  assert.ok(!canOffline('mechanic', 'card.launch'))
})
