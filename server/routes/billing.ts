import { Router } from 'express'
import { sendPlanUpdatedEmail } from '../lib/email'
import {
  createPolarCheckout,
  createPolarPortalSession,
  getPolarPlanFromProduct,
  getPolarPlanLimit,
  hasPolarPlanConfig,
  hasPolarWebhookConfig,
  isPolarPlan,
  normalizePolarBillingCycle,
  parsePolarQuantity,
  verifyPolarPayload,
} from '../lib/polar'
import { normalizePlan } from '../lib/plans'
import { getReleasePolicy } from '../lib/releasePolicy'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { ensureWorkspaceAccess } from '../lib/workspaceProvisioning'

export const billingRouter = Router()

type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}

const getBillingMode = () => hasPolarPlanConfig('api', 'monthly') || hasPolarPlanConfig('business', 'monthly')
  ? 'polar'
  : 'unconfigured'

const getOrCreateBillingUser = async (email: string) => {
  const fields = 'id, email, plan, polar_subscription_id, subscription_status'
  const { data: existing } = await supabase
    .from('users')
    .select(fields)
    .eq('email', email)
    .maybeSingle()

  if (existing) return existing

  const { data: created, error } = await supabase
    .from('users')
    .insert({ email, plan: 'free', transcripts_limit: 100 })
    .select(fields)
    .single()

  if (!error && created) return created

  const { data: racedUser } = await supabase
    .from('users')
    .select(fields)
    .eq('email', email)
    .single()
  return racedUser
}

const notifyPlanUpdated = async (userId: string, plan: string, limit: number) => {
  const { data: user } = await supabase.from('users').select('email').eq('id', userId).single()
  if (!user?.email) return
  await sendPlanUpdatedEmail({ to: user.email, plan, limit }).catch((error) => {
    console.error('Plan update email failed:', error)
  })
}

billingRouter.get('/status', (_request, response) => {
  const features = getReleasePolicy()
  const mode = getBillingMode()
  const providerConfigured = mode === 'polar'
  response.setHeader('Cache-Control', 'no-store')
  response.json({
    mode,
    providerConfigured,
    available: features.paidWorkspacesEnabled && providerConfigured,
    features,
    plans: {
      api: {
        monthly: hasPolarPlanConfig('api', 'monthly'),
        annual: hasPolarPlanConfig('api', 'annual'),
      },
      business: {
        monthly: hasPolarPlanConfig('business', 'monthly'),
        annual: hasPolarPlanConfig('business', 'annual'),
      },
    },
  })
})

billingRouter.post('/checkout', async (request, response) => {
  if (!getReleasePolicy().paidWorkspacesEnabled) {
    response.status(503).json({ error: 'paid_workspaces_unavailable', message: 'Paid workspaces are temporarily unavailable.' })
    return
  }
  requireSupabaseConfig()

  const plan = normalizePlan(String(request.body?.plan || ''))
  const email = String(request.body?.email || '').trim().toLowerCase()
  const name = String(request.body?.name || '').trim()
  const billingCycle = normalizePolarBillingCycle(request.body?.billing_cycle)

  if (!isPolarPlan(plan)) {
    response.status(400).json({ error: 'invalid_plan' })
    return
  }
  if (!billingCycle) {
    response.status(400).json({ error: 'invalid_billing_cycle' })
    return
  }
  if (!hasPolarPlanConfig(plan, billingCycle)) {
    response.status(503).json({ error: 'billing_not_configured', message: 'Secure checkout is temporarily unavailable.' })
    return
  }

  const quantity = parsePolarQuantity(plan, request.body?.quantity)
  if (!quantity) {
    response.status(400).json({
      error: 'invalid_quantity',
      message: 'Polar checkout accepts one plan package per subscription.',
      min: 1,
      max: 1,
    })
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ error: 'valid_email_required' })
    return
  }

  try {
    const limit = getPolarPlanLimit(plan, quantity)
    const user = await getOrCreateBillingUser(email)
    if (!user) {
      response.status(500).json({ error: 'db_error' })
      return
    }

    const hasActiveBilling = user.polar_subscription_id
      && !['cancelled', 'canceled', 'expired', 'revoked'].includes(String(user.subscription_status || '').toLowerCase())
    if (hasActiveBilling) {
      response.status(409).json({
        error: 'active_subscription_exists',
        message: 'Use subscription management to change an active plan.',
      })
      return
    }

    const checkout = await createPolarCheckout({
      plan,
      billingCycle,
      quantity,
      userId: user.id,
      email: user.email,
      name,
      customerIpAddress: request.ip,
    })

    await supabase
      .from('users')
      .update({ pending_checkout_id: checkout.id || null, pending_plan: plan, pending_quantity: quantity })
      .eq('id', user.id)

    response.json({
      mode: 'polar',
      url: checkout.url,
      checkout_id: checkout.id,
      plan,
      billing_cycle: billingCycle,
      quantity,
      limit,
    })
  } catch (error) {
    response.status(503).json({
      error: 'polar_not_configured',
      message: error instanceof Error ? error.message : 'Checkout could not be created.',
    })
  }
})

