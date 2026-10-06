import { Router, type Request, type Response } from 'express'
import { recordAdminAudit } from '../lib/adminAudit'
import { getPlanPolicy, normalizePlan } from '../lib/plans'
import { deactivateWorkspace, ensureWorkspaceAccess } from '../lib/workspaceProvisioning'
import { getFlaggedClients, getOperationsState, setOperationsMode, type OperationsMode } from '../lib/opsState'
import { openRouterKeyPool } from '../lib/openRouterPool'
import { getSpeechProviderOrder, getSpeechProviderPoolSnapshot } from '../lib/speechToText'
import { getSpeechProviderHealthSnapshot } from '../lib/speechProviderHealth'
import {
  getSpeechProviderCredentialStatuses,
  isSpeechProvider,
  removeSpeechProviderCredential,
  saveSpeechProviderCredential,
} from '../lib/speechProviderCredentials'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { getRuntimeMetrics } from '../lib/runtimeMetrics'

export const adminRouter = Router()

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const hours = (seconds: unknown) => Math.round((Number(seconds || 0) / 3600) * 10) / 10
const activePaidStatus = (value: unknown) => ['active', 'trialing'].includes(String(value || '').toLowerCase())
const actor = (request: { userId?: string; userEmail?: string }) => ({
  actorId: request.userId,
  actorEmail: request.userEmail,
})

adminRouter.get('/operations', async (_request, response) => {
  const health = await getSpeechProviderHealthSnapshot()
  response.json({
    ...getOperationsState(),
    runtime: getRuntimeMetrics(),
    providers: {
      summary: {
        primary: openRouterKeyPool.size ? 'OpenRouter' : process.env.OPENAI_API_KEY ? 'OpenAI' : 'Not configured',
        model: openRouterKeyPool.size
          ? process.env.OPENROUTER_SUMMARY_MODEL || 'openrouter/free'
          : process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
        pool: openRouterKeyPool.snapshot(),
        openAiFallback: Boolean(process.env.OPENAI_API_KEY),
      },
      transcription: {
        free: getSpeechProviderOrder('free'),
        paid: getSpeechProviderOrder('business'),
        pool: getSpeechProviderPoolSnapshot('business'),
        credentials: getSpeechProviderCredentialStatuses(),
        health,
        models: {
          groq: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo',
          cloudflare: process.env.CLOUDFLARE_TRANSCRIPTION_MODEL || '@cf/openai/whisper-large-v3-turbo',
          deepgram: process.env.DEEPGRAM_TRANSCRIPTION_MODEL || 'nova-3',
          assemblyai: process.env.ASSEMBLYAI_MODEL || 'universal-2',
          fireworks: process.env.FIREWORKS_TRANSCRIPTION_MODEL || 'whisper-v3-turbo',
          worker: process.env.SPEECH_TO_TEXT_MODEL || 'turbo',
        },
      },
    },
    flaggedClients: getFlaggedClients(),
  })
})

adminRouter.post('/providers/health-check', async (_request, response) => {
  response.json({ health: await getSpeechProviderHealthSnapshot({ force: true }) })
})

