import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import test, { after } from 'node:test'
import express from 'express'
import { Webhook } from 'standardwebhooks'

// Keep the router's real dependencies, but isolate every external request and
// prevent local dotenv files from supplying production credentials to this test.
const testEnv = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://billing-policy-test.supabase.co',
  SUPABASE_SERVICE_KEY: 'billing-policy-test-key',
  POLAR_ACCESS_TOKEN: 'billing-policy-test-token',
  POLAR_DEVELOPER_PRODUCT_ID: 'policy_developer_monthly',
  POLAR_BUSINESS_PRODUCT_ID: 'policy_business_monthly',
  POLAR_DEVELOPER_ANNUAL_PRODUCT_ID: '',
  POLAR_BUSINESS_ANNUAL_PRODUCT_ID: '',
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from('billing-policy-test-secret').toString('base64')}`,
  RESEND_API_KEY: '',
  PAID_WORKSPACES_ENABLED: '',
}
const previousEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]))
Object.assign(process.env, testEnv)

type ExternalCall = { url: URL; method: string; body: Record<string, unknown> }
const calls: ExternalCall[] = []
let externalResponse: (call: ExternalCall) => Response = () => {
  throw new Error('Unexpected external request')
}
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const call = {
    url: new URL(String(input)),
    method: init?.method || 'GET',
    body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
  }
  calls.push(call)
  return externalResponse(call)
}

const { billingRouter } = await import('./billing')
const app = express()
app.use('/api/billing/polar/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())
app.use((request, _response, next) => {
  // Simulate the session middleware without contacting an auth provider.
  if (request.headers['x-test-session'] === 'authenticated') request.userId = 'policy_user'
  next()
})
app.use('/api/billing', billingRouter)
const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Test server address unavailable')
const port = address.port

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const api = (path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: Record<string, unknown>; cacheControl?: string }>((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port, path: `/api/billing${path}`,
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        body: JSON.parse(text) as Record<string, unknown>,
        cacheControl: response.headers['cache-control'],
      }))
    })
    request.on('error', reject)
    request.end(body ? JSON.stringify(body) : undefined)
  })

const checkoutInput = { plan: 'api', email: 'buyer@example.com', name: 'Buyer', billing_cycle: 'monthly', quantity: 1 }
const reset = (enabled?: string) => {
  Object.assign(process.env, testEnv)
  if (enabled === undefined) delete process.env.PAID_WORKSPACES_ENABLED
  else process.env.PAID_WORKSPACES_ENABLED = enabled
  calls.length = 0
  externalResponse = () => { throw new Error('Unexpected external request') }
}
const webhook = (eventName: string, id = 'evt_policy', status = 'active') => {
  const payload = {
    type: eventName,
    data: {
      id: 'policy_subscription', status, product_id: 'policy_developer_monthly',
      customer: { id: 'policy_customer', external_id: 'policy_user' },
      metadata: { user_id: 'policy_user', plan: 'api', quantity: '1' },
    },
  }
  const timestamp = new Date()
  return api('/polar/webhook', payload, {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': new Webhook(testEnv.POLAR_WEBHOOK_SECRET).sign(id, timestamp, JSON.stringify(payload)),
  })
}

test('billing release policy gates payment APIs and preserves webhook lifecycle', async (t) => {
  await t.test('configured provider stays visible while customer availability defaults closed', async () => {
    reset()
    const response = await api('/status')
    assert.equal(response.status, 200)
    assert.equal(response.cacheControl, 'no-store')
    assert.equal(response.body.mode, 'polar')
    assert.equal(response.body.providerConfigured, true)
    assert.equal(response.body.available, false)
    assert.deepEqual(response.body.features, { paidWorkspacesEnabled: false })
    assert.deepEqual(response.body.plans, {
      api: { monthly: true, annual: false }, business: { monthly: true, annual: false },
    })
    assert.equal(calls.length, 0)
  })

  await t.test('checkout and portal reject absent, false, and non-literal release flags before any DB/provider work', async () => {
    for (const enabled of [undefined, 'false', 'TRUE', '1', ' true', 'true ']) {
      reset(enabled)
      // Policy denial must not depend on having a database configuration.
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_KEY
      for (const path of ['/checkout', '/portal']) {
        const response = await api(path, checkoutInput, { 'x-test-session': 'authenticated' })
        assert.equal(response.status, 503, `${path}, flag=${enabled}`)
        assert.equal(response.body.error, 'paid_workspaces_unavailable')
      }
      assert.equal(calls.length, 0)
    }
  })

  await t.test('availability requires release and provider configuration together', async () => {
    reset('true')
    assert.equal((await api('/status')).body.available, true)
    delete process.env.POLAR_ACCESS_TOKEN
    const response = await api('/status')
    assert.equal(response.body.mode, 'unconfigured')
    assert.equal(response.body.providerConfigured, false)
    assert.equal(response.body.available, false)
    assert.deepEqual(response.body.features, { paidWorkspacesEnabled: true })
    assert.equal((await api('/checkout', checkoutInput)).body.error, 'billing_not_configured')
    assert.equal(calls.length, 0)
  })

  await t.test('released checkout retains plan, cycle and email validation', async () => {
    reset('true')
    assert.equal((await api('/checkout', { ...checkoutInput, plan: 'free' })).body.error, 'invalid_plan')
    assert.equal((await api('/checkout', { ...checkoutInput, billing_cycle: 'yearly' })).body.error, 'invalid_billing_cycle')
    assert.equal((await api('/checkout', { ...checkoutInput, billing_cycle: 'annual' })).body.error, 'billing_not_configured')
    assert.equal((await api('/checkout', { ...checkoutInput, email: 'invalid' })).body.error, 'valid_email_required')
    assert.equal(calls.length, 0)
  })

  await t.test('released checkout creates a hosted checkout through mocked provider and DB', async () => {
    reset('true')
    externalResponse = ({ url, method }) => {
      if (url.pathname === '/rest/v1/users' && method === 'GET') {
        return Response.json([{ id: 'policy_user', email: 'buyer@example.com', plan: 'free', polar_subscription_id: null }])
      }
      if (url.pathname === '/v1/checkouts/' && method === 'POST') {
        return Response.json({ id: 'policy_checkout', url: 'https://polar.example.test/checkout' })
      }
      if (url.pathname === '/rest/v1/users' && method === 'PATCH') return Response.json([])
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    }
    const response = await api('/checkout', checkoutInput)
    assert.equal(response.status, 200)
    assert.equal(response.body.url, 'https://polar.example.test/checkout')
    assert.equal(response.body.checkout_id, 'policy_checkout')
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[1].body.products, ['policy_developer_monthly'])
    assert.equal(calls[2].body.pending_checkout_id, 'policy_checkout')
  })

  await t.test('released portal retains authentication and returns mocked customer session', async () => {
    reset('true')
    assert.equal((await api('/portal', {})).status, 401)
    assert.equal(calls.length, 0)
    externalResponse = ({ url, method }) => {
      if (url.pathname === '/rest/v1/users') return Response.json({ polar_customer_id: 'policy_customer', polar_subscription_id: 'policy_subscription' })
      if (url.pathname === '/v1/customer-sessions/' && method === 'POST') return Response.json({ customer_portal_url: 'https://polar.example.test/portal' })
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    }
    const response = await api('/portal', {}, { 'x-test-session': 'authenticated' })
    assert.equal(response.status, 200)
    assert.equal(response.body.url, 'https://polar.example.test/portal')
    assert.deepEqual(calls[1].body, { customer_id: 'policy_customer' })
  })

  await t.test('active subscription still updates and provisions existing workspace while release is disabled', async () => {
    reset('false')
    externalResponse = ({ url, method }) => {
      if (url.pathname === '/rest/v1/billing_webhook_events' && method === 'POST') return Response.json([])
      if (url.pathname === '/rest/v1/users' && method === 'PATCH') return Response.json([{ id: 'policy_user' }])
      if (url.pathname === '/rest/v1/users' && method === 'GET') return Response.json({ email: 'buyer@example.com' })
      if (url.pathname === '/rest/v1/dashboard_members' && method === 'GET') return Response.json([{ id: 'policy_member', password_hash: 'existing_hash', active: true }])
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    }
    const response = await webhook('subscription.active')
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { received: true })
    assert.equal(calls.length, 4)
    assert.equal(calls[1].body.plan, 'api')
    assert.equal(calls[1].body.polar_subscription_id, 'policy_subscription')
    assert.equal(calls[3].url.pathname, '/rest/v1/dashboard_members')
  })

  await t.test('subscription updates still apply while release is disabled', async () => {
    reset()
    externalResponse = ({ url, method }) => {
      if (url.pathname === '/rest/v1/billing_webhook_events' && method === 'POST') return Response.json([])
      if (url.pathname === '/rest/v1/users' && method === 'PATCH') return Response.json([{ id: 'policy_user' }])
      if (url.pathname === '/rest/v1/users' && method === 'GET') return Response.json({ email: null })
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    }
    assert.equal((await webhook('subscription.updated')).status, 200)
    assert.equal(calls[1].body.plan, 'api')
    assert.equal(calls[1].body.transcripts_limit, 10_000)
  })

  await t.test('canceled and revoked subscriptions still downgrade while release is disabled', async () => {
    for (const eventName of ['subscription.canceled', 'subscription.revoked']) {
      reset('false')
      externalResponse = ({ url, method }) => {
        if (url.pathname === '/rest/v1/billing_webhook_events' && method === 'POST') return Response.json([])
        if (url.pathname === '/rest/v1/users' && method === 'PATCH') return Response.json([])
        throw new Error(`Unexpected request: ${method} ${url.pathname}`)
      }
      const response = await webhook(eventName, 'evt_cancel', eventName.split('.')[1])
      assert.equal(response.status, 200)
      assert.equal(calls[1].body.plan, 'free')
      assert.equal(calls[1].body.polar_subscription_id, null)
      assert.equal(calls[1].url.searchParams.get('polar_subscription_id'), 'eq.policy_subscription')
    }
  })

  await t.test('webhook duplicate and signature protections survive the disabled policy', async () => {
    reset('false')
    const invalid = await api('/polar/webhook', { type: 'subscription.active' }, { 'webhook-signature': 'invalid' })
    assert.equal(invalid.status, 403)
    assert.equal(calls.length, 0)
    externalResponse = () => Response.json({ code: '23505', message: 'duplicate' }, { status: 409 })
    const response = await webhook('subscription.active')
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { received: true, duplicate: true })
    assert.equal(calls.length, 1)
  })
})
