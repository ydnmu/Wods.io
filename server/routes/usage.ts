import { Router } from 'express'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { getPlanPolicy, normalizePlan } from '../lib/plans'
import { nextMonthStart } from '../lib/usage'
import { effectivePlan, isBetaExpired } from '../lib/entitlements'

export const usageRouter = Router()

usageRouter.get('/', async (request, response) => {
  requireSupabaseConfig()

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [userResult, usageSummaryResult] = await Promise.all([
    supabase
      .from('users')
      .select('email, plan, access_source, beta_expires_at, subscription_status')
      .eq('id', request.userId)
      .single(),
    supabase.rpc('get_workspace_monthly_usage', { p_user_id: request.userId }),
  ])
  const user = userResult.data

  if (!user) {
    response.status(404).json({ error: 'user_not_found' })
    return
  }

  let summary = (Array.isArray(usageSummaryResult.data)
    ? usageSummaryResult.data[0]
    : usageSummaryResult.data) as {
      completed_transcripts?: number | string
      caption_seconds?: number | string
      ai_fallback_seconds?: number | string
      caption_transcripts?: number | string
    } | null

  if (usageSummaryResult.error) {
    const missingSummaryFunction = usageSummaryResult.error.code === 'PGRST202'
      || usageSummaryResult.error.code === '42883'
      || /get_workspace_monthly_usage/i.test(usageSummaryResult.error.message)
    if (!missingSummaryFunction) {
      response.status(503).json({ error: 'usage_summary_unavailable' })
      return
    }
    const legacyResult = await supabase
      .from('usage_logs')
      .select('status, caption_seconds, ai_fallback_seconds')
      .eq('user_id', request.userId)
      .eq('status', 'success')
      .gte('created_at', monthStart.toISOString())
    if (legacyResult.error) {
      response.status(503).json({ error: 'usage_summary_unavailable' })
      return
    }
    const legacyLogs = legacyResult.data ?? []
    summary = {
      completed_transcripts: legacyLogs.length,
      caption_seconds: legacyLogs.reduce((total, log) => total + Math.max(0, Number(log.caption_seconds || 0)), 0),
      ai_fallback_seconds: legacyLogs.reduce((total, log) => total + Math.max(0, Number(log.ai_fallback_seconds || 0)), 0),
      caption_transcripts: legacyLogs.filter((log) => !Number(log.ai_fallback_seconds || 0)).length,
    }
  }

  const used = Math.max(0, Number(summary?.completed_transcripts || 0))
  const captionSeconds = Math.max(0, Number(summary?.caption_seconds || 0))
  const aiFallbackSeconds = Math.max(0, Number(summary?.ai_fallback_seconds || 0))
  const captionTranscripts = Math.max(0, Number(summary?.caption_transcripts || 0))
  const plan = normalizePlan(effectivePlan(user))
  const policy = getPlanPolicy(plan)
  const hourMeter = (usedSeconds: number, limitSeconds: number | null) => {
    const remainingSeconds = limitSeconds === null ? null : Math.max(0, limitSeconds - usedSeconds)
    return {
      usedSeconds,
      usedHours: Math.round((usedSeconds / 3600) * 10) / 10,
      limitSeconds,
      limitHours: limitSeconds === null ? null : limitSeconds / 3600,
      remainingSeconds,
      remainingHours: remainingSeconds === null ? null : Math.round((remainingSeconds / 3600) * 10) / 10,
      remainingPercentage: limitSeconds === null || limitSeconds <= 0
        ? 100
        : Math.max(0, Math.min(100, Math.round(((limitSeconds - usedSeconds) / limitSeconds) * 100))),
    }
  }

  response.json({
    email: user.email,
    username: request.userName || user.email.split('@')[0],
    role: request.userRole || 'teammate',
    plan,
    completedTranscripts: used,
    resetAt: nextMonthStart(),
    captionTranscripts,
    aiFallbackSeconds,
    aiFallbackMinutes: Math.ceil(aiFallbackSeconds / 60),
    captionHours: hourMeter(captionSeconds, policy.captionSecondsLimit),
    aiFallbackHours: hourMeter(aiFallbackSeconds, policy.aiFallbackSecondsLimit),
    dailyUsage: {},
    recentLogs: [],
    accessSource: user.access_source,
    betaExpiresAt: user.beta_expires_at,
    betaExpired: isBetaExpired(user),
    subscriptionStatus: user.subscription_status,
  })
})
