import { Router } from 'express'
import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { platformCaptionError } from '../lib/captionErrors'
import { fireEvent } from '../lib/webhooks'
import { requireSupabaseConfig } from '../lib/supabase'
import { saveTranscript } from '../lib/transcriptStore'
import { recordPublicTranscriptMetric } from '../lib/publicMetrics'
import { finalizeUsage, recordUsageSpeech, reserveUsage, transcriptDurationSeconds, type UsageReservation } from '../lib/usage'
import { shouldStoreTranscript } from '../lib/plans'
import {
  extractVideoId,
  fetchTranscriptWithFallback,
  fetchVideoMeta,
  isYoutubeCaptionAccessRestrictedError,
  prepareBrowserYoutubeTranscript,
  toSrt,
  toTxt,
  toVtt,
} from '../lib/youtube'
import { extractVimeoId, fetchVimeoTranscriptWithFallback, fetchVimeoMeta } from '../lib/vimeo'
import { extractTedId, fetchTedTranscriptWithFallback, fetchTedMeta } from '../lib/ted'
import { extractDailymotionId, fetchDailymotionTranscriptWithFallback, fetchDailymotionMeta } from '../lib/dailymotion'
import {
  extractBilibiliId,
  fetchBilibiliTranscriptWithFallback,
  fetchBilibiliMeta,
  resolveBilibiliId,
} from '../lib/bilibili'

type Platform = 'youtube' | 'vimeo' | 'ted' | 'dailymotion' | 'bilibili'

function detectPlatform(url: string): { platform: Platform; videoId: string } | null {
  const vimeoId = extractVimeoId(url)
  if (vimeoId) return { platform: 'vimeo', videoId: vimeoId }

  const tedId = extractTedId(url)
  if (tedId) return { platform: 'ted', videoId: tedId }

  const dailymotionId = extractDailymotionId(url)
  if (dailymotionId) return { platform: 'dailymotion', videoId: dailymotionId }

  const bilibiliId = extractBilibiliId(url)
  if (bilibiliId) return { platform: 'bilibili', videoId: bilibiliId }

  const youtubeId = extractVideoId(url)
  if (youtubeId) return { platform: 'youtube', videoId: youtubeId }

  return null
}

export async function handleTranscriptPrepareRequest(request: Request, response: Response) {
  const url = String(request.body?.url || '').trim()
  const videoId = extractVideoId(url)
  if (!videoId) {
    response.status(400).json({ error: 'invalid_youtube_url', message: 'A valid YouTube URL is required.' })
    return
  }

  try {
    const preparation = await prepareBrowserYoutubeTranscript(videoId)
    response.setHeader('Cache-Control', 'private, no-store')
    response.json(preparation)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'caption_prepare_failed'
    const accessRestricted = isYoutubeCaptionAccessRestrictedError(error)
    const noCaptions = message.includes('no_captions') || message.includes('disabled') || message.includes('transcript')
    response.status(accessRestricted ? 503 : noCaptions ? 422 : 502).json({
      error: accessRestricted ? 'youtube_caption_access_restricted' : noCaptions ? 'no_captions' : 'caption_prepare_failed',
      message: accessRestricted
        ? 'YouTube is temporarily refusing caption access from this service. The video may still have captions; please retry shortly.'
        : noCaptions
        ? 'This video does not expose a usable caption track.'
        : 'YouTube caption preparation failed. Please try again.',
    })
  }
}

export const transcriptRouter = Router()