adminRouter.get('/transcripts', async (_request, response) => {
  requireSupabaseConfig()
  const [storedResult, countResult, publicEventsResult, publicMetricsResult] = await Promise.all([
    supabase.from('transcripts')
      .select('id, user_id, video_id, video_title, video_channel, video_duration, video_thumbnail, word_count, caption_source, speech_providers, ai_fallback_seconds, created_at')
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('transcripts').select('id', { count: 'exact', head: true }),
    supabase.from('analytics_events')
      .select('event, path, visitor_id, metadata, created_at')
      .in('event', ['transcript_success', 'transcript_error'])
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('public_transcript_metrics')
      .select('transcript_count, total_response_ms, updated_at').eq('id', true).maybeSingle(),
  ])

  if (storedResult.error || countResult.error || publicEventsResult.error) {
    response.status(500).json({
      error: 'transcript_monitor_unavailable',
      message: storedResult.error?.message || countResult.error?.message || publicEventsResult.error?.message,
    })
    return
  }

  const stored = storedResult.data ?? []
  const userIds = [...new Set(stored.map((item) => item.user_id).filter(Boolean))]
  const usersResult = userIds.length
    ? await supabase.from('users').select('id, email, plan').in('id', userIds)
    : { data: [], error: null }
  const owners = new Map((usersResult.data ?? []).map((user) => [user.id, user]))
  const metrics = publicMetricsResult.data
  const publicCount = Math.max(0, Number(metrics?.transcript_count || 0))
  const totalResponseMs = Math.max(0, Number(metrics?.total_response_ms || 0))

  response.json({
    totals: {
      stored: countResult.count ?? stored.length,
      public: publicCount,
      averagePublicResponseMs: publicCount ? Math.max(1, Math.round(totalResponseMs / publicCount)) : null,
      publicCounterUpdatedAt: metrics?.updated_at ?? null,
    },
    stored: stored.map((item) => ({
      ...item,
      ownerEmail: owners.get(item.user_id)?.email ?? 'Unknown owner',
      ownerPlan: owners.get(item.user_id)?.plan ?? 'unknown',
    })),
    publicEvents: (publicEventsResult.data ?? []).map((item) => {
      const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? item.metadata as Record<string, unknown>
        : {}
      return {
        status: item.event === 'transcript_success' ? 'success' : 'error',
        videoId: typeof metadata.videoId === 'string' ? metadata.videoId : null,
        path: item.path,
        visitor: item.visitor_id ? `${item.visitor_id.slice(0, 8)}…` : 'unknown',
        createdAt: item.created_at,
      }
    }),
    warnings: publicMetricsResult.error ? ['public_transcript_metrics_unavailable'] : [],
  })
})

adminRouter.get('/transcripts/:id', async (request, response) => {
  requireSupabaseConfig()
  const { data, error } = await supabase.from('transcripts')
    .select('id, user_id, video_id, video_title, video_channel, video_duration, word_count, caption_source, speech_providers, ai_fallback_seconds, lines, ai_summary, created_at')
    .eq('id', request.params.id).maybeSingle()
  if (error) {
    response.status(500).json({ error: 'transcript_detail_unavailable', message: error.message })
    return
  }
  if (!data) {
    response.status(404).json({ error: 'transcript_not_found' })
    return
  }

  response.setHeader('Cache-Control', 'private, no-store')
  response.json(data)
})

adminRouter.post('/providers/credentials', async (request, response) => {
  const provider = String(request.body?.provider || '').toLowerCase()
  if (!isSpeechProvider(provider) || provider === 'worker') {
    response.status(400).json({ error: 'invalid_provider' })
    return
  }
  try {
    const result = await saveSpeechProviderCredential({
      provider,
      apiKey: String(request.body?.apiKey || ''),
      accountId: request.body?.accountId ? String(request.body.accountId) : undefined,
      updatedBy: request.userId,
    })
    await recordAdminAudit({
      ...actor(request),
      action: 'provider_credential_activated',
      targetType: 'speech_provider',
      targetId: provider,
      metadata: { fingerprint: result.fingerprint },
    })
    response.json({ success: true, ...result, providers: getSpeechProviderCredentialStatuses() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'provider_key_save_failed'
    const unavailable = /encryption_secret|required|database_not_configured|schema cache|unreachable/i.test(message)
    response.status(unavailable ? 503 : 400).json({ error: message })
  }
})

adminRouter.delete('/providers/credentials/:provider', async (request, response) => {
  const provider = String(request.params.provider || '').toLowerCase()
  if (!isSpeechProvider(provider) || provider === 'worker') {
    response.status(400).json({ error: 'invalid_provider' })
    return
  }
  try {
    await removeSpeechProviderCredential(provider)
    await recordAdminAudit({
      ...actor(request),
      action: 'provider_credential_override_removed',
      targetType: 'speech_provider',
      targetId: provider,
    })
    response.json({ success: true, providers: getSpeechProviderCredentialStatuses() })
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : 'provider_key_remove_failed' })
  }
})

adminRouter.post('/operations/mode', async (request, response) => {
  const nextMode = String(request.body?.mode || '') as OperationsMode
  if (!['live', 'maintenance', 'security'].includes(nextMode)) {
    response.status(400).json({ error: 'invalid_operations_mode' })
    return
  }
  try {
    const state = await setOperationsMode(nextMode, request.userId)
    await recordAdminAudit({
      ...actor(request),
      action: 'operations_mode_changed',
      targetType: 'operations',
      targetId: nextMode,
      metadata: { mode: nextMode },
    })
    response.json(state)
  } catch (error) {
    response.status(503).json({
      error: 'operations_mode_save_failed',
      message: error instanceof Error ? error.message : 'Mode could not be saved.',
    })
  }
})

