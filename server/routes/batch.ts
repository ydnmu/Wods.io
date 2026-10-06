import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { fireEvent } from '../lib/webhooks'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { queueBatchJob } from '../lib/batchJobs'
import { awaitJobInputs } from '../lib/jobInputs'
import { saveTranscript } from '../lib/transcriptStore'
import { recordUsageSpeech, reserveUsage, transcriptDurationSeconds, type UsageReservation } from '../lib/usage'
import { recordPublicTranscriptMetric } from '../lib/publicMetrics'
import { extractVideoId, fetchTranscriptWithFallback, fetchVideoMeta } from '../lib/youtube'
import { requireApiKey, requirePlan } from '../middleware/auth'

export const batchRouter = Router()

async function updateJobCounts(batchJobId: string, userId: string, fireCompletedEvent = fireEvent) {
  const { data: items, error: itemsError } = await supabase.from('batch_items').select('status').eq('batch_job_id', batchJobId)
  if (itemsError || !items) throw new Error(`batch_counts_read_failed: ${itemsError?.message || 'missing_items'}`)
  const completed = items?.filter((item) => item.status === 'completed').length ?? 0
  const failed = items?.filter((item) => item.status === 'failed').length ?? 0
  const total = items?.length ?? 0

  const finished = total > 0 && completed + failed >= total
  const { data: completedJob, error: countsError } = await supabase
    .from('batch_jobs')
    .update({
      completed,
      failed,
      status: finished ? 'completed' : 'processing',
      completed_at: finished ? new Date().toISOString() : null,
      completion_notified: finished ? true : false,
    })
    .eq('id', batchJobId)
    .eq('completion_notified', false)
    .select('id')
    .maybeSingle()
  if (countsError) throw new Error(`batch_counts_update_failed: ${countsError.message}`)

  if (finished && completedJob) {
    await fireCompletedEvent(userId, 'batch.completed', { event: 'batch.completed', batch_id: batchJobId })
      .catch((error) => console.error('[webhook] batch.completed:', error))
  }
}

const batchWorkerDependencies = { fetchVideoMeta, fetchTranscriptWithFallback, recordPublicTranscriptMetric, fireEvent }

