import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Webhook } from 'standardwebhooks'
import {
  buildPolarCheckoutPayload,
  createPolarPortalSession,
  getPolarPlanLimit,
  normalizePolarBillingCycle,
  normalizePolarQuantity,
  parsePolarQuantity,
  verifyPolarPayload,
} from './polar'

test('builds a Polar checkout payload for Developer access', () => {
  const previousClientUrl = process.env.CLIENT_URL
  process.env.CLIENT_URL = 'https://wods.io'
  const payload = buildPolarCheckoutPayload({
    plan: 'api',
    billingCycle: 'annual',
    productId: 'prod_developer',
    quantity: 1,
    userId: 'user_123',
    email: 'buyer@example.com',
    name: 'Buyer',
    customerIpAddress: '127.0.0.1',
  })

  assert.deepEqual(payload.products, ['prod_developer'])
  assert.equal(payload.external_customer_id, 'user_123')
  assert.equal(payload.customer_email, 'buyer@example.com')
  assert.equal(payload.success_url, 'https://wods.io/checkout/complete?status=success&plan=developer&billing=annual&checkout_id={CHECKOUT_ID}')
  assert.equal(payload.return_url, 'https://wods.io/checkout/developer?billing=annual')
  assert.equal(payload.metadata.plan, 'api')
  assert.equal(payload.metadata.billing_cycle, 'annual')
  assert.equal(payload.metadata.quantity, '1')
  assert.equal(payload.metadata.limit, '10000')
  assert.equal(payload.metadata.caption_hours, '1000')
  assert.equal(payload.metadata.ai_fallback_hours, '50')
  assert.equal(payload.metadata.metering, 'source_hours')

  if (previousClientUrl === undefined) delete process.env.CLIENT_URL
  else process.env.CLIENT_URL = previousClientUrl
})

test('keeps Polar quantity conservative until separate products exist', () => {
  assert.equal(parsePolarQuantity('api', 1), 1)
  assert.equal(parsePolarQuantity('api', 2), null)
  assert.equal(normalizePolarQuantity('api', 99), 1)
  assert.equal(getPolarPlanLimit('api', 1), 10_000)
})

test('accepts only supported Polar billing cycles', () => {
  assert.equal(normalizePolarBillingCycle(undefined), 'monthly')
  assert.equal(normalizePolarBillingCycle('monthly'), 'monthly')
  assert.equal(normalizePolarBillingCycle('annual'), 'annual')
  assert.equal(normalizePolarBillingCycle('yearly'), null)
})

test('verifies Polar Standard Webhooks signatures', () => {
  const previousSecret = process.env.POLAR_WEBHOOK_SECRET
  const secret = Buffer.from('easytran-polar-test-secret').toString('base64')
  process.env.POLAR_WEBHOOK_SECRET = `whsec_${secret}`

  const body = Buffer.from('{"type":"subscription.active","data":{"id":"sub_123"}}')
  const timestamp = new Date()
  const id = 'evt_123'
  const signature = new Webhook(process.env.POLAR_WEBHOOK_SECRET).sign(id, timestamp, body)
  const payload = verifyPolarPayload(body, {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': signature,
  })

  assert.equal(payload.type, 'subscription.active')

  if (previousSecret === undefined) delete process.env.POLAR_WEBHOOK_SECRET
  else process.env.POLAR_WEBHOOK_SECRET = previousSecret
})

// The dashboard hands over a plain string, and Polar signs with its raw bytes.
// standardwebhooks base64-decodes whatever it is given, so pasting the dashboard
// value verbatim used to fail every delivery.
test('verifies signatures from a plain dashboard webhook secret', () => {
  const previousSecret = process.env.POLAR_WEBHOOK_SECRET
  const dashboardSecret = 'polar_whs_plain_value_from_dashboard'
  process.env.POLAR_WEBHOOK_SECRET = dashboardSecret

  const body = Buffer.from('{"type":"subscription.active","data":{"id":"sub_456"}}')
  const timestamp = new Date()
  const id = 'evt_456'
  // Sign the way Polar does: the plain secret's bytes are the HMAC key.
  const signer = new Webhook(Buffer.from(dashboardSecret, 'utf8').toString('base64'))
  const signature = signer.sign(id, timestamp, body)

  const payload = verifyPolarPayload(body, {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': signature,
  })

  assert.equal(payload.type, 'subscription.active')

  if (previousSecret === undefined) delete process.env.POLAR_WEBHOOK_SECRET
  else process.env.POLAR_WEBHOOK_SECRET = previousSecret
})

// The other reading of a whsec_ secret: the whole dashboard string is the HMAC key
// rather than a base64 payload behind a prefix.
test('verifies a whsec_ secret signed with the full string as key', () => {
  const previousSecret = process.env.POLAR_WEBHOOK_SECRET
  const dashboardSecret = 'whsec_6IjoiMTIzNDU2Nzg5MCIsIm5hbWUiOiJKb2huIn0'
  process.env.POLAR_WEBHOOK_SECRET = dashboardSecret

  const body = Buffer.from('{"type":"subscription.updated","data":{"id":"sub_321"}}')
  const timestamp = new Date()
  const id = 'evt_321'
  const signature = new Webhook(Buffer.from(dashboardSecret, 'utf8').toString('base64'))
    .sign(id, timestamp, body)

  const payload = verifyPolarPayload(body, {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': signature,
  })

  assert.equal(payload.type, 'subscription.updated')

  if (previousSecret === undefined) delete process.env.POLAR_WEBHOOK_SECRET
  else process.env.POLAR_WEBHOOK_SECRET = previousSecret
})

test('rejects a signature made with the wrong secret', () => {
  const previousSecret = process.env.POLAR_WEBHOOK_SECRET
  process.env.POLAR_WEBHOOK_SECRET = 'the-configured-secret'

  const body = Buffer.from('{"type":"subscription.active","data":{"id":"sub_789"}}')
  const timestamp = new Date()
  const id = 'evt_789'
  const signature = new Webhook(Buffer.from('a-different-secret', 'utf8').toString('base64'))
    .sign(id, timestamp, body)

  assert.throws(() => verifyPolarPayload(body, {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': signature,
  }))

  if (previousSecret === undefined) delete process.env.POLAR_WEBHOOK_SECRET
  else process.env.POLAR_WEBHOOK_SECRET = previousSecret
})

test('creates a Polar customer portal session', async () => {
  const previousToken = process.env.POLAR_ACCESS_TOKEN
  const previousEnvironment = process.env.POLAR_ENVIRONMENT
  process.env.POLAR_ACCESS_TOKEN = 'polar_token'
  process.env.POLAR_ENVIRONMENT = 'production'
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ customer_portal_url: 'https://polar.sh/easytran/portal/session' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const session = await createPolarPortalSession('cus_123')
    assert.equal(session.url, 'https://polar.sh/easytran/portal/session')
    assert.equal(calls[0].url, 'https://api.polar.sh/v1/customer-sessions/')
    assert.equal(calls[0].init?.method, 'POST')
  } finally {
    globalThis.fetch = originalFetch
    if (previousToken === undefined) delete process.env.POLAR_ACCESS_TOKEN
    else process.env.POLAR_ACCESS_TOKEN = previousToken
    if (previousEnvironment === undefined) delete process.env.POLAR_ENVIRONMENT
    else process.env.POLAR_ENVIRONMENT = previousEnvironment
  }
})