adminRouter.get('/overview', async (_request, response) => {
  requireSupabaseConfig()
  const since30 = daysAgo(30)
  const since1 = daysAgo(1)

  const [
    eventsResult,
    usersResult,
    waitlistResult,
    feedbackResult,
    usageResult,
    customerUsageResult,
    jobsResult,
    webhookDeliveriesResult,
    billingEventsResult,
    auditResult,
    incidentResult,
    providerUsageResult,
  ] = await Promise.all([
    supabase.from('analytics_events')
      .select('visitor_id, session_id, event, path, referrer, created_at')
      .gte('created_at', since30).order('created_at', { ascending: false }).limit(5000),
    supabase.from('users')
      .select('id, email, plan, transcripts_limit, access_source, beta_expires_at, subscription_status, polar_customer_id, polar_subscription_id, polar_product_id, polar_quantity, created_at')
      .order('created_at', { ascending: false }).limit(1000),
    supabase.from('waitlist')
      .select('id, email, name, company, plan, requested_quantity, status, approved_user_id, created_at, updated_at')
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('feedback_messages')
      .select('id, username, message, source, status, created_at')
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('usage_logs')
      .select('user_id, status, endpoint, caption_seconds, ai_fallback_seconds, created_at')
      .gte('created_at', since30).order('created_at', { ascending: false }).limit(5000),
    supabase.rpc('admin_list_customer_usage', {
      p_search: '', p_plan: '', p_status: '', p_limit: 500, p_offset: 0,
    }),
    supabase.from('batch_jobs')
      .select('id, user_id, total, completed, failed, status, created_at, completed_at')
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('webhook_deliveries')
      .select('id, event, status, attempts, updated_at, created_at')
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('billing_webhook_events')
      .select('id, event_type, processed_at')
      .order('processed_at', { ascending: false }).limit(100),
    supabase.from('admin_audit_log')
      .select('id, actor_email, action, target_type, target_id, metadata, created_at')
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('rate_limit_incidents')
      .select('fingerprint, route, occurred_at')
      .gte('occurred_at', since30).order('occurred_at', { ascending: false }).limit(1000),
    supabase.from('speech_provider_usage')
      .select('provider, audio_seconds, status, created_at')
      .gte('created_at', since30).order('created_at', { ascending: false }).limit(5000),
  ])

  if (eventsResult.error) {
    response.status(500).json({ error: 'analytics_table_missing', message: eventsResult.error.message })
    return
  }

  const events = eventsResult.data ?? []
  const users = usersResult.data ?? []
  const waitlist = waitlistResult.data ?? []
  const feedback = feedbackResult.data ?? []
  const usageLogs = usageResult.data ?? []
  const last24Events = events.filter((event) => event.created_at >= since1)
  const byUser = usageLogs.reduce<Record<string, { caption: number; fallback: number; completed: number; last: string | null }>>((acc, log) => {
    if (!log.user_id || log.status !== 'success') return acc
    const item = acc[log.user_id] ?? { caption: 0, fallback: 0, completed: 0, last: null }
    item.caption += Number(log.caption_seconds || 0)
    item.fallback += Number(log.ai_fallback_seconds || 0)
    item.completed += 1
    item.last = !item.last || log.created_at > item.last ? log.created_at : item.last
    acc[log.user_id] = item
    return acc
  }, {})

  const legacyCustomerRows = (customerUsageResult.data ?? []) as Array<Record<string, unknown>>
  const legacyByUser = new Map(legacyCustomerRows.map((row) => [String(row.user_id), row]))
  const hasHourBasedRpc = !customerUsageResult.error
    && (legacyCustomerRows.length === 0 || Object.hasOwn(legacyCustomerRows[0], 'caption_limit_seconds'))
  const fallbackRows = users.map((user) => {
    const plan = normalizePlan(user.plan)
    const policy = getPlanPolicy(plan)
    const usage = byUser[user.id] ?? { caption: 0, fallback: 0, completed: 0, last: null }
    return {
      user_id: user.id,
      email: user.email,
      plan,
      access_source: user.access_source,
      subscription_status: user.subscription_status,
      polar_customer_id: user.polar_customer_id,
      polar_subscription_id: user.polar_subscription_id,
      polar_product_id: user.polar_product_id,
      polar_quantity: user.polar_quantity ?? 1,
      caption_limit_seconds: policy.captionSecondsLimit,
      caption_used_seconds: usage.caption,
      caption_remaining_seconds: policy.captionSecondsLimit == null ? null : Math.max(policy.captionSecondsLimit - usage.caption, 0),
      caption_percentage: policy.captionSecondsLimit ? Math.min(100, usage.caption * 100 / policy.captionSecondsLimit) : 0,
      ai_fallback_limit_seconds: policy.aiFallbackSecondsLimit,
      ai_fallback_used_seconds: usage.fallback,
      ai_fallback_remaining_seconds: policy.aiFallbackSecondsLimit == null ? null : Math.max(policy.aiFallbackSecondsLimit - usage.fallback, 0),
      ai_fallback_percentage: policy.aiFallbackSecondsLimit ? Math.min(100, usage.fallback * 100 / policy.aiFallbackSecondsLimit) : 0,
      completed_transcripts: usage.completed,
      last_used_at: usage.last,
      active_keys: Number(legacyByUser.get(user.id)?.active_keys ?? 0),
      created_at: user.created_at,
    }
  })

  const rows: typeof fallbackRows = hasHourBasedRpc
    ? (customerUsageResult.data as typeof fallbackRows | null) ?? []
    : fallbackRows
  const customers = rows.map((row) => {
    const plan = normalizePlan(row.plan)
    const quantity = Math.max(1, Number(row.polar_quantity ?? 1))
    const activePaid = row.access_source === 'polar' && activePaidStatus(row.subscription_status)
    return {
      id: row.user_id,
      email: row.email,
      plan,
      accessSource: row.access_source,
      subscriptionStatus: row.subscription_status,
      polarCustomerId: row.polar_customer_id,
      polarSubscriptionId: row.polar_subscription_id,
      polarProductId: row.polar_product_id,
      quantity,
      caption: {
        limitHours: row.caption_limit_seconds == null ? null : hours(row.caption_limit_seconds),
        usedHours: hours(row.caption_used_seconds),
        remainingHours: row.caption_remaining_seconds == null ? null : hours(row.caption_remaining_seconds),
        percentage: Number(row.caption_percentage ?? 0),
      },
      fallback: {
        limitHours: row.ai_fallback_limit_seconds == null ? null : hours(row.ai_fallback_limit_seconds),
        usedHours: hours(row.ai_fallback_used_seconds),
        remainingHours: row.ai_fallback_remaining_seconds == null ? null : hours(row.ai_fallback_remaining_seconds),
        percentage: Number(row.ai_fallback_percentage ?? 0),
      },
      completedTranscripts: Number(row.completed_transcripts ?? 0),
      lastUsedAt: row.last_used_at,
      activeKeys: Number(row.active_keys ?? 0),
      monthlyRevenue: activePaid ? (plan === 'api' ? 9 * quantity : plan === 'business' ? 79 : 0) : 0,
      createdAt: row.created_at,
    }
  })

  const activeSubscriptions = customers.filter((customer) =>
    customer.accessSource === 'polar' && activePaidStatus(customer.subscriptionStatus))
  const countBy = <T,>(items: T[], getKey: (item: T) => string) =>
    items.reduce<Record<string, number>>((acc, item) => {
      const key = getKey(item) || 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  const unique = (items: string[]) => new Set(items.filter(Boolean)).size

  const incidentGroups = new Map<string, { fingerprint: string; hits: number; route: string; lastSeenAt: string }>()
  for (const item of incidentResult.data ?? []) {
    const existing = incidentGroups.get(item.fingerprint)
    incidentGroups.set(item.fingerprint, {
      fingerprint: item.fingerprint,
      hits: (existing?.hits || 0) + 1,
      route: item.route,
      lastSeenAt: existing?.lastSeenAt && existing.lastSeenAt > item.occurred_at ? existing.lastSeenAt : item.occurred_at,
    })
  }

  const providerUsage = Object.entries(
    (providerUsageResult.data ?? []).reduce<Record<string, { seconds: number; failures: number }>>((acc, item) => {
      const entry = acc[item.provider] ?? { seconds: 0, failures: 0 }
      if (item.status === 'success') entry.seconds += Number(item.audio_seconds || 0)
      if (item.status === 'error') entry.failures += 1
      acc[item.provider] = entry
      return acc
    }, {}),
  ).map(([provider, value]) => ({ provider, usedHours: hours(value.seconds), failures: value.failures }))

  const jobs = jobsResult.data ?? []
  const webhookDeliveries = webhookDeliveriesResult.data ?? []
  const unfinishedJobs = jobs.filter((job) => ['queued', 'pending', 'processing', 'running'].includes(String(job.status).toLowerCase()))

  response.json({
    stats: {
      visitors30d: unique(events.map((event) => event.visitor_id)),
      visitors24h: unique(last24Events.map((event) => event.visitor_id)),
      pageviews30d: events.filter((event) => event.event === 'page_view').length,
      transcripts30d: events.filter((event) => event.event === 'transcript_success').length,
      transcriptErrors30d: events.filter((event) => event.event === 'transcript_error').length,
      waitlistCount: waitlist.filter((item) => item.status === 'pending').length,
      feedbackCount: feedback.filter((item) => item.status === 'new').length,
      usersCount: users.length,
      activeSubscriptions: activeSubscriptions.length,
      estimatedMrr: activeSubscriptions.reduce((sum, customer) => sum + customer.monthlyRevenue, 0),
      captionHoursMonth: Math.round(customers.reduce((sum, customer) => sum + customer.caption.usedHours, 0) * 10) / 10,
      fallbackHoursMonth: Math.round(customers.reduce((sum, customer) => sum + customer.fallback.usedHours, 0) * 10) / 10,
      queuedJobs: unfinishedJobs.length,
      pendingJobItems: unfinishedJobs.reduce((sum, job) => sum + Math.max(Number(job.total || 0) - Number(job.completed || 0) - Number(job.failed || 0), 0), 0),
      webhookFailures: webhookDeliveries.filter((item) => ['failed', 'error'].includes(String(item.status).toLowerCase())).length,
    },
    charts: {
      topPages: Object.entries(countBy(events.filter((event) => event.event === 'page_view'), (event) => event.path))
        .sort((a, b) => b[1] - a[1]).slice(0, 8),
      plans: countBy(users, (user) => user.plan),
    },
    recent: {
      events: events.slice(0, 30),
      waitlist,
      feedback,
      jobs,
      webhookDeliveries,
      billingEvents: billingEventsResult.data ?? [],
      audit: auditResult.data ?? [],
    },
    incidents: [...incidentGroups.values()].sort((a, b) => b.hits - a.hits),
    providerUsage,
    customers,
    customerUsageSource: hasHourBasedRpc ? 'database_rpc' : 'fallback',
    migrationWarnings: [
      !hasHourBasedRpc ? 'hour_based_admin_usage_rpc_missing' : null,
      auditResult.error ? 'admin_audit_log_missing' : null,
      incidentResult.error ? 'rate_limit_incidents_missing' : null,
    ].filter(Boolean),
  })
})

async function approveAccess(request: Request, response: Response) {
  requireSupabaseConfig()
  if (!process.env.RESEND_API_KEY) {
    response.status(503).json({ error: 'email_not_configured', message: 'Configure Resend before approving access.' })
    return
  }
  const { data: application } = await supabase
    .from('waitlist')
    .select('id, email, plan, status')
    .eq('id', request.params.id)
    .single()
  if (!application) {
    response.status(404).json({ error: 'application_not_found' })
    return
  }
  if (application.status === 'approved') {
    response.status(409).json({ error: 'application_already_approved' })
    return
  }

  const plan = normalizePlan(application.plan)
  if (!['api', 'business', 'custom'].includes(plan)) {
    response.status(400).json({ error: 'invalid_plan' })
    return
  }
  const policy = getPlanPolicy(plan)
  const legacyLimit = policy.transcriptsLimit ?? 100_000
  const betaDays = Math.min(Math.max(Number(process.env.BETA_ACCESS_DAYS || 90), 1), 365)
  const betaExpiresAt = new Date(Date.now() + betaDays * 86_400_000).toISOString()

  let { data: user } = await supabase
    .from('users')
    .select('id, polar_subscription_id, subscription_status')
    .eq('email', application.email)
    .maybeSingle()
  if (user?.polar_subscription_id && activePaidStatus(user.subscription_status)) {
    response.status(409).json({ error: 'paid_subscription_exists' })
    return
  }
  if (!user) {
    const { data: created, error } = await supabase
      .from('users')
      .insert({ email: application.email, plan: 'free', transcripts_limit: 100 })
      .select('id, polar_subscription_id, subscription_status')
      .single()
    if (error || !created) {
      response.status(500).json({ error: 'user_create_failed' })
      return
    }
    user = created
  }

  const { error: userError } = await supabase
    .from('users')
    .update({ plan, transcripts_limit: legacyLimit, access_source: 'beta', beta_expires_at: betaExpiresAt })
    .eq('id', user.id)
  if (userError) {
    response.status(500).json({ error: 'access_activation_failed' })
    return
  }
  try {
    await ensureWorkspaceAccess(user.id, plan, legacyLimit)
  } catch (error) {
    response.status(500).json({
      error: 'workspace_access_provision_failed',
      message: error instanceof Error ? error.message : 'Workspace provisioning failed.',
    })
    return
  }
  await supabase.from('waitlist')
    .update({ status: 'approved', approved_user_id: user.id, updated_at: new Date().toISOString() })
    .eq('id', application.id)
  await recordAdminAudit({
    ...actor(request),
    action: 'access_request_approved',
    targetType: 'waitlist',
    targetId: application.id,
    metadata: { userId: user.id, plan, expiresAt: betaExpiresAt },
  })
  response.json({ success: true, user_id: user.id, plan, beta_expires_at: betaExpiresAt })
}

adminRouter.post('/access/:id/approve', approveAccess)

adminRouter.post('/access/:id/reject', async (request, response) => {
  const { data, error } = await supabase
    .from('waitlist')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', request.params.id)
    .neq('status', 'approved')
    .select('id')
    .maybeSingle()
  if (error) {
    response.status(500).json({ error: 'access_request_update_failed' })
    return
  }
  if (!data) {
    response.status(409).json({ error: 'approved_access_must_be_revoked' })
    return
  }
  await recordAdminAudit({
    ...actor(request),
    action: 'access_request_rejected',
    targetType: 'waitlist',
    targetId: request.params.id,
  })
  response.json({ success: true })
})

adminRouter.post('/access/:id/revoke', async (request, response) => {
  requireSupabaseConfig()
  const { data: application } = await supabase
    .from('waitlist')
    .select('id, approved_user_id')
    .eq('id', request.params.id)
    .single()
  if (!application?.approved_user_id) {
    response.status(404).json({ error: 'approved_application_not_found' })
    return
  }
  const { data: user } = await supabase
    .from('users')
    .select('polar_subscription_id, subscription_status')
    .eq('id', application.approved_user_id)
    .single()
  if (user?.polar_subscription_id && activePaidStatus(user.subscription_status)) {
    response.status(409).json({ error: 'paid_subscription_exists' })
    return
  }
  await deactivateWorkspace(application.approved_user_id)
  await supabase.from('users')
    .update({ plan: 'free', transcripts_limit: 100, access_source: 'revoked_beta', beta_expires_at: null })
    .eq('id', application.approved_user_id)
  await supabase.from('waitlist')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', application.id)
  await recordAdminAudit({
    ...actor(request),
    action: 'access_request_revoked',
    targetType: 'waitlist',
    targetId: application.id,
    metadata: { userId: application.approved_user_id },
  })
  response.json({ success: true })
})

adminRouter.patch('/feedback/:id', async (request, response) => {
  const status = String(request.body?.status || '')
  if (!['new', 'reviewed', 'archived'].includes(status)) {
    response.status(400).json({ error: 'invalid_feedback_status' })
    return
  }
  const { error } = await supabase.from('feedback_messages').update({ status }).eq('id', request.params.id)
  if (error) {
    response.status(500).json({ error: 'feedback_update_failed' })
    return
  }
  await recordAdminAudit({
    ...actor(request),
    action: 'feedback_status_changed',
    targetType: 'feedback',
    targetId: request.params.id,
    metadata: { status },
  })
  response.json({ success: true, status })
})
