import { supabase } from './supabase'

export const WEBHOOK_EVENTS = ['transcript.completed', 'batch.completed'] as const

export function normalizeWebhookEvents(value: unknown) {
  if (!Array.isArray(value)) return ['transcript.completed']
  return [...new Set(value.map(String).filter((event) => WEBHOOK_EVENTS.includes(event as typeof WEBHOOK_EVENTS[number])))]
}

export async function createWebhookSubscription(params: {
  userId: string
  url: string
  secret: string
  events: string[]
}) {
  const { data, error } = await supabase.rpc('create_webhook_subscription', {
    p_user_id: params.userId,
    p_url: params.url,
    p_secret: params.secret,
    p_events: params.events,
  })
  if (error) throw new Error(`webhook_create_failed: ${error.message}`)
  const result = Array.isArray(data) ? data[0] : data
  return {
    limitReached: Boolean(result?.limit_reached),
    maxWebhooks: Number(result?.max_webhooks ?? 0),
    webhook: result?.webhook_id ? {
      id: result.webhook_id,
      url: result.webhook_url,
      events: result.webhook_events,
      active: result.webhook_active,
      created_at: result.webhook_created_at,
    } : null,
  }
}
