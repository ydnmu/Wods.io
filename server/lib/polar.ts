import './env'
import { Webhook, WebhookVerificationError } from 'standardwebhooks'
import { getPlanPolicy, normalizePlan, type AppPlan } from './plans'

export type PolarPlan = Extract<AppPlan, 'api' | 'business'>
export type PolarBillingCycle = 'monthly' | 'annual'

const POLAR_PLANS: Record<PolarPlan, {
  productIds: Record<PolarBillingCycle, string>
  baseLimit: number
  maxQuantity: number
}> = {
  api: {
    productIds: {
      monthly: process.env.POLAR_DEVELOPER_PRODUCT_ID || '',
      annual: process.env.POLAR_DEVELOPER_ANNUAL_PRODUCT_ID || '',
    },
    baseLimit: 10_000,
    maxQuantity: 1,
  },
  business: {
    productIds: {
      monthly: process.env.POLAR_BUSINESS_PRODUCT_ID || '',
      annual: process.env.POLAR_BUSINESS_ANNUAL_PRODUCT_ID || '',
    },
    baseLimit: 100_000,
    maxQuantity: 1,
  },
}

export const isPolarPlan = (plan: string): plan is PolarPlan =>
  normalizePlan(plan) === 'api' || normalizePlan(plan) === 'business'

export const normalizePolarBillingCycle = (value: unknown): PolarBillingCycle | null => {
  if (value === undefined || value === null || value === '') return 'monthly'
  return value === 'monthly' || value === 'annual' ? value : null
}

export const hasPolarPlanConfig = (plan: PolarPlan, billingCycle: PolarBillingCycle = 'monthly') =>
  Boolean(process.env.POLAR_ACCESS_TOKEN && POLAR_PLANS[plan].productIds[billingCycle])

export const hasPolarWebhookConfig = () => Boolean(process.env.POLAR_WEBHOOK_SECRET)

const getClientUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '')

export function getPolarApiUrl() {
  return process.env.POLAR_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-api.polar.sh/v1'
    : 'https://api.polar.sh/v1'
}

export function normalizePolarQuantity(plan: PolarPlan, quantity?: unknown) {
  const selected = POLAR_PLANS[plan]
  const value = Number(quantity)
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(Math.floor(value), 1), selected.maxQuantity)
}

export function parsePolarQuantity(plan: PolarPlan, quantity?: unknown) {
  if (quantity === undefined || quantity === null || quantity === '') return 1
  const value = Number(quantity)
  if (!Number.isInteger(value) || value < 1 || value > POLAR_PLANS[plan].maxQuantity) return null
  return value
}

export function getPolarPlanLimit(plan: PolarPlan, quantity?: unknown) {
  const selected = POLAR_PLANS[plan]
  return selected.baseLimit * normalizePolarQuantity(plan, quantity)
}

export function getPolarPlanFromProduct(productId?: string | null): PolarPlan | null {
  const entry = Object.entries(POLAR_PLANS).find(([, config]) =>
    Object.values(config.productIds).some((configuredId) => configuredId && configuredId === productId),
  )
  return (entry?.[0] as PolarPlan | undefined) ?? null
}

export function buildPolarCheckoutPayload(input: {
  plan: PolarPlan
  billingCycle?: PolarBillingCycle
  productId: string
  quantity: number
  userId: string
  email: string
  name?: string
  customerIpAddress?: string
}) {
  const planSlug = input.plan === 'api' ? 'developer' : input.plan
  const billingCycle = input.billingCycle ?? 'monthly'
  const limit = getPolarPlanLimit(input.plan, input.quantity)
  const policy = getPlanPolicy(input.plan)
  return {
    products: [input.productId],
    external_customer_id: input.userId,
    customer_email: input.email,
    customer_name: input.name || undefined,
    success_url: `${getClientUrl()}/checkout/complete?status=success&plan=${planSlug}&billing=${billingCycle}&checkout_id={CHECKOUT_ID}`,
    return_url: `${getClientUrl()}/checkout/${planSlug}?billing=${billingCycle}`,
    metadata: {
      user_id: input.userId,
      plan: input.plan,
      billing_cycle: billingCycle,
      quantity: String(input.quantity),
      limit: String(limit),
      caption_hours: String((policy.captionSecondsLimit ?? 0) / 3600),
      ai_fallback_hours: String((policy.aiFallbackSecondsLimit ?? 0) / 3600),
      metering: 'source_hours',
      provider: 'polar',
    },
    customer_metadata: {
      easytran_user_id: input.userId,
    },
  }
}

