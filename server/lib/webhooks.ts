import crypto from 'node:crypto'
import { requireSupabaseConfig, supabase } from './supabase'
import { validateWebhookUrl } from './webhookUrl'

export function createWebhookSignature(secret: string, payload: string, timestamp: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
}

function getNextRetry(attempt: number) {
  const delays = [60, 300, 1800, 7200, 86400]
  const delay = delays[Math.min(attempt - 1, delays.length - 1)]
  return new Date(Date.now() + delay * 1000).toISOString()
}

export async function deliverWebhook(
  webhookId: string,
  webhookUrl: string,
  secret: string,
  event: string,
  payload: object,
) {
  const body = JSON.stringify(payload)
  const timestamp = Date.now().toString()
  const signature = createWebhookSignature(secret, body, timestamp)

  try {
    if (!await validateWebhookUrl(webhookUrl)) return false
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Easytran-Event': event,
        'X-Easytran-Webhook-Id': webhookId,
        'X-Easytran-Signature': `sha256=${signature}`,
        'X-Easytran-Timestamp': timestamp,
      },
      body,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    })

    return response.ok
  } catch {
    return false
  }
}

export async function fireEvent(userId: string | undefined, event: string, payload: object) {
  if (!userId) return
  requireSupabaseConfig()

  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', userId)
    .eq('active', true)
    .contains('events', [event])

  if (!webhooks?.length) return

  for (const webhook of webhooks) {
    const success = await deliverWebhook(webhook.id, webhook.url, webhook.secret, event, payload)
    await supabase.from('webhook_deliveries').insert({
      webhook_id: webhook.id,
      event,
      payload,
      status: success ? 'delivered' : 'pending',
      attempts: 1,
      next_retry_at: success ? null : getNextRetry(1),
    })
  }
}

export async function retryFailedWebhooks() {
  requireSupabaseConfig()
  let processed = 0
  while (processed < 50) {
    const { data: claimData, error: claimError } = await supabase.rpc('claim_next_webhook_delivery')
    if (claimError) throw new Error(`webhook_claim_failed: ${claimError.message}`)
    const delivery = Array.isArray(claimData) ? claimData[0] : claimData
    if (!delivery?.delivery_id) break

    const success = await deliverWebhook(
      delivery.webhook_id,
      delivery.webhook_url,
      delivery.webhook_secret,
      delivery.event_name,
      delivery.event_payload,
    )
    const { error: completionError } = await supabase.rpc('complete_webhook_delivery', {
      p_delivery_id: delivery.delivery_id,
      p_worker_token: delivery.worker_token,
      p_success: success,
      p_next_retry_at: success ? null : getNextRetry(delivery.delivery_attempts + 1),
    })
    if (completionError) throw new Error(`webhook_completion_failed: ${completionError.message}`)
    processed += 1
  }
  return processed
}
