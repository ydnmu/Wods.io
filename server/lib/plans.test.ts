import assert from 'node:assert/strict'
import test from 'node:test'
import { getPlanPolicy, isWithinLimit, normalizePlan, shouldStoreTranscript } from './plans'

test('normalizes legacy plan names', () => {
  assert.equal(normalizePlan('pro'), 'api')
  assert.equal(normalizePlan('unknown'), 'free')
})

test('exposes the advertised business limits', () => {
  const policy = getPlanPolicy('business')
  assert.equal(policy.maxWebhooks, 20)
  assert.equal(policy.maxChannels, 10)
  assert.equal(policy.maxBatchUrls, 1000)
  assert.equal(policy.transcriptsLimit, 100000)
  assert.equal(policy.captionSecondsLimit, 10_000 * 60 * 60)
  assert.equal(policy.aiFallbackSecondsLimit, 500 * 60 * 60)
})

test('keeps Developer caption and fallback hours separate', () => {
  const policy = getPlanPolicy('api')
  assert.equal(policy.captionSecondsLimit, 1_000 * 60 * 60)
  assert.equal(policy.aiFallbackSecondsLimit, 50 * 60 * 60)
})

test('treats negative limits as unlimited', () => {
  assert.equal(isWithinLimit(999999, -1), true)
  assert.equal(isWithinLimit(3, 3), false)
  assert.equal(isWithinLimit(2, 3), true)
})

test('stores full transcripts only for business archives', () => {
  assert.equal(shouldStoreTranscript('free'), false)
  assert.equal(shouldStoreTranscript('api'), false)
  assert.equal(shouldStoreTranscript('business'), true)
  assert.equal(shouldStoreTranscript('custom'), true)
})
