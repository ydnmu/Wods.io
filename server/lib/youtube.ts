import { fetchTranscript } from 'youtube-transcript'
import { fetchYtSnipAudio } from './ytsnipAudio'
import { hasSpeechToTextProvider, transcribeAudio } from './speechToText'
import { fetchPublicYoutubeCaptions, isPublicCaptionMissingError } from './youtubePublicCaptions'

export type TranscriptItem = {
  text: string
  duration: number
  offset: number
}

export type TranscriptSegment = {
  text: string
  start: number
  duration: number
}

export type VideoMeta = {
  id: string
  videoId: string
  title: string
  channel: string
  duration: string
  url: string
  thumbnail: string
  language: string
}

export type BrowserYoutubePreparation = {
  videoId: string
  sourceUrl: string
  captionUrl: string
  language: string
  title: string
  channel: string
  thumbnail: string
}

type JsonRecord = Record<string, unknown>

const YOUTUBE_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const YOUTUBE_ANDROID_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
  },
}

export class YoutubeCaptionAccessRestrictedError extends Error {
  constructor() {
    super('youtube_caption_access_restricted')
    this.name = 'YoutubeCaptionAccessRestrictedError'
  }
}

export const isYoutubeCaptionAccessRestrictedError = (error: unknown) =>
  error instanceof YoutubeCaptionAccessRestrictedError

const browserPreparationCache = new Map<string, {
  expiresAt: number
  value: BrowserYoutubePreparation
}>()

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}

const getString = (value: unknown, fallback = '') =>
  typeof value === 'string' && value ? value : fallback

const decodeCaptionText = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))

const normalizeCaptionText = (value: string) =>
  decodeCaptionText(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

export function parseYoutubeCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []

  for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const start = match[1].match(/\bt="(\d+)"/)
    const duration = match[1].match(/\bd="(\d+)"/)
    if (!start) continue
    const words = [...match[2].matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)]
    const text = normalizeCaptionText(words.length ? words.map((word) => word[1]).join('') : match[2])
    if (text) {
      segments.push({
        text,
        start: Number(start[1]) / 1000,
        duration: Number(duration?.[1] || 0) / 1000,
      })
    }
  }

  if (segments.length) return segments

  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = match[1].match(/\bstart="([^"]+)"/)
    const duration = match[1].match(/\bdur="([^"]+)"/)
    if (!start) continue
    const text = normalizeCaptionText(match[2])
    if (text) {
      segments.push({
        text,
        start: Number(start[1]),
        duration: Number(duration?.[1] || 0),
      })
    }
  }

  return segments
}

const serverAccessChecks = new Map<string, { expiresAt: number; restricted: boolean }>()

async function isYoutubeCaptionAccessRestricted(videoId: string) {
  const cached = serverAccessChecks.get(videoId)
  if (cached && cached.expiresAt > Date.now()) return cached.restricted

  let restricted = false
  try {
    const response = await fetch(YOUTUBE_PLAYER_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({ context: YOUTUBE_ANDROID_CONTEXT, videoId }),
      signal: AbortSignal.timeout(8_000),
    })
    const payload = asRecord(await response.json().catch(() => null))
    const status = getString(asRecord(payload.playabilityStatus).status)
    const reason = getString(asRecord(payload.playabilityStatus).reason).toLowerCase()
    restricted = status === 'LOGIN_REQUIRED' || /confirm.*not.*bot|sign in/.test(reason)
  } catch {
    // Keep the original caption error when this diagnostic request cannot run.
  }

  serverAccessChecks.set(videoId, { expiresAt: Date.now() + 2 * 60_000, restricted })
  if (serverAccessChecks.size > 500) serverAccessChecks.delete(serverAccessChecks.keys().next().value!)
  return restricted
}

const getBrowserPreparationMeta = (payload: unknown, videoId: string) => {
  const root = asRecord(payload)
  const details = asRecord(root.videoDetails)
  const thumbnail = asRecord(details.thumbnail)
  const thumbnails = Array.isArray(thumbnail.thumbnails) ? thumbnail.thumbnails.map(asRecord) : []
  const largestThumbnail = thumbnails.at(-1)

  return {
    title: getString(details.title, `Video ${videoId}`),
    channel: getString(details.author, 'Unknown Channel'),
    thumbnail: getString(largestThumbnail?.url, `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`),
  }
}

const validateCaptionUrl = (value: string) => {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'youtube.com' && !url.hostname.endsWith('.youtube.com')) ||
    url.pathname !== '/api/timedtext'
  ) {
    throw new Error('invalid_caption_url')
  }
  return url
}

export const extractVideoId = (value: string) => {
  const trimmedValue = value.trim()

  try {
    const parsedUrl = new URL(trimmedValue)
    if (parsedUrl.hostname.includes('youtu.be')) {
      return parsedUrl.pathname.split('/').filter(Boolean)[0]
    }

    if (parsedUrl.hostname.includes('youtube.com')) {
      if (parsedUrl.pathname.startsWith('/shorts/')) {
        return parsedUrl.pathname.split('/').filter(Boolean)[1]
      }

      return parsedUrl.searchParams.get('v')
    }
  } catch {
    if (/^[\w-]{11}$/.test(trimmedValue)) {
      return trimmedValue
    }
  }

  return null
}

