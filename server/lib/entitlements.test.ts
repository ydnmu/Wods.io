import assert from 'node:assert/strict'
import test from 'node:test'
import { effectivePlan, isBetaExpired } from './entitlements'

test('expires only time-bounded beta access', () => {
  const now = Date.parse('2026-06-20T12:00:00Z')
  assert.equal(isBetaExpired({ access_source: 'beta', beta_expires_at: '2026-06-20T11:59:59Z' }, now), true)
  assert.equal(effectivePlan({ plan: 'business', access_source: 'beta', beta_expires_at: '2026-06-20T11:59:59Z' }, now), 'free')
  assert.equal(effectivePlan({ plan: 'business', access_source: 'manual', beta_expires_at: '2020-01-01T00:00:00Z' }, now), 'business')
  assert.equal(effectivePlan({ plan: 'api', access_source: 'polar', beta_expires_at: '2020-01-01T00:00:00Z' }, now), 'api')
})
