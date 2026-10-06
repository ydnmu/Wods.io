import { Router } from 'express'
import { getPlanPolicy } from '../lib/plans'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { resolveChannel, upsertChannelSubscription } from './channels'
import { nextChannelRunAt, normalizeChannelAutomationSettings, type ChannelAutomationSettings } from '../lib/channelAutomation'
import { syncChannelSubscriptionById } from '../lib/channelSync'

export const dashboardChannelsRouter = Router()

type DashboardChannel = ChannelAutomationSettings & {
  id: string
  channel_id: string
  channel_name: string
  last_synced_at: string | null
  active: boolean
  created_at: string
  next_run_at: string | null
  last_run_started_at: string | null
  last_run_completed_at: string | null
  last_run_status: string
  last_run_error: string | null
  last_run_processed: number
  last_run_failed: number
}

const dashboardChannelSelect = 'id, channel_id, channel_name, last_synced_at, active, created_at, schedule_frequency, schedule_time, timezone, auto_summary, ai_fallback, backfill_limit, paused, next_run_at, last_run_started_at, last_run_completed_at, last_run_status, last_run_error, last_run_processed, last_run_failed'

dashboardChannelsRouter.get('/', async (request, response) => {
  requireSupabaseConfig()
  const policy = getPlanPolicy(request.userPlan)
  if (!policy.channelSync) {
    response.status(403).json({ error: 'plan_required' })
    return
  }

  const { data, error } = await supabase
    .from('channel_subscriptions')
    .select(dashboardChannelSelect)
    .eq('user_id', request.userId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .returns<DashboardChannel[]>()

  if (error) {
    response.status(500).json({ error: 'automation_schema_unavailable' })
    return
  }
  response.json(data ?? [])
})

dashboardChannelsRouter.post('/', async (request, response) => {
  requireSupabaseConfig()
  const policy = getPlanPolicy(request.userPlan)
  if (!policy.channelSync) {
    response.status(403).json({ error: 'plan_required' })
    return
  }

  const { error: schemaError } = await supabase
    .from('channel_subscriptions')
    .select('id, schedule_frequency')
    .limit(1)
  if (schemaError) {
    response.status(503).json({ error: 'automation_migration_required' })
    return
  }

  const channelUrl = String(request.body?.channelUrl || '').trim()
  const resolved = await resolveChannel(channelUrl)
  if (!resolved) {
    response.status(400).json({ error: 'invalid_channel_url' })
    return
  }

  try {
    const result = await upsertChannelSubscription(request.userId || '', resolved.channelId, resolved.channelName)
    if (result.limitReached) {
      response.status(409).json({ error: 'channel_limit_reached', max: result.maxChannels })
      return
    }
    if (!result.channel) throw new Error('channel_subscription_missing')
    const settings = normalizeChannelAutomationSettings(request.body?.settings || {})
    const { data: channel, error: settingsError } = await supabase
      .from('channel_subscriptions')
      .update({
        ...settings,
        next_run_at: new Date().toISOString(),
        last_run_status: 'pending',
        last_run_error: null,
      })
      .eq('id', result.channel.id)
      .eq('user_id', request.userId)
      .select(dashboardChannelSelect)
      .single<DashboardChannel>()
    if (settingsError) throw settingsError
    response.json(channel)
  } catch {
    response.status(500).json({ error: 'db_error' })
  }
})

dashboardChannelsRouter.patch('/:id', async (request, response) => {
  requireSupabaseConfig()
  const policy = getPlanPolicy(request.userPlan)
  if (!policy.channelSync) {
    response.status(403).json({ error: 'plan_required' })
    return
  }

  const { data: current, error: currentError } = await supabase
    .from('channel_subscriptions')
    .select(dashboardChannelSelect)
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .eq('active', true)
    .single<DashboardChannel>()
  if (currentError && String(currentError.message || '').includes('column')) {
    response.status(503).json({ error: 'automation_migration_required' })
    return
  }
  if (!current) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  const currentSettings = normalizeChannelAutomationSettings(current)
  const settings = normalizeChannelAutomationSettings(request.body || {}, currentSettings)
  const scheduleChanged = settings.schedule_frequency !== current.schedule_frequency
    || settings.schedule_time !== String(current.schedule_time).slice(0, 5)
    || settings.timezone !== current.timezone
    || (currentSettings.paused && !settings.paused)
  const { data, error } = await supabase
    .from('channel_subscriptions')
    .update({
      ...settings,
      next_run_at: scheduleChanged
        ? nextChannelRunAt(settings.schedule_frequency, settings.schedule_time, settings.timezone)
        : current.next_run_at,
    })
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .select(dashboardChannelSelect)
    .single<DashboardChannel>()

  if (error || !data) {
    response.status(500).json({ error: 'update_failed' })
    return
  }
  response.json(data)
})

dashboardChannelsRouter.post('/:id/run', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).channelSync || !request.userId) {
    response.status(403).json({ error: 'plan_required' })
    return
  }

  const { data } = await supabase
    .from('channel_subscriptions')
    .select('id, schedule_frequency')
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .eq('active', true)
    .single()
  if (!data) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  response.status(202).json({ status: 'queued' })
  void syncChannelSubscriptionById(request.params.id, request.userId)
    .catch((error) => console.error('[channel-sync] manual run failed:', error))
})

dashboardChannelsRouter.delete('/:id', async (request, response) => {
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
