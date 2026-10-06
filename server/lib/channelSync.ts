import { fetchCaptions, fetchTranscriptWithFallback, fetchVideoMeta, type TranscriptSegment } from './youtube'
import { fireEvent } from './webhooks'
import { requireSupabaseConfig, supabase } from './supabase'
import { saveTranscript } from './transcriptStore'
import { getPlanPolicy } from './plans'
import { recordUsageSpeech, reserveUsage, transcriptDurationSeconds } from './usage'
import { effectivePlan } from './entitlements'
import { inspectYouTubeSource } from './sourceInspector'
import { nextChannelRunAt, normalizeChannelAutomationSettings, type ChannelAutomationSettings } from './channelAutomation'
import { generateTranscriptSummary } from '../routes/summary'
import { awaitJobInputs } from './jobInputs'

export type ChannelSubscription = ChannelAutomationSettings & {
  id: string
  user_id: string
  channel_id: string
  channel_name: string
  next_run_at: string | null
  last_run_status: string
  last_run_started_at: string | null
  users: unknown
}

const channelSelect = 'id, user_id, channel_id, channel_name, schedule_frequency, schedule_time, timezone, auto_summary, ai_fallback, backfill_limit, paused, next_run_at, last_run_status, last_run_started_at, users(plan, access_source, beta_expires_at)'

type ChannelTranscript = {
  segments: TranscriptSegment[]
  captionSource: string
  speechProviders?: string[]
  aiFallbackSeconds?: number
}

async function fetchRecentChannelVideos(channelId: string): Promise<{ videoId: string; title: string }[]> {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) throw new Error(`channel_feed_failed: ${response.status}`)
  const xml = await response.text()
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? []

  return entries
    .map((entry) => ({
      videoId: entry.match(/video_id>([^<]+)/)?.[1] ?? '',
      title: entry.match(/<title>([^<]+)<\/title>/)?.[1] ?? '',
    }))
    .filter((entry) => entry.videoId)
}

async function fetchChannelVideos(subscription: ChannelSubscription) {
  if (!subscription.backfill_limit) return fetchRecentChannelVideos(subscription.channel_id)

  const inspection = await inspectYouTubeSource(
    `https://www.youtube.com/channel/${subscription.channel_id}`,
    subscription.backfill_limit,
  )
  return inspection.urls.map((url) => ({
    videoId: new URL(url).searchParams.get('v') || '',
    title: '',
  })).filter((video) => video.videoId)
}

const joinedPlan = (users: unknown) => {
  const joinedUser = Array.isArray(users) ? users[0] : users
  return effectivePlan((joinedUser || {}) as { plan?: string; access_source?: string; beta_expires_at?: string | null })
}

async function claimChannel(subscriptionId: string, userId?: string, force = false) {
  const { data, error } = await supabase.rpc('claim_channel_sync', {
    p_subscription_id: subscriptionId,
    p_user_id: userId || null,
    p_force: force,
  })
  if (error) throw new Error(`channel_sync_claim_failed: ${error.message}`)
  return Boolean(data)
}

async function completeRun(
  subscription: ChannelSubscription,
  status: 'success' | 'partial' | 'failed',
  processed: number,
  failed: number,
  error?: string,
) {
  const now = new Date()
  const { error: completionError } = await supabase
    .from('channel_subscriptions')
    .update({
      last_synced_at: now.toISOString(),
      last_run_completed_at: now.toISOString(),
      last_run_status: status,
      last_run_error: error?.slice(0, 500) || null,
      last_run_processed: processed,
      last_run_failed: failed,
      backfill_limit: 0,
      next_run_at: nextChannelRunAt(
        subscription.schedule_frequency,
        String(subscription.schedule_time).slice(0, 5),
        subscription.timezone,
        now,
      ),
    })
    .eq('id', subscription.id)
  if (completionError) throw new Error(`channel_run_completion_failed: ${completionError.message}`)
}

const channelSyncDependencies = {
  fetchChannelVideos, fetchVideoMeta, fetchCaptions, fetchTranscriptWithFallback, generateTranscriptSummary, fireEvent,
}

