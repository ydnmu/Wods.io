import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenRouterKeyPool, parseOpenRouterKeys } from './openRouterPool'

test('deduplicates configured OpenRouter keys', () => {
  assert.deepEqual(parseOpenRouterKeys('key-a,key-b\nkey-a'), ['key-a', 'key-b'])
})

test('leases only idle OpenRouter keys and releases them for reuse', () => {
  const pool = createOpenRouterKeyPool(['key-a', 'key-b'])
  const first = pool.acquire(100)
  const second = pool.acquire(100)

  assert.ok(first)
  assert.ok(second)
  assert.notEqual(first.key, second.key)
  assert.equal(pool.acquire(100), null)

  first.release()
  assert.equal(pool.acquire(Date.now())?.key, first.key)
})
