import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeLegacyApiKeyPolicy, encodeLegacyApiKeyPolicy, parseApiKeyCreationPolicy } from './apiKeys'

test('normalizes a bounded API key policy', () => {
  const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const policy = parseApiKeyCreationPolicy({
    name: ' Production ',
    requestLimit: '25000',
    expiresAt: expiry,
  })

  assert.equal(policy.name, 'Production')
  assert.equal(policy.requestLimit, 25_000)
  assert.equal(policy.expiresAt, expiry)
})

test('creates hour-metered keys without a request-count cap', () => {
  const expiry = new Date(Date.now() + 90 * 86_400_000).toISOString()
  const policy = parseApiKeyCreationPolicy({ name: 'Production', expiresAt: expiry })
  assert.equal(policy.requestLimit, null)
  assert.equal(policy.expiresAt, expiry)
})

test('rejects invalid request limits and expired keys', () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
  assert.throws(
    () => parseApiKeyCreationPolicy({ name: 'Test', requestLimit: 0, expiresAt: future }),
    /invalid_request_limit/,
  )
  assert.throws(
    () => parseApiKeyCreationPolicy({ name: 'Test', requestLimit: 100, expiresAt: '2020-01-01T00:00:00.000Z' }),
    /invalid_expiry/,
  )
})

test('round-trips compatibility policies for legacy API key schemas', () => {
  const policy = parseApiKeyCreationPolicy({
    name: 'Production',
    requestLimit: 5000,
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  })
  assert.deepEqual(decodeLegacyApiKeyPolicy(encodeLegacyApiKeyPolicy(policy)), policy)
  assert.equal(decodeLegacyApiKeyPolicy('Default'), null)
})
