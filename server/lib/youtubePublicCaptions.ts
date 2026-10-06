import type { TranscriptSegment } from './youtube'

type PublicTranscriptPayload = {
  videoId?: unknown
  transcript?: unknown
  available?: unknown
}

type PublicTranscriptItem = {
  text?: unknown
  start?: unknown
  duration?: unknown
}

const cache = new Map<string, { expiresAt: number; segments: TranscriptSegment[] }>()
const PUBLIC_TRANSCRIPT_ORIGIN = 'https://2outube.com'

export class YoutubePublicCaptionProviderError extends Error {
  code: 'no_captions' | 'provider_unavailable'

  constructor(code: 'no_captions' | 'provider_unavailable') {
    super(code)
    this.name = 'YoutubePublicCaptionProviderError'
    this.code = code
  }
}

export const isPublicCaptionMissingError = (error: unknown) =>
  error instanceof YoutubePublicCaptionProviderError && error.code === 'no_captions'

export async function fetchPublicYoutubeCaptions(
  videoId: string,
  requestFetch: typeof fetch = fetch,
): Promise<TranscriptSegment[]> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new YoutubePublicCaptionProviderError('no_captions')

  const useCache = requestFetch === fetch
  const cached = cache.get(videoId)
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.segments

  let response: Response
  try {
    response = await requestFetch(`${PUBLIC_TRANSCRIPT_ORIGIN}/api/transcript?v=${encodeURIComponent(videoId)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new YoutubePublicCaptionProviderError('provider_unavailable')
  }

  if (response.status === 404 || response.status === 422) {
    throw new YoutubePublicCaptionProviderError('no_captions')
  }
  if (!response.ok) throw new YoutubePublicCaptionProviderError('provider_unavailable')

  const payload = await response.json().catch(() => null) as PublicTranscriptPayload | null
  if (!payload || payload.videoId !== videoId || !Array.isArray(payload.transcript)) {
    throw new YoutubePublicCaptionProviderError('provider_unavailable')
  }
  if (payload.available === false) throw new YoutubePublicCaptionProviderError('no_captions')

  const segments = payload.transcript
    .slice(0, 50_000)
    .map((item: PublicTranscriptItem) => ({
      text: typeof item?.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '',
      start: Number(item?.start),
      duration: Number(item?.duration),
    }))
    .filter((item: TranscriptSegment) =>
      Boolean(item.text) &&
      Number.isFinite(item.start) && item.start >= 0 &&
      Number.isFinite(item.duration) && item.duration >= 0,
    )

  if (!segments.length) throw new YoutubePublicCaptionProviderError('no_captions')

  if (useCache) {
    cache.set(videoId, { expiresAt: Date.now() + 12 * 60 * 60_000, segments })
    if (cache.size > 1_000) cache.delete(cache.keys().next().value!)
  }
  return segments
}