function formatPolarError(payload: Record<string, unknown>) {
  const detail = payload?.detail
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return String(entry)
        const record = entry as Record<string, unknown>
        const loc = Array.isArray(record.loc) ? record.loc.join('.') : ''
        const message = typeof record.msg === 'string'
          ? record.msg
          : typeof record.message === 'string'
            ? record.message
            : typeof record.type === 'string'
              ? record.type
              : JSON.stringify(record)
        return loc ? `${loc}: ${message}` : message
      })
      .join('; ')
  }
  if (typeof detail === 'string') return detail
  if (typeof payload?.message === 'string') return payload.message
  if (typeof payload?.error_description === 'string') return payload.error_description
  if (typeof payload?.error === 'string') return payload.error
  return 'Polar API request failed.'
}

async function polarFetch(path: string, init: RequestInit) {
  if (!process.env.POLAR_ACCESS_TOKEN) {
    throw new Error('Polar access token is not configured.')
  }

  const response = await fetch(`${getPolarApiUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(formatPolarError(payload))
  }
  return payload
}

export async function createPolarCheckout(input: {
  plan: PolarPlan
  billingCycle?: PolarBillingCycle
  quantity?: number
  userId: string
  email: string
  name?: string
  customerIpAddress?: string
}) {
  const billingCycle = input.billingCycle ?? 'monthly'
  if (!hasPolarPlanConfig(input.plan, billingCycle)) {
    throw new Error('Polar env vars are not configured.')
  }

  const quantity = normalizePolarQuantity(input.plan, input.quantity)
  const selectedPlan = POLAR_PLANS[input.plan]
  const payload = await polarFetch('/checkouts/', {
    method: 'POST',
    body: JSON.stringify(buildPolarCheckoutPayload({
      plan: input.plan,
      billingCycle,
      productId: selectedPlan.productIds[billingCycle],
      quantity,
      userId: input.userId,
      email: input.email,
      name: input.name,
      customerIpAddress: input.customerIpAddress,
    })),
  })

  if (typeof payload?.url !== 'string' || !payload.url) {
    throw new Error('Polar checkout did not return a payment link.')
  }

  return {
    url: payload.url as string,
    id: payload.id as string,
    plan: input.plan,
    billingCycle,
    quantity,
    limit: getPolarPlanLimit(input.plan, quantity),
  }
}

export async function createPolarPortalSession(customerId: string) {
  const payload = await polarFetch('/customer-sessions/', {
    method: 'POST',
    body: JSON.stringify({ customer_id: customerId }),
  })
  const url = payload?.customer_portal_url || payload?.customerPortalUrl || payload?.url
  if (typeof url !== 'string' || !url) {
    throw new Error('Polar customer portal could not be created.')
  }
  return { url }
}

// standardwebhooks base64-decodes the secret to recover the HMAC key, but the Polar
// dashboard shows a plain string. Pasting that value verbatim yields a garbage key and
// every delivery fails signature verification, so accept both encodings instead of
// making the operator guess which one this library wants.
// Two readings are in the wild: the Standard Webhooks one, where a whsec_ prefix is
// stripped and the rest base64-decodes into the key, and a Polar-specific one where the
// dashboard string's own bytes are the key. Passing the value through base64 makes the
// library recover those raw bytes, so offering both covers either reading.
function polarWebhookSecretCandidates(secret: string) {
  return [secret, Buffer.from(secret, 'utf8').toString('base64')]
}

export function verifyPolarPayload(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
  if (!process.env.POLAR_WEBHOOK_SECRET) {
    throw new Error('Polar webhook secret is not configured.')
  }

  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key.toLowerCase(), value as string]),
  )

  let lastError: unknown
  for (const candidate of polarWebhookSecretCandidates(process.env.POLAR_WEBHOOK_SECRET)) {
    try {
      return new Webhook(candidate).verify(rawBody, normalizedHeaders) as Record<string, unknown>
    } catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof WebhookVerificationError) throw lastError
  throw new WebhookVerificationError(lastError instanceof Error ? lastError.message : 'Polar webhook verification failed.')
}
