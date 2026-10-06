import crypto from 'node:crypto'
import { Router } from 'express'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { createWebhookSubscription, normalizeWebhookEvents } from '../lib/webhookSubscriptions'
import { validateWebhookUrl } from '../lib/webhookUrl'
import { requireApiKey, requirePlan } from '../middleware/auth'

export const webhooksRouter = Router()

webhooksRouter.get('/', requireApiKey, requirePlan('api', 'business', 'custom'), async (request, response) => {
  requireSupabaseConfig()
  const { data } = await supabase
    .from('webhooks')
    .select('id, url, events, active, created_at')
    .eq('user_id', request.userId)
  response.json(data ?? [])
})

webhooksRouter.post('/', requireApiKey, requirePlan('api', 'business', 'custom'), async (request, response) => {
  requireSupabaseConfig()
  const url = String(request.body?.url || '').trim()
  const events = normalizeWebhookEvents(request.body?.events)
  if (!await validateWebhookUrl(url)) {
    response.status(400).json({ error: 'valid_public_https_url_required' })
    return
  }
  if (!events.length) {
    response.status(400).json({ error: 'valid_event_required' })
    return
  }

  const secret = crypto.randomBytes(32).toString('hex')
  try {
    const result = await createWebhookSubscription({ userId: request.userId || '', url, secret, events })
    if (result.limitReached) {
      response.status(409).json({ error: 'webhook_limit_reached', max: result.maxWebhooks })
      return
    }
    response.json({ ...result.webhook, secret })
  } catch {
    response.status(500).json({ error: 'db_error' })
  }
})

webhooksRouter.delete('/:id', requireApiKey, async (request, response) => {
  requireSupabaseConfig()
  const { data } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .select('id')
    .single()
  if (!data) {
    response.status(404).json({ error: 'not_found' })
    return
  }
  response.json({ success: true })
})
