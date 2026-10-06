import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import express from 'express'

// The actual router and Supabase client run against an isolated transport.
// No user data or credentials are sent to a real database.
const env = { NODE_ENV: 'production', SUPABASE_URL: 'https://waitlist-test.supabase.co', SUPABASE_SERVICE_KEY: 'waitlist-test-key' }
const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
Object.assign(process.env, env)
const originalFetch = globalThis.fetch
const calls: Array<{ url: string; body: Record<string, unknown>; preference: string }> = []
let fail = false
globalThis.fetch = async (input, init) => {
  const url = String(input)
  assert.ok(url.startsWith(env.SUPABASE_URL + '/rest/v1/waitlist?'))
  calls.push({ url, body: JSON.parse(String(init?.body)), preference: new Headers(init?.headers).get('Prefer') || '' })
  return fail ? Response.json({ message: 'Isolated database failure', code: 'TEST_FAILURE' }, { status: 500 }) : new Response(null, { status: 201 })
}
const { waitlistRouter } = await import('./waitlist')
const app = express()
app.use(express.json())
app.use('/api/waitlist', waitlistRouter)
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Test server unavailable')
const port = address.port
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})
const post = (body: Record<string, unknown>) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
  const request = httpRequest({ hostname: '127.0.0.1', port, path: '/api/waitlist', method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', chunk => { text += chunk })
    response.on('end', () => resolve({ status: response.statusCode || 0, body: JSON.parse(text) }))
  })
  request.on('error', reject)
  request.end(JSON.stringify(body))
})
test('pricing waitlist persists truthfully and preserves existing access requests', async t => {
  await t.test('normalizes email and ignores existing rows instead of resetting approved access', async () => {
    const response = await post({ email: ' Reader@Example.test ', purpose: 'pricing_updates', consent: true })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { success: true })
    assert.equal(calls.at(-1)?.body.email, 'reader@example.test')
    assert.equal(calls.at(-1)?.body.plan, 'business')
    assert.equal(calls.at(-1)?.body.status, 'pending')
    assert.ok(calls.at(-1)?.preference.includes('resolution=ignore-duplicates'))
    assert.ok(calls.at(-1)?.url.includes('on_conflict=email'))
  })
  await t.test('requires explicit consent and valid email without touching storage', async () => {
    const before = calls.length
    for (const body of [
      { email: 'reader@example.test', purpose: 'pricing_updates' },
      { email: 'reader@example.test', purpose: 'pricing_updates', consent: false },
      { email: 'invalid', purpose: 'pricing_updates', consent: true },
      { email: 'a'.repeat(255) + '@example.test', purpose: 'pricing_updates', consent: true },
    ]) assert.equal((await post(body)).status, 400)
    assert.equal(calls.length, before)
  })
  await t.test('storage failure cannot return success', async () => {
    fail = true
    const response = await post({ email: 'failure@example.test', purpose: 'pricing_updates', consent: true })
    assert.equal(response.status, 500)
    assert.equal(response.body.error, 'db_error')
    assert.equal(response.body.success, undefined)
    fail = false
  })
  await t.test('legacy workspace access requests retain merge behavior and plan validation', async () => {
    assert.equal((await post({ email: 'workspace@example.test', plan: 'api', name: 'Workspace user' })).status, 200)
    assert.equal(calls.at(-1)?.body.plan, 'api')
    assert.equal(calls.at(-1)?.body.name, 'Workspace user')
    assert.ok(calls.at(-1)?.preference.includes('resolution=merge-duplicates'))
    const before = calls.length
    assert.equal((await post({ email: 'workspace@example.test', plan: 'free' })).status, 400)
    assert.equal((await post({ email: 'workspace@example.test', plan: 'business', quantity: 2 })).status, 400)
    assert.equal(calls.length, before)
  })
})
