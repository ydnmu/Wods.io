import { Router } from 'express'
import { getPlanPolicy } from '../lib/plans'
import { inspectYouTubeSource } from '../lib/sourceInspector'
import { queueBatchJob } from '../lib/batchJobs'

export const dashboardSourcesRouter = Router()

dashboardSourcesRouter.post('/inspect', async (request, response) => {
  const policy = getPlanPolicy(request.userPlan)
  if (!policy.batch) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }

  const maxVideos = policy.maxBatchUrls < 0 ? 1000 : policy.maxBatchUrls
  try {
    const inspection = await inspectYouTubeSource(
      String(request.body?.source || ''),
      maxVideos,
      { analyzeCaptions: true },
    )
    response.json(inspection)
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'source_inspection_failed',
      message: 'The YouTube source could not be inspected.',
    })
  }
})

dashboardSourcesRouter.post('/queue', async (request, response) => {
  const policy = getPlanPolicy(request.userPlan)
  if (!policy.batch) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }

  const maxVideos = policy.maxBatchUrls < 0 ? 1000 : policy.maxBatchUrls
  try {
    const inspection = await inspectYouTubeSource(String(request.body?.source || ''), maxVideos)
    const result = await queueBatchJob(request.userId || '', request.userPlan, inspection.urls)
    if ('error' in result) {
      response.status(result.error === 'db_error' ? 500 : 400).json(result)
      return
    }
    response.json({
      inspection,
      batch_id: result.job.id,
      status: 'queued',
      total: result.job.total,
      duplicates_removed: result.duplicatesRemoved,
    })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'source_queue_failed',
      message: 'The YouTube source could not be queued.',
    })
  }
})
