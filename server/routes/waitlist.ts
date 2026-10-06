import { Router } from 'express'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { normalizePlan } from '../lib/plans'

export const waitlistRouter = Router()

waitlistRouter.post('/', async (request, response) => {
  requireSupabaseConfig()

  const email = String(request.body?.email || '').trim().toLowerCase()
  const pricingUpdates = request.body?.purpose === 'pricing_updates'
  const plan = pricingUpdates ? 'business' : normalizePlan(String(request.body?.plan || ''))
  const name = String(request.body?.name || '').trim().slice(0, 120)
  const company = String(request.body?.company || '').trim().slice(0, 120)

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['api', 'business', 'custom'].includes(plan)) {
    response.status(400).json({ error: 'email_and_plan_required' })
    return
  }

  if (pricingUpdates && request.body?.consent !== true) {
    response.status(400).json({ error: 'consent_required' })
    return
  }

  const requestedQuantity = Number(request.body?.quantity ?? 1)
  if (!Number.isInteger(requestedQuantity) || requestedQuantity !== 1) {
    response.status(400).json({ error: 'invalid_quantity' })
    return
  }

  const { error } = await supabase
    .from('waitlist')
    .upsert({
      email,
      plan,
      name,
      company,
      requested_quantity: requestedQuantity,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email', ignoreDuplicates: pricingUpdates })

  if (error) {
    response.status(500).json({ error: 'db_error' })
    return
  }

  response.json({ success: true })
})
