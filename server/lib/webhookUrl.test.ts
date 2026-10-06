import assert from 'node:assert/strict'
import test from 'node:test'
import { isPrivateAddress, validateWebhookUrl } from './webhookUrl'

test('blocks private webhook targets', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true)
  assert.equal(isPrivateAddress('10.1.2.3'), true)
  assert.equal(isPrivateAddress('172.20.0.1'), true)
  assert.equal(isPrivateAddress('192.168.1.1'), true)
  assert.equal(isPrivateAddress('::1'), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
  assert.equal(await validateWebhookUrl('https://127.0.0.1/hook'), false)
  assert.equal(await validateWebhookUrl('http://8.8.8.8/hook'), false)
  assert.equal(await validateWebhookUrl('https://8.8.8.8:8443/hook'), false)
  assert.equal(await validateWebhookUrl('https://8.8.8.8/hook'), true)
})
