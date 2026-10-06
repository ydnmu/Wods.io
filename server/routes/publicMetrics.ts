import { Router } from 'express'
import { getPublicTranscriptMetrics, recordPublicTranscriptMetric } from '../lib/publicMetrics'

export const publicMetricsRouter = Router()

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

publicMetricsRouter.get('/', async (_request, response) => {
  try {
    response.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45')
    response.json(await getPublicTranscriptMetrics())
  } catch (error) {
    console.error('[public-metrics] read failed:', error)
    response.setHeader('Cache-Control', 'no-store')
    response.status(503).json({ error: 'metric_unavailable' })
  }
})

publicMetricsRouter.post('/completion', async (request, response) => {
  const completionId = String(request.body?.completionId || '').trim()
  const responseMs = Number(request.body?.responseMs)

  if (!uuidPattern.test(completionId) || !Number.isFinite(responseMs) || responseMs <= 0) {
    response.status(400).json({ error: 'invalid_metric' })
    return
  }

  try {
    response.json(await recordPublicTranscriptMetric(responseMs, completionId))
  } catch (error) {
    console.error('[public-metrics] write failed:', error)
    response.status(503).json({ error: 'metric_unavailable' })
  }
})