export async function syncChannelSubscription(
  subscription: ChannelSubscription,
  options: { force?: boolean; userId?: string } = {},
  dependencies = channelSyncDependencies,
) {
  subscription = { ...subscription, ...normalizeChannelAutomationSettings(subscription) }
  if (!await claimChannel(subscription.id, options.userId, Boolean(options.force))) {
    return { claimed: false, processed: 0, failed: 0 }
  }

  const plan = joinedPlan(subscription.users)
  const policy = getPlanPolicy(plan)
  if (!policy.channelSync) {
    await completeRun(subscription, 'failed', 0, 0, 'plan_required')
    return { claimed: true, processed: 0, failed: 0 }
  }

  let processed = 0
  let failed = 0
  let lastError = ''

  try {
    const videos = await dependencies.fetchChannelVideos(subscription)

    for (const video of videos) {
      const { data: claimData, error: claimError } = await supabase.rpc('claim_channel_video', {
        p_channel_subscription_id: subscription.id,
        p_video_id: video.videoId,
      })
      if (claimError) throw new Error(`channel_video_claim_failed: ${claimError.message}`)

      const claim = Array.isArray(claimData) ? claimData[0] : claimData
      if (!claim?.processed_video_id || !claim?.claim_token) continue

      let usageLogId: string | null = null
      try {
        const quota = await reserveUsage({
          userId: subscription.user_id,
          videoId: video.videoId,
          endpoint: '/api/cron/channel-sync',
        })
        usageLogId = quota.reservation?.id ?? null
        if (!quota.allowed || !usageLogId) {
          throw new Error('quota_exceeded')
        }

        const metaPromise = dependencies.fetchVideoMeta(video.videoId)
        const transcriptPromise: Promise<ChannelTranscript> = subscription.ai_fallback
          ? dependencies.fetchTranscriptWithFallback(video.videoId, plan, {
              beforeAiFallback: async (durationSeconds) => {
                const metering = await recordUsageSpeech({ reservationId: usageLogId!, aiFallbackSeconds: durationSeconds })
                if (!metering.allowed) throw new Error('ai_fallback_hours_exceeded')
              },
            })
          : dependencies.fetchCaptions(video.videoId).then((segments) => ({ segments, captionSource: 'youtube' }))
        const [meta, transcript] = await awaitJobInputs(metaPromise, transcriptPromise)
        const { segments: lines, captionSource, speechProviders, aiFallbackSeconds } = transcript
        const transcriptId = `${subscription.user_id}-${video.videoId}`
        const wordCount = await saveTranscript({
          id: transcriptId,
          userId: subscription.user_id,
          meta,
          lines,
          captionSource,
          speechProviders,
          aiFallbackSeconds,
        })

        let aiSummary: unknown = null
        let summaryError = ''
        if (subscription.auto_summary) {
          try {
            aiSummary = await dependencies.generateTranscriptSummary(meta.title, lines.map((line) => line.text).join(' '))
            const { error: summaryStoreError } = await supabase
              .from('transcripts')
              .update({ ai_summary: aiSummary })
              .eq('id', transcriptId)
              .eq('user_id', subscription.user_id)
            if (summaryStoreError) throw new Error(`summary_store_failed: ${summaryStoreError.message}`)
          } catch (error) {
            summaryError = error instanceof Error ? error.message : 'summary_failed'
          }
        }

        const metering = await recordUsageSpeech({
          reservationId: usageLogId,
          captionSeconds: aiFallbackSeconds ? 0 : transcriptDurationSeconds(lines),
          aiFallbackSeconds,
          speechProviders,
        })
        if (!metering.allowed) throw new Error(`${metering.route}_hours_exceeded`)
        const { error: completionError } = await supabase.rpc('complete_channel_video', {
          p_processed_video_id: claim.processed_video_id,
          p_claim_token: claim.claim_token,
          p_usage_log_id: usageLogId,
        })
        if (completionError) throw new Error(`channel_video_completion_failed: ${completionError.message}`)
        usageLogId = null
        processed += 1

        await dependencies.fireEvent(subscription.user_id, 'transcript.completed', {
          event: 'transcript.completed',
          transcript: {
            id: transcriptId,
            video: meta,
            lines,
            wordCount,
            captionSource,
            aiSummary,
            summaryError: summaryError || undefined,
          },
          source: {
            channel_id: subscription.channel_id,
            channel_name: subscription.channel_name,
            video_id: video.videoId,
          },
        }).catch((error) => console.error('[webhook] transcript.completed:', error))
      } catch (error) {
        failed += 1
        lastError = error instanceof Error ? error.message : 'channel_sync_failed'
        try {
          const { error: cleanupError } = await supabase.rpc('fail_channel_video', {
            p_processed_video_id: claim.processed_video_id,
            p_claim_token: claim.claim_token,
            p_usage_log_id: usageLogId,
            p_error: lastError.slice(0, 500),
          })
          if (cleanupError) throw new Error(cleanupError.message, { cause: error })
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `channel_video_failure_cleanup_failed: ${cleanupError instanceof Error ? cleanupError.message : 'failed'}`, { cause: cleanupError })
        }
        usageLogId = null
        console.error(`Channel video sync failed for ${video.videoId}:`, error)
        if (lastError === 'quota_exceeded') break
      }
    }

    const status = failed ? (processed ? 'partial' : 'failed') : 'success'
    await completeRun(subscription, status, processed, failed, lastError)
    return { claimed: true, processed, failed }
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'channel_sync_failed'
    try {
      await completeRun(subscription, 'failed', processed, Math.max(1, failed), lastError)
    } catch (runError) {
      throw new AggregateError([error, runError], `channel_run_failure_persistence_failed: ${runError instanceof Error ? runError.message : 'failed'}`, { cause: runError })
    }
    throw error
  }
}

export async function syncChannelSubscriptionById(subscriptionId: string, userId: string) {
  requireSupabaseConfig()
  const { data, error } = await supabase
    .from('channel_subscriptions')
    .select(channelSelect)
    .eq('id', subscriptionId)
    .eq('user_id', userId)
    .eq('active', true)
    .single<ChannelSubscription>()
  if (error || !data) throw new Error('channel_not_found')
  return syncChannelSubscription(data, { force: true, userId })
}

export async function syncAllChannels() {
  requireSupabaseConfig()

  const { data: subscriptions, error } = await supabase
    .from('channel_subscriptions')
    .select(channelSelect)
    .eq('active', true)
    .eq('paused', false)
    .lte('next_run_at', new Date().toISOString())
    .returns<ChannelSubscription[]>()

  if (error) throw new Error(`channel_subscriptions_failed: ${error.message}`)

  for (const subscription of subscriptions ?? []) {
    await syncChannelSubscription(subscription)
      .catch((syncError) => console.error(`Channel sync failed for ${subscription.channel_id}:`, syncError))
  }
}
