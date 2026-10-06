import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { createWebhookSignature } from './webhooks'

test('signs webhook timestamp and body together', () => {
  const secret = 'secret'
  const timestamp = '1750000000000'
  const body = '{"event":"transcript.completed"}'
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  assert.equal(createWebhookSignature(secret, body, timestamp), expected)
  assert.notEqual(createWebhookSignature(secret, body, '1750000000001'), expected)
})
