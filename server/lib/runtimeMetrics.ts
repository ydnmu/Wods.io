import type { RequestHandler } from 'express'

type CompletedRequest = {
  at: number
  durationMs: number
  failed: boolean
}

const startedAt = Date.now()
const recent: CompletedRequest[] = []
let activeRequests = 0
let activeTranscriptions = 0
let peakActiveRequests = 0

const isTrackedRequest = (path: string) => {
  const apiRequest = path.startsWith('/api/') || path.startsWith('/v1/')
  const controlPlaneRequest = path.startsWith('/api/admin/')
    || ['/api/health', '/api/ready', '/api/system/status'].includes(path)
  return apiRequest && !controlPlaneRequest
}

const isTranscriptRequest = (path: string) => path.startsWith('/api/transcript')
  || path.startsWith('/v1/transcripts')
  || path.startsWith('/api/dashboard/batches')

const prune = (now: number) => {
  const cutoff = now - 5 * 60_000
  let removeCount = 0
  while (removeCount < recent.length && recent[removeCount].at < cutoff) removeCount += 1
  if (removeCount) recent.splice(0, removeCount)
  if (recent.length > 10_000) recent.splice(0, recent.length - 10_000)
}

export const trackRuntimeRequest: RequestHandler = (request, response, next) => {
  const path = request.path
  if (!isTrackedRequest(path)) {
    next()
    return
  }

  const transcriptRequest = isTranscriptRequest(path)
  const requestStartedAt = Date.now()
  let completed = false
  activeRequests += 1
  if (transcriptRequest) activeTranscriptions += 1
  peakActiveRequests = Math.max(peakActiveRequests, activeRequests)

  const finish = () => {
    if (completed) return
    completed = true
    const now = Date.now()
    activeRequests = Math.max(0, activeRequests - 1)
    if (transcriptRequest) activeTranscriptions = Math.max(0, activeTranscriptions - 1)
    recent.push({ at: now, durationMs: now - requestStartedAt, failed: response.statusCode >= 500 })
    prune(now)
  }

  response.once('finish', finish)
  response.once('close', finish)
  next()
}

export function getRuntimeMetrics(now = Date.now()) {
  prune(now)
  const lastMinute = recent.filter((item) => item.at >= now - 60_000)
  const totalDuration = lastMinute.reduce((sum, item) => sum + item.durationMs, 0)
  const memory = process.memoryUsage()
  return {
    activeRequests,
    activeTranscriptions,
    peakActiveRequests,
    requestsPerMinute: lastMinute.length,
    averageResponseMs: lastMinute.length ? Math.round(totalDuration / lastMinute.length) : null,
    errorsPerMinute: lastMinute.filter((item) => item.failed).length,
    uptimeSeconds: Math.floor((now - startedAt) / 1000),
    memoryRssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
  }
}