billingRouter.post('/portal', async (request, response) => {
  if (!getReleasePolicy().paidWorkspacesEnabled) {
    response.status(503).json({ error: 'paid_workspaces_unavailable', message: 'Paid workspaces are temporarily unavailable.' })
    return
  }
  requireSupabaseConfig()
  if (!request.userId) {
    response.status(401).json({ error: 'not_authenticated' })
    return
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('polar_customer_id, polar_subscription_id')
    .eq('id', request.userId)
    .single()

  if (error || !user) {
    response.status(404).json({ error: 'user_not_found' })
    return
  }
  if (!user.polar_customer_id || !user.polar_subscription_id) {
    response.status(409).json({ error: 'paid_subscription_required' })
    return
  }

  try {
    response.json(await createPolarPortalSession(user.polar_customer_id))
  } catch (portalError) {
    response.status(503).json({
      error: 'billing_portal_unavailable',
      message: portalError instanceof Error ? portalError.message : 'Billing portal is unavailable.',
    })
  }
})

billingRouter.post('/polar/webhook', async (request, response) => {
  requireSupabaseConfig()

  if (!hasPolarWebhookConfig()) {
    response.status(503).json({ error: 'polar_webhook_not_configured' })
    return
  }
  if (!Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: 'invalid_webhook_body' })
    return
  }

  let payload: JsonRecord
  try {
    payload = asRecord(verifyPolarPayload(request.body, request.headers))
  } catch {
    response.status(403).json({ error: 'invalid_signature' })
    return
  }

  const eventId = String(request.headers['webhook-id'] || `${payload.type || 'polar'}-${payload.timestamp || Date.now()}`)
  const eventName = String(payload.type || '')
  const data = asRecord(payload.data)
  const metadata = asRecord(data.metadata)
  const customer = asRecord(data.customer)
  const product = asRecord(data.product)
  const userId = String(metadata.user_id || customer.external_id || data.external_customer_id || '')
  const metadataPlan = normalizePlan(String(metadata.plan || ''))
  const productId = String(data.product_id || product.id || '')
  const productPlan = getPolarPlanFromProduct(productId)
  const plan = productPlan ?? (isPolarPlan(metadataPlan) ? metadataPlan : null)
  const quantity = plan ? parsePolarQuantity(plan, metadata.quantity) : null
  const polarCustomerId = String(customer.id || data.customer_id || '')
  const polarSubscriptionId = String(data.id || data.subscription_id || '')
  const status = String(data.status || '')

  if (!userId) {
    response.json({ received: true, skipped: 'missing_user_id' })
    return
  }

  const { error: eventError } = await supabase.from('billing_webhook_events').insert({
    id: eventId,
    event_type: eventName,
    payload,
  })
  if (eventError?.code === '23505') {
    response.json({ received: true, duplicate: true })
    return
  }
  if (eventError) {
    response.status(500).json({ error: 'webhook_store_failed' })
    return
  }

  const cancelled = ['subscription.canceled', 'subscription.revoked'].includes(eventName)
    || ['canceled', 'cancelled', 'revoked'].includes(status.toLowerCase())

  if (cancelled) {
    if (!polarSubscriptionId) {
      response.json({ received: true, skipped: 'missing_subscription_id' })
      return
    }
    const { error: cancellationError } = await supabase
      .from('users')
      .update({
        plan: 'free',
        transcripts_limit: 100,
        polar_subscription_id: null,
        polar_quantity: 1,
        subscription_status: status || 'canceled',
        access_source: 'billing',
        beta_expires_at: null,
      })
      .eq('id', userId)
      .eq('polar_subscription_id', polarSubscriptionId)
    if (cancellationError) {
      await supabase.from('billing_webhook_events').delete().eq('id', eventId)
      response.status(500).json({ error: 'subscription_update_failed' })
      return
    }
    response.json({ received: true })
    return
  }

  if (plan && quantity && ['subscription.active', 'subscription.updated'].includes(eventName)) {
    if (!polarSubscriptionId) {
      await supabase.from('billing_webhook_events').delete().eq('id', eventId)
      response.status(422).json({ error: 'missing_subscription_id' })
      return
    }

    const limit = getPolarPlanLimit(plan, quantity)
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        plan,
        transcripts_limit: limit,
        polar_customer_id: polarCustomerId || null,
        polar_subscription_id: polarSubscriptionId,
        polar_product_id: productId || null,
        polar_quantity: quantity,
        subscription_status: status || 'active',
        access_source: 'polar',
        beta_expires_at: null,
        pending_checkout_id: null,
        pending_plan: null,
        pending_quantity: null,
      })
      .eq('id', userId)
      .or(`polar_subscription_id.is.null,polar_subscription_id.eq.${polarSubscriptionId}`)
      .select('id')
      .maybeSingle()

    if (updateError) {
      await supabase.from('billing_webhook_events').delete().eq('id', eventId)
      response.status(500).json({ error: 'subscription_update_failed' })
      return
    }
    if (!updatedUser) {
      response.json({ received: true, skipped: 'stale_subscription' })
      return
    }

    if (eventName === 'subscription.active') {
      try {
        await ensureWorkspaceAccess(userId, plan, limit)
      } catch (error) {
        await supabase.from('billing_webhook_events').delete().eq('id', eventId)
        console.error('API key provisioning failed:', error)
        response.status(500).json({ error: 'api_key_provision_failed' })
        return
      }
    } else {
      await notifyPlanUpdated(userId, plan, limit)
    }
  }

  response.json({ received: true })
})
