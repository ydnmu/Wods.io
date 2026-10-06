import { Router } from 'express'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { requireApiKey, requirePlan } from '../middleware/auth'

export const channelsRouter = Router()

export const extractChannelId = (value: string) => {
  const trimmedValue = value.trim()
  if (/^UC[\w-]{20,}$/.test(trimmedValue)) return trimmedValue

  try {
    const parsedUrl = new URL(trimmedValue)
    const parts = parsedUrl.pathname.split('/').filter(Boolean)
    const channelIndex = parts.indexOf('channel')
    if (channelIndex >= 0 && parts[channelIndex + 1]) return parts[channelIndex + 1]
  } catch {
    // Handled below.
  }

  return null
}

export const resolveChannel = async (value: string) => {
  const directId = extractChannelId(value)
  if (directId) return { channelId: directId, channelName: directId }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(value.trim())
  } catch {
    return null
  }

  if (!parsedUrl.hostname.includes('youtube.com')) return null

  try {
    const page = await fetch(parsedUrl.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EasyTran/1.0)' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!page.ok) return null
    const html = await page.text()
    const channelId = html.match(/"externalId":"(UC[\w-]+)"/)?.[1]
      ?? html.match(/"browseId":"(UC[\w-]+)"/)?.[1]
      ?? html.match(/"channelId":"(UC[\w-]+)"/)?.[1]
      ?? html.match(/<meta itemprop="channelId" content="(UC[\w-]+)">/)?.[1]
    const channelName = html.match(/<meta property="og:title" content="([^"]+)">/)?.[1]
    return channelId ? { channelId, channelName: channelName || channelId } : null
  } catch {
    return null
  }
}

export const upsertChannelSubscription = async (userId: string, channelId: string, channelName: string) => {
  const { data, error } = await supabase.rpc('upsert_channel_subscription', {
    p_user_id: userId,
    p_channel_id: channelId,
    p_channel_name: channelName,
  })
  if (error) throw new Error(`channel_subscription_failed: ${error.message}`)

  const result = Array.isArray(data) ? data[0] : data
  return {
    limitReached: Boolean(result?.limit_reached),
    maxChannels: Number(result?.max_channels ?? 0),
    channel: result?.subscription_id ? {
      id: result.subscription_id,
      channel_id: result.channel_id,
      channel_name: result.channel_name,
      last_synced_at: result.last_synced_at,
      active: result.active,
      created_at: result.created_at,
    } : null,
  }
}

channelsRouter.post('/', requireApiKey, requirePlan('business', 'custom'), async (request, response) => {
  requireSupabaseConfig()
  const channelUrl = String(request.body?.channelUrl || '')
  const resolved = await resolveChannel(channelUrl)
  const channelId = resolved?.channelId

  if (!channelId) {
    response.status(400).json({
      error: 'channel_id_required',
      message: 'Use a YouTube channel URL, @handle URL, or direct channel ID.',
    })
    return
  }

  const channelName = String(request.body?.channelName || resolved?.channelName || channelId)
  try {
    const result = await upsertChannelSubscription(request.userId || '', channelId, channelName)
    if (result.limitReached) {
      response.status(409).json({ error: 'channel_limit_reached', max: result.maxChannels })
      return
    }
    response.json(result.channel)
  } catch {
    response.status(500).json({ error: 'db_error' })
  }
})

channelsRouter.get('/', requireApiKey, requirePlan('business', 'custom'), async (request, response) => {
  requireSupabaseConfig()
  const { data } = await supabase
    .from('channel_subscriptions')
    .select('id, channel_id, channel_name, last_synced_at, active, created_at')
    .eq('user_id', request.userId)
    .order('created_at', { ascending: false })

  response.json(data ?? [])
})

channelsRouter.delete('/:id', requireApiKey, async (request, response) => {
  requireSupabaseConfig()
  const { data } = await supabase
    .from('channel_subscriptions')
    .update({ active: false })
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
