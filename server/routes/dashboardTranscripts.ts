import { Router } from 'express'
import { fireEvent } from '../lib/webhooks'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { saveTranscript } from '../lib/transcriptStore'
import { extractVideoId, fetchTranscriptWithFallback, fetchVideoMeta } from '../lib/youtube'
import { finalizeUsage, recordUsageSpeech, reserveUsage, transcriptDurationSeconds, type UsageReservation } from '../lib/usage'
import { getPlanPolicy } from '../lib/plans'
import {
  buildTranscriptExport,
  buildRichTranscriptExport,
  isTranscriptExportFormat,
  transcriptExportContentType,
} from '../lib/transcriptExport'

export const dashboardTranscriptsRouter = Router()

dashboardTranscriptsRouter.get('/', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).transcriptArchive) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }

  const search = String(request.query.q || '').trim().slice(0, 100)
  let query = supabase
    .from('transcripts')
    .select('id, video_id, video_title, video_channel, video_duration, video_thumbnail, word_count, created_at')
    .eq('user_id', request.userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (search) {
    const escaped = search.replace(/[%_,()]/g, '')
    query = query.or(`video_title.ilike.%${escaped}%,video_channel.ilike.%${escaped}%,video_id.ilike.%${escaped}%`)
  }

  const { data, error } = await query
  if (error) {
    response.status(500).json({ error: 'archive_unavailable' })
    return
  }
  response.json(data ?? [])
})

dashboardTranscriptsRouter.get('/:id/export', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).transcriptArchive) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }

  const format = String(request.query.format || 'txt').toLowerCase()
  if (!isTranscriptExportFormat(format)) {
    response.status(400).json({ error: 'invalid_format', formats: ['json', 'txt', 'srt', 'vtt', 'pdf', 'docx'] })
    return
  }

  const { data } = await supabase
    .from('transcripts')
    .select('id, video_id, video_title, video_channel, video_duration, word_count, caption_source, created_at, lines')
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .single()

  if (!data) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  const body = format === 'pdf' || format === 'docx'
    ? await buildRichTranscriptExport(data, format)
    : buildTranscriptExport(data, format)
  const filename = `${String(data.video_id).replace(/[^a-zA-Z0-9_-]/g, '_')}-transcript.${format}`
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  response.type(transcriptExportContentType(format)).send(typeof body === 'string' ? body : Buffer.from(body))
})

dashboardTranscriptsRouter.get('/:id', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).transcriptArchive) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }

  const { data } = await supabase
    .from('transcripts')
    .select('id, video_id, video_title, video_channel, video_duration, video_thumbnail, word_count, lines, ai_summary, created_at')
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .single()

  if (!data) {
    response.status(404).json({ error: 'not_found' })
    return
  }
  response.json(data)
})

dashboardTranscriptsRouter.post('/', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).transcriptArchive) {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }
  const url = String(request.body?.url || '')
  const videoId = extractVideoId(url)
  if (!videoId || !request.userId) {
    response.status(400).json({ error: 'valid_youtube_url_required' })
    return
  }

  let reservation: UsageReservation | null = null
  try {
    const quota = await reserveUsage({
      userId: request.userId,
      videoId,
      endpoint: '/api/dashboard/transcripts',
    })
    reservation = quota.reservation
    if (!quota.allowed) {
      response.status(429).json({ error: 'quota_exceeded', max: quota.limit })
      return
    }

    const [meta, transcript] = await Promise.all([
      fetchVideoMeta(videoId),
      fetchTranscriptWithFallback(videoId, request.userPlan, {
        beforeAiFallback: async (durationSeconds) => {
          const metering = await recordUsageSpeech({ reservationId: reservation!.id, aiFallbackSeconds: durationSeconds })
          if (!metering.allowed) throw new Error('ai_fallback_hours_exceeded')
        },
      }),
    ])
    const { segments: lines, captionSource, speechProviders, aiFallbackSeconds } = transcript
    const id = `${request.userId}-${videoId}`
    const wordCount = await saveTranscript({
      id,
      userId: request.userId,
      meta,
      lines,
      captionSource,
      speechProviders,
      aiFallbackSeconds,
    })
    if (!reservation) throw new Error('usage_reservation_missing')
    const metering = await recordUsageSpeech({
      reservationId: reservation.id,
      captionSeconds: aiFallbackSeconds ? 0 : transcriptDurationSeconds(lines),
      aiFallbackSeconds,
      speechProviders,
    })
    if (!metering.allowed) throw new Error(`${metering.route}_hours_exceeded`)
    await finalizeUsage(reservation.id, 'success')
    reservation = null
    await fireEvent(request.userId, 'transcript.completed', {
      event: 'transcript.completed',
      transcript: { id, video: meta, lines, wordCount, captionSource },
    }).catch((error) => console.error('[webhook] transcript.completed:', error))
    response.json({ id, video: meta, lines, wordCount, captionSource })
  } catch (error) {
    if (reservation) await finalizeUsage(reservation.id, 'error').catch(() => undefined)
    const message = error instanceof Error ? error.message : 'Transcript is unavailable.'
    const hourQuotaExceeded = message === 'caption_hours_exceeded' || message === 'ai_fallback_hours_exceeded'
    response.status(hourQuotaExceeded ? 429 : 422).json({
      error: hourQuotaExceeded ? message : 'transcript_unavailable',
      message: hourQuotaExceeded
        ? message === 'ai_fallback_hours_exceeded'
          ? 'Monthly AI fallback hours are exhausted.'
          : 'Monthly caption hours are exhausted.'
        : message,
    })
  }
})
