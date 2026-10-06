import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { once } from 'node:events'
import { openRouterKeyPool } from '../lib/openRouterPool'
import { parseSummaryContent, summaryRouter } from './summary'

test('normalizes fenced summary JSON and caps tags at five', () => {
  const result = parseSummaryContent('```json\n{"title":" Test ","summary":" Works. ","tags":["one","two","three","four","five","six","one"]}\n```')
  assert.deepEqual(result, {
    title: 'Test',
    summary: 'Works.',
    tags: ['one', 'two', 'three', 'four', 'five'],
  })
})

test('rejects incomplete provider output', () => {
  assert.throws(() => parseSummaryContent('{"title":"Only a title","tags":[]}'), /invalid response/)
})

test('unavailable summary returns an error without fabricated result fields', async () => {
  const originalKey = process.env.OPENAI_API_KEY
  const sizeDescriptor = Object.getOwnPropertyDescriptor(openRouterKeyPool, 'size')
  Object.defineProperty(openRouterKeyPool, 'size', { configurable: true, get: () => 0 })
  delete process.env.OPENAI_API_KEY
  const app = express()
  app.use(express.json())
  app.use('/summary', summaryRouter)
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/summary`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Audit fixture', text: 'A transcript already exists.' }),
    })
    assert.equal(response.status, 501)
    const payload = await response.json()
    assert.equal(payload.error, 'summary_unavailable')
    assert.equal(typeof payload.message, 'string')
    assert.equal('summary' in payload, false)
    assert.equal('tags' in payload, false)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    if (sizeDescriptor) Object.defineProperty(openRouterKeyPool, 'size', sizeDescriptor)
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
  }
})