export async function processPendingBatchItems(
  maxItems = Number(process.env.BATCH_WORKER_ITEMS || 18),
  dependencies = batchWorkerDependencies,
) {
  const requestedItems = Number.isFinite(maxItems) ? maxItems : 18
  const requestedConcurrency = Number(process.env.BATCH_WORKER_CONCURRENCY || 6)
  const itemLimit = Math.min(Math.max(requestedItems, 1), 60)
  const concurrency = Math.min(
    Math.max(Number.isFinite(requestedConcurrency) ? requestedConcurrency : 6, 1),
    itemLimit,
    12,
  )
  let processed = 0
  let slotsTaken = 0

  // A process restart can leave an item leased as "processing" even though no
  // worker owns it anymore. Release only leases older than the maximum speech
  // provider window so the next worker pass can safely retry them.
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: staleItems, error: staleError } = await supabase
    .from('batch_items')
    .select('id, url, attempts, batch_job_id, batch_jobs(user_id)')
    .eq('status', 'processing')
    .lt('updated_at', staleBefore)
    .limit(100)
  if (staleError) throw new Error(`batch_stale_read_failed: ${staleError.message}`)

  const affectedJobs = new Map<string, string>()
  for (const item of staleItems ?? []) {
    const joinedJob = Array.isArray(item.batch_jobs) ? item.batch_jobs[0] : item.batch_jobs
    const userId = String(joinedJob?.user_id || '')
    const videoId = extractVideoId(String(item.url || '')) || ''
    if (userId && videoId) {
      const { error: usageError } = await supabase
        .from('usage_logs')
        .update({ status: 'error' })
        .eq('user_id', userId)
        .eq('video_id', videoId)
        .eq('endpoint', '/v1/transcripts/batch')
        .eq('status', 'reserved')
        .lt('created_at', staleBefore)
      if (usageError) throw new Error(`batch_stale_usage_cleanup_failed: ${usageError.message}`)
    }

    const attempts = Number(item.attempts || 0)
    const { data: recoveredItems, error: recoveryError } = await supabase
      .from('batch_items')
      .update({
        status: attempts >= 3 ? 'failed' : 'pending',
        claim_token: null,
        error: attempts >= 3 ? 'worker_timeout_after_3_attempts' : 'worker_restarted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'processing')
      .lt('updated_at', staleBefore)
      .select('id')
    if (recoveryError) throw new Error(`batch_stale_recovery_failed: ${recoveryError.message}`)

    if (userId && recoveredItems?.length) affectedJobs.set(String(item.batch_job_id), userId)
  }
  await Promise.all([...affectedJobs].map(([jobId, userId]) => updateJobCounts(jobId, userId, dependencies.fireEvent)))

  const worker = async () => {
    while (slotsTaken < itemLimit) {
      slotsTaken += 1
      const { data: claimData, error: claimError } = await supabase.rpc('claim_next_batch_item')
      if (claimError) throw new Error(`batch_claim_failed: ${claimError.message}`)
      const claim = Array.isArray(claimData) ? claimData[0] : claimData
      if (!claim?.item_id) return

      let reservation: UsageReservation | null = null
      try {
        const startedAt = Date.now()
        const videoId = extractVideoId(claim.item_url)
        if (!videoId) throw new Error('invalid_url')
        const quota = await reserveUsage({ userId: claim.user_id, videoId, endpoint: '/v1/transcripts/batch' })
        reservation = quota.reservation
        if (!quota.allowed || !reservation) throw new Error('quota_exceeded')

        const [meta, transcript] = await awaitJobInputs(
          dependencies.fetchVideoMeta(videoId),
          dependencies.fetchTranscriptWithFallback(videoId, claim.user_plan, {
            beforeAiFallback: async (durationSeconds) => {
              const metering = await recordUsageSpeech({ reservationId: reservation!.id, aiFallbackSeconds: durationSeconds })
              if (!metering.allowed) throw new Error('ai_fallback_hours_exceeded')
            },
          }),
        )
        const { segments: lines, captionSource, speechProviders, aiFallbackSeconds } = transcript
        const transcriptId = `${claim.user_id}-${videoId}`
        const wordCount = await saveTranscript({
          id: transcriptId,
          userId: claim.user_id,
          meta,
          lines,
          captionSource,
          speechProviders,
          aiFallbackSeconds,
        })
        const metering = await recordUsageSpeech({
          reservationId: reservation.id,
          captionSeconds: aiFallbackSeconds ? 0 : transcriptDurationSeconds(lines),
          aiFallbackSeconds,
          speechProviders,
        })
        if (!metering.allowed) throw new Error(`${metering.route}_hours_exceeded`)
        const { error: completeError } = await supabase.rpc('complete_batch_item', {
          p_item_id: claim.item_id,
          p_worker_token: claim.worker_token,
          p_transcript_id: transcriptId,
          p_usage_log_id: reservation.id,
        })
        if (completeError) throw new Error(`batch_completion_failed: ${completeError.message}`)
        reservation = null
        await dependencies.recordPublicTranscriptMetric(Date.now() - startedAt, randomUUID())
          .catch((error) => console.error('[public-metrics] batch completion:', error))

        await dependencies.fireEvent(claim.user_id, 'transcript.completed', {
          event: 'transcript.completed',
          transcript: { id: transcriptId, video: meta, lines, wordCount, captionSource },
        }).catch((error) => console.error('[webhook] transcript.completed:', error))
      } catch (error) {
        const failedVideoId = extractVideoId(claim.item_url) || ''
        try {
          const { error: cleanupError } = await supabase.rpc('fail_batch_item', {
            p_item_id: claim.item_id,
            p_worker_token: claim.worker_token,
            p_usage_log_id: reservation?.id ?? null,
            p_error: error instanceof Error ? error.message : 'failed',
          })
          if (cleanupError) throw new Error(cleanupError.message, { cause: error })
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `batch_failure_cleanup_failed: ${cleanupError instanceof Error ? cleanupError.message : 'failed'}`, { cause: cleanupError })
        }
        if (!reservation && error instanceof Error && !['quota_exceeded', 'invalid_url'].includes(error.message)) {
          const { error: usageError } = await supabase.from('usage_logs').insert({
            user_id: claim.user_id, video_id: failedVideoId, endpoint: '/v1/transcripts/batch', status: 'error',
          })
          if (usageError) throw new Error(`batch_failure_usage_log_failed: ${usageError.message}`, { cause: error })
        }
        reservation = null
      }
      await updateJobCounts(claim.job_id, claim.user_id, dependencies.fireEvent)
      processed += 1
    }
  }

  // Keep the scheduler's running guard until every worker has released its
  // slot, even when one worker cannot persist failure cleanup.
  const workers = await Promise.allSettled(Array.from({ length: concurrency }, worker))
  const failures = workers.filter((result) => result.status === 'rejected').map((result) => result.reason)
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'batch_workers_failed')
  return processed
}

batchRouter.post('/', requireApiKey, requirePlan('business', 'custom'), async (request, response) => {
  requireSupabaseConfig()
  const result = await queueBatchJob(request.userId || '', request.userPlan, request.body?.urls)
  if ('error' in result) {
    response.status(result.error === 'db_error' ? 500 : 400).json(result)
    return
  }

  response.json({
    batch_id: result.job.id,
    status: 'queued',
    total: result.job.total,
    duplicates_removed: result.duplicatesRemoved,
    poll_url: `/v1/transcripts/batch/${result.job.id}`,
  })
})

batchRouter.get('/:id', requireApiKey, async (request, response) => {
  requireSupabaseConfig()
  const { data: job } = await supabase
    .from('batch_jobs')
    .select('id, total, completed, failed, status, created_at, completed_at')
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .single()

  if (!job) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  response.json(job)
})

batchRouter.get('/:id/results', requireApiKey, async (request, response) => {
  requireSupabaseConfig()
  const { data: job } = await supabase
    .from('batch_jobs')
    .select('id')
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .single()

  if (!job) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  const { data } = await supabase
    .from('batch_items')
    .select('id, url, status, transcript_id, error')
    .eq('batch_job_id', request.params.id)
    .order('created_at', { ascending: true })

  response.json(data ?? [])
})