export async function prepareBrowserYoutubeTranscript(
  videoId: string,
  requestFetch: typeof fetch = fetch,
): Promise<BrowserYoutubePreparation> {
  const useCache = requestFetch === fetch
  const cached = browserPreparationCache.get(videoId)
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.value

  let captionUrl = ''
  let playerPayload: unknown = null

  await fetchTranscript(videoId, {
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/timedtext') {
        captionUrl = validateCaptionUrl(url.toString()).toString()
        return new Response('<transcript></transcript>', {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        })
      }

      const response = await requestFetch(input, init)
      if (url.pathname === '/youtubei/v1/player' && response.ok) {
        playerPayload = await response.clone().json().catch(() => null)
      }
      return response
    },
  })

  if (!captionUrl) throw new Error('no_captions')

  const caption = validateCaptionUrl(captionUrl)
  caption.searchParams.set('fmt', 'srv3')
  const meta = getBrowserPreparationMeta(playerPayload, videoId)
  const value: BrowserYoutubePreparation = {
    videoId,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    captionUrl: caption.toString(),
    language: caption.searchParams.get('lang') || 'en',
    ...meta,
  }

  if (useCache) {
    browserPreparationCache.set(videoId, { expiresAt: Date.now() + 5 * 60_000, value })
    if (browserPreparationCache.size > 500) {
      const oldestKey = browserPreparationCache.keys().next().value
      if (oldestKey) browserPreparationCache.delete(oldestKey)
    }
  }

  return value
}

export const fetchCaptions = async (videoId: string) => {
  try {
    const transcript = (await fetchTranscript(videoId)) as TranscriptItem[]
    return transcript.map((item) => ({
      text: item.text.replace(/\s+/g, ' ').trim(),
      start: item.offset / 1000,
      duration: item.duration / 1000,
    }))
  } catch (directError) {
    try {
      return await fetchPublicYoutubeCaptions(videoId)
    } catch (providerError) {
      if (isPublicCaptionMissingError(providerError)) throw providerError
      if (await isYoutubeCaptionAccessRestricted(videoId)) throw new YoutubeCaptionAccessRestrictedError()
      throw directError
    }
  }
}

export const fetchTranscriptWithFallback = async (
  videoId: string,
  plan?: string | null,
  options: {
    allowAiFallback?: boolean
    forceAiFallback?: boolean
    beforeAiFallback?: (durationSeconds: number) => Promise<void>
  } = {},
) => {
  if (!options.forceAiFallback) {
    try {
      return { segments: await fetchCaptions(videoId), captionSource: 'youtube' as const }
    } catch (error) {
      if (isYoutubeCaptionAccessRestrictedError(error)) throw error
      // Continue into the explicitly authorized audio fallback below.
    }
  }

  if (options.allowAiFallback === false) throw new Error('ai_fallback_confirmation_required')
  if (!hasSpeechToTextProvider(plan)) throw new Error('speech_to_text_not_configured')
  const source = await fetchYtSnipAudio(videoId)
  try {
    await options.beforeAiFallback?.(source.durationSeconds)
    const { segments, provider, providers, audioSeconds } = await transcribeAudio({
      audioPath: source.audioPath,
      mimeType: source.mimeType,
      videoId,
      plan,
      durationSeconds: source.durationSeconds,
    })
    return {
      segments,
      captionSource: 'speech_to_text' as const,
      speechProvider: provider,
      speechProviders: providers,
      aiFallbackSeconds: audioSeconds,
    }
  } finally {
    await source.cleanup().catch(() => undefined)
  }
}

export const fetchVideoMeta = async (videoId: string): Promise<VideoMeta> => {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const fallback = {
    id: videoId,
    videoId,
    title: `Video ${videoId}`,
    channel: 'Unknown Channel',
    duration: '0:00',
    url,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    language: 'en',
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(6000) },
    )

    if (!response.ok) return fallback
    const payload = await response.json()

    return {
      ...fallback,
      title: payload.title || fallback.title,
      channel: payload.author_name || fallback.channel,
      thumbnail: payload.thumbnail_url || fallback.thumbnail,
    }
  } catch {
    return fallback
  }
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

export const toSubtitleTime = (seconds: number, separator: ',' | '.') => {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}${separator}000`
}

export const toPlainTimestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const remainingSeconds = total % 60
  return `${minutes}:${pad(remainingSeconds)}`
}

export const toTxt = (segments: TranscriptSegment[]) =>
  segments.map((segment) => `[${toPlainTimestamp(segment.start)}] ${segment.text}`).join('\n')

export const toSrt = (segments: TranscriptSegment[]) =>
  segments
    .map((segment, index) => {
      const start = toSubtitleTime(segment.start, ',')
      const end = toSubtitleTime(segment.start + Math.max(segment.duration, 3), ',')
      return `${index + 1}\n${start} --> ${end}\n${segment.text}`
    })
    .join('\n\n')

export const toVtt = (segments: TranscriptSegment[]) =>
  `WEBVTT\n\n${segments
    .map((segment, index) => {
      const start = toSubtitleTime(segment.start, '.')
      const end = toSubtitleTime(segment.start + Math.max(segment.duration, 3), '.')
      return `${index + 1}\n${start} --> ${end}\n${segment.text}`
    })
    .join('\n\n')}`
