import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { resolveRateLimit, resolveTrustProxyHops } from './networkConfig'

test('trusts one proxy hop by default in production only', () => {
  assert.equal(resolveTrustProxyHops(undefined, 'production'), 1)
  assert.equal(resolveTrustProxyHops(undefined, 'development'), 0)
  assert.equal(resolveTrustProxyHops('2', 'production'), 2)
})

test('rejects unsafe or invalid proxy hop values', () => {
  assert.equal(resolveTrustProxyHops('-1', 'production'), 1)
  assert.equal(resolveTrustProxyHops('all', 'production'), 1)
  assert.equal(resolveTrustProxyHops('99', 'development'), 0)
})

test('uses valid configurable rate limits and safe fallbacks', () => {
  assert.equal(resolveRateLimit('25', 10), 25)
  assert.equal(resolveRateLimit('0', 10), 10)
  assert.equal(resolveRateLimit('invalid', 40), 40)
})

test('rate limits forwarded clients independently behind one trusted proxy', async () => {
  const app = express()
  app.set('trust proxy', 1)
  app.use(rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: false, legacyHeaders: false }))
  app.get('/', (_request, response) => response.json({ ok: true }))

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const requestFrom = (ip: string) => fetch(`http://127.0.0.1:${port}`, {
    headers: { 'x-forwarded-for': ip },
  })

  try {
    assert.equal((await requestFrom('203.0.113.10')).status, 200)
    assert.equal((await requestFrom('203.0.113.10')).status, 429)
    assert.equal((await requestFrom('203.0.113.11')).status, 200)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
})