export async function handleTranscriptRequest(request: Request, response: Response) {
  const url = String(request.body?.url || '')
  const format = String(request.body?.format || 'json')
  const allowAiFallback = request.body?.allowAiFallback !== false
  const forceAiFallback = request.body?.forceAiFallback === true
  let detected = detectPlatform(url)

  if (detected?.platform === 'bilibili' && detected.videoId.startsWith('short:')) {
    const resolvedVideoId = await resolveBilibiliId(url)
    detected = resolvedVideoId ? { platform: 'bilibili', videoId: resolvedVideoId } : null
  }

  if (!detected) {
    response.status(400).json({ error: 'invalid_url', message: 'Supported URL required (YouTube, Vimeo, TED, Dailymotion, Bilibili)' })
    return
  }

  const { platform, videoId } = detected

  const sourceUrls: Record<Platform, string> = {
    youtube: `https://www.youtube.com/watch?v=${videoId}`,
    vimeo: `https://vimeo.com/${videoId}`,
    ted: `https://www.ted.com/talks/${videoId}`,
    dailymotion: `https://www.dailymotion.com/video/${videoId}`,
    bilibili: videoId.startsWith('global:')
      ? `https://www.bilibili.tv/en/video/${videoId.slice(7)}`
      : `https://www.bilibili.com/video/${videoId}`,
  }

  let reservation: UsageReservation | null = null
  try {
    if (request.userId) {
      requireSupabaseConfig()
      const quota = await reserveUsage({
        userId: request.userId,
        videoId,
        endpoint: request.originalUrl || request.path,
      })
      reservation = quota.reservation
      if (!quota.allowed) {
        response.status(429).json({
          error: 'quota_exceeded',
          message: `Monthly limit of ${quota.limit} transcripts reached. Upgrade your plan.`,
        })
        return
      }
    }

    const startedAt = Date.now()

    const fetchForPlatform = () => {
      switch (platform) {
        case 'vimeo':
          return Promise.all([fetchVimeoTranscriptWithFallback(videoId, request.userPlan), fetchVimeoMeta(videoId)])
        case 'ted':
          return Promise.all([fetchTedTranscriptWithFallback(videoId, request.userPlan), fetchTedMeta(videoId)])
        case 'dailymotion':
          return Promise.all([fetchDailymotionTranscriptWithFallback(videoId, request.userPlan), fetchDailymotionMeta(videoId)])
        case 'bilibili':
          return Promise.all([fetchBilibiliTranscriptWithFallback(videoId, request.userPlan), fetchBilibiliMeta(videoId)])
        default:
          return Promise.all([
            fetchTranscriptWithFallback(videoId, request.userPlan, {
              allowAiFallback,
              forceAiFallback,
              beforeAiFallback: reservation ? async (durationSeconds) => {
                const metering = await recordUsageSpeech({ reservationId: reservation!.id, aiFallbackSeconds: durationSeconds })
                if (!metering.allowed) throw new Error('ai_fallback_hours_exceeded')
              } : undefined,
            }),
            fetchVideoMeta(videoId),
          ])
      }
    }

    const [transcript, meta] = await fetchForPlatform()
    const { segments, captionSource } = transcript
    const speechProviders = 'speechProviders' in transcript ? transcript.speechProviders : undefined
    const aiFallbackSeconds = 'aiFallbackSeconds' in transcript ? transcript.aiFallbackSeconds : undefined
    const sourceUrl = sourceUrls[platform]

    const payload = {
      title: meta.title,
      videoId,
      sourceUrl,
      thumbnail: meta.thumbnail,
      segments,
      plainText: segments.map((segment) => segment.text).join(' '),
    }

    if (request.userId) {
      const transcriptId = `${request.userId}-${videoId}`
      const wordCount = payload.plainText.split(/\s+/).filter(Boolean).length
      if (shouldStoreTranscript(request.userPlan)) {
        await saveTranscript({
          id: transcriptId,
          userId: request.userId,
          meta,
          lines: segments,
          captionSource,
          speechProviders,
          aiFallbackSeconds,
        })
      }
      if (!reservation) throw new Error('usage_reservation_missing')
      const metering = await recordUsageSpeech({
        reservationId: reservation.id,
        captionSeconds: aiFallbackSeconds ? 0 : transcriptDurationSeconds(segments),
        aiFallbackSeconds,
        speechProviders,
      })
      if (!metering.allowed) throw new Error(`${metering.route}_hours_exceeded`)
      await finalizeUsage(reservation.id, 'success')
      reservation = null
      await fireEvent(request.userId, 'transcript.completed', {
        event: 'transcript.completed',
        transcript: {
          id: transcriptId,
          video: meta,
          lines: segments,
          wordCount,
          captionSource,
        },
      }).catch((error) => console.error('[webhook] transcript.completed:', error))
    }

    await recordPublicTranscriptMetric(Date.now() - startedAt, randomUUID())
      .catch((error) => console.error('[public-metrics] transcript completion:', error))

    if (format === 'txt') {
      response.type('text/plain; charset=utf-8').send(toTxt(segments))
      return
    }

    if (format === 'srt') {
      response.type('text/plain; charset=utf-8').send(toSrt(segments))
      return
    }

    if (format === 'vtt') {
      response.type('text/vtt; charset=utf-8').send(toVtt(segments))
      return
    }

    response.setHeader('Server-Timing', `transcript;dur=${Date.now() - startedAt}`)
    response.json({ ...payload, captionSource })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Transcript is unavailable for this video'
    const needsConfirmation = errorMessage === 'ai_fallback_confirmation_required'
    const captionAccessRestricted = isYoutubeCaptionAccessRestrictedError(error)
    const notConfigured = errorMessage === 'speech_to_text_not_configured'
    const providerFailed = errorMessage.startsWith('speech_to_text_failed:')
    const hourQuotaExceeded = errorMessage === 'caption_hours_exceeded' || errorMessage === 'ai_fallback_hours_exceeded'
    const bilibiliAuthRequired = errorMessage === 'bilibili_session_required'
    const captionError = platformCaptionError(errorMessage)

    if (notConfigured || providerFailed) {
      console.error(`[transcript] ${videoId}: ${errorMessage}`)
    }

    if (request.userId) {
      if (reservation) await finalizeUsage(reservation.id, 'error').catch(() => undefined)
    }

    response.status(captionError?.status ?? (hourQuotaExceeded ? 429 : notConfigured || captionAccessRestricted ? 503 : 422)).json({
      error: captionError?.error ?? (hourQuotaExceeded
        ? errorMessage
        : captionAccessRestricted
        ? 'youtube_caption_access_restricted'
        : bilibiliAuthRequired
        ? 'bilibili_auth_required'
        : needsConfirmation
        ? 'ai_fallback_confirmation_required'
        : notConfigured
        ? 'audio_transcription_not_configured'
        : providerFailed
          ? 'audio_transcription_failed'
          : 'no_captions'),
      message: captionError?.message ?? (hourQuotaExceeded
        ? errorMessage === 'ai_fallback_hours_exceeded'
          ? 'Monthly AI fallback hours are exhausted. Caption-ready videos can still be processed.'
          : 'Monthly caption hours are exhausted. Additional hours are required.'
        : bilibiliAuthRequired
        ? 'Bilibili captions require a server-side BILIBILI_SESSDATA session. Audio fallback is not available for Bilibili yet.'
        : captionAccessRestricted
        ? 'YouTube is temporarily refusing caption access from this service. The video may still have captions; please retry shortly.'
        : needsConfirmation
        ? 'This video has no usable captions. AI fallback can transcribe the audio after you approve it.'
        : notConfigured
        ? 'This video has no captions, and audio transcription is not configured on this server.'
        : providerFailed
          ? 'This video has no captions, and the audio transcription providers could not process it right now.'
          : 'Caption access failed. Please try again later.'),
      videoId,
      sourceUrl: sourceUrls[platform],
    })
  }
}

transcriptRouter.post('/', handleTranscriptRequest)
