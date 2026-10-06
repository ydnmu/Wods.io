import assert from 'node:assert/strict'
import test from 'node:test'
import { nextChannelRunAt, normalizeChannelAutomationSettings } from './channelAutomation'

test('normalizes channel automation settings safely', () => {
  assert.deepEqual(normalizeChannelAutomationSettings({
    schedule_frequency: 'hourly',
    schedule_time: '26:90',
    timezone: 'Not/AZone',
    backfill_limit: 5000,
    auto_summary: false,
  }), {
    schedule_frequency: 'hourly',
    schedule_time: '09:00',
    timezone: 'UTC',
    auto_summary: false,
    ai_fallback: true,
    backfill_limit: 1000,
    paused: false,
  })
})

test('calculates interval and timezone-aware daily runs', () => {
  const from = new Date('2026-07-29T08:30:00.000Z')
  assert.equal(nextChannelRunAt('every_15_minutes', '09:00', 'UTC', from), '2026-07-29T08:45:00.000Z')
  assert.equal(nextChannelRunAt('hourly', '09:00', 'UTC', from), '2026-07-29T09:30:00.000Z')
  assert.equal(nextChannelRunAt('daily', '12:00', 'Europe/Istanbul', from), '2026-07-29T09:00:00.000Z')
})

