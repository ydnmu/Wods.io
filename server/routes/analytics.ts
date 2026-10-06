import { Router } from 'express'
import { hasSupabaseConfig, supabase } from '../lib/supabase'

export const analyticsRouter = Router()

analyticsRouter.post('/event', async (request, response) => {
  if (!hasSupabaseConfig()) {
    response.json({ success: true, skipped: 'supabase_not_configured' })
    return
  }

  const visitorId = String(request.body?.visitorId || '').slice(0, 80)
  const sessionId = String(request.body?.sessionId || '').slice(0, 80)
  const event = String(request.body?.event || '').slice(0, 80)
  const path = String(request.body?.path || request.path || '').slice(0, 240)
  const referrer = String(request.body?.referrer || '').slice(0, 500)
  const metadata = typeof request.body?.metadata === 'object' && request.body.metadata ? request.body.metadata : {}

  if (!visitorId || !sessionId || !event) {
    response.status(400).json({ error: 'invalid_event' })
    return
  }

  await supabase.from('analytics_events').insert({
    visitor_id: visitorId,
    session_id: sessionId,
    event,
    path,
    referrer,
    user_agent: request.headers['user-agent'] || '',
    metadata,
  })

  response.json({ success: true })
})
