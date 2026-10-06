import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { handleTranscriptRequest } from './transcripts'

test('public transcript endpoint returns a service error when Bilibili blocks access', async (t) => {
  const nativeFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 412 }))
  const app = express()
  app.use(express.json())
  app.post('/api/transcript', handleTranscriptRequest)
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/transcript`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.bilibili.com/video/BV12N4y1M7rh', allowAiFallback: false }),
  })
  const payload = await response.json()
  assert.equal(response.status, 503)
  assert.equal(payload.error, 'bilibili_access_restricted')
  assert.ok(payload.message.includes('refusing caption access'))
  assert.notEqual(payload.message, 'no_captions')
})
