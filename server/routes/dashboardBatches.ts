import { Router } from 'express'
import { queueBatchJob } from '../lib/batchJobs'
import { getPlanPolicy } from '../lib/plans'
import { requireSupabaseConfig, supabase } from '../lib/supabase'

export const dashboardBatchesRouter = Router()

dashboardBatchesRouter.get('/', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).batch) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }
  const { data } = await supabase
    .from('batch_jobs')
    .select('id, total, completed, failed, status, created_at, completed_at')
    .eq('user_id', request.userId)
    .order('created_at', { ascending: false })
    .limit(20)
  response.json(data ?? [])
})

dashboardBatchesRouter.post('/', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).batch) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }
  const result = await queueBatchJob(request.userId || '', request.userPlan, request.body?.urls)
  if ('error' in result) {
    response.status(result.error === 'db_error' ? 500 : 400).json(result)
    return
  }
  response.json({ batch_id: result.job.id, status: 'queued', total: result.job.total, duplicates_removed: result.duplicatesRemoved })
})

dashboardBatchesRouter.get('/:id', async (request, response) => {
  requireSupabaseConfig()
  const { data } = await supabase
    .from('batch_jobs')
    .select('id, total, completed, failed, status, created_at, completed_at')
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .single()
  if (!data) {
    response.status(404).json({ error: 'not_found' })
    return
  }
  response.json(data)
})

dashboardBatchesRouter.get('/:id/results', async (request, response) => {
  requireSupabaseConfig()
  const { data: job } = await supabase.from('batch_jobs').select('id').eq('id', request.params.id).eq('user_id', request.userId).single()
  if (!job) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  const requestedLimit = Number(request.query.limit || 100)
  const requestedOffset = Number(request.query.offset || 0)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 1), 100)
  const offset = Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0)
  const { data, count, error } = await supabase
    .from('batch_items')
    .select('id, url, status, transcript_id, error', { count: 'exact' })
    .eq('batch_job_id', request.params.id)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    response.status(500).json({ error: 'batch_results_unavailable' })
    return
  }

  const transcriptIds = (data ?? [])
    .map((item) => item.transcript_id)
    .filter((id): id is string => Boolean(id))
  const { data: transcripts } = transcriptIds.length
    ? await supabase
      .from('transcripts')
      .select('id, video_id, video_title, video_channel, video_duration, video_thumbnail, word_count, created_at')
      .eq('user_id', request.userId)
      .in('id', transcriptIds)
    : { data: [] }
  const transcriptById = new Map((transcripts ?? []).map((transcript) => [transcript.id, transcript]))

  response.json({
    items: (data ?? []).map((item) => ({
      ...item,
      transcript: item.transcript_id ? transcriptById.get(item.transcript_id) ?? null : null,
    })),
    total: count ?? 0,
    offset,
    limit,
  })
})
