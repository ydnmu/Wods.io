import type { TranscriptResponse, TranscriptSegment } from './types'

type PublicYoutubePayload = {
  videoId?: unknown
  transcript?: unknown
  available?: unknown
}

type PublicYoutubeItem = {
  text?: unknown
  start?: unknown
  duration?: unknown
}

type YoutubeOembed = {
  title?: unknown
  thumbnail_url?: unknown
}

export class ClientYoutubeError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClientYoutubeError'
    this.code = code
  }
}

const extractYoutubeId = (value: string) => {
  const trimmed = value.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    if (url.hostname === 'youtu.be' || url.hostname.endsWith('.youtu.be')) {
      return url.pathname.split('/').filter(Boolean)[0] || null
    }
    if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
      if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
        return url.pathname.split('/').filter(Boolean)[1] || null
      }
      return url.searchParams.get('v')
    }
  } catch {
    return null
  }
  return null
}

export function isYoutubeUrl(value: string) {
  return Boolean(extractYoutubeId(value))
}

const normalizeSegments = (items: unknown): TranscriptSegment[] => {
  if (!Array.isArray(items)) return []
  return items
    .slice(0, 50_000)
    .map((item: PublicYoutubeItem) => ({
      text: typeof item?.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '',
      start: Number(item?.start),
      duration: Number(item?.duration),
    }))
    .filter((item) =>
      Boolean(item.text) &&
      Number.isFinite(item.start) && item.start >= 0 &&
      Number.isFinite(item.duration) && item.duration >= 0,
    )
}

export async function fetchYoutubeTranscriptFromClient(url: string): Promise<TranscriptResponse> {
  const videoId = extractYoutubeId(url)
  if (!videoId) throw new ClientYoutubeError('invalid_youtube_url', 'A valid YouTube URL is required.')

  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
  const metadataPromise = fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`,
    { credentials: 'omit', referrerPolicy: 'no-referrer' },
  ).then((response) => response.ok ? response.json() as Promise<YoutubeOembed> : null).catch(() => null)

  let response: Response
  try {
    response = await fetch(`https://2outube.com/api/transcript?v=${encodeURIComponent(videoId)}`, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new ClientYoutubeError('caption_provider_unavailable', 'Caption access is temporarily unavailable.')
  }

  if (response.status === 404 || response.status === 422) {
    throw new ClientYoutubeError('no_captions', 'This video does not expose usable captions.')
  }
  if (!response.ok) {
    throw new ClientYoutubeError('caption_provider_unavailable', 'Caption access is temporarily unavailable.')
  }

  const payload = await response.json().catch(() => null) as PublicYoutubePayload | null
  if (!payload || payload.videoId !== videoId) {
    throw new ClientYoutubeError('caption_provider_unavailable', 'The caption service returned an invalid response.')
  }
  if (payload.available === false) {
    throw new ClientYoutubeError('no_captions', 'This video does not expose usable captions.')
  }

  const segments = normalizeSegments(payload.transcript)
  if (!segments.length) {
    throw new ClientYoutubeError('no_captions', 'This video does not expose usable captions.')
  }

  const metadata = await metadataPromise
  return {
    title: typeof metadata?.title === 'string' ? metadata.title : `Video ${videoId}`,
    videoId,
    sourceUrl,
    thumbnail: typeof metadata?.thumbnail_url === 'string'
      ? metadata.thumbnail_url
      : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    segments,
    plainText: segments.map((segment) => segment.text).join(' '),
    captionSource: 'youtube',
  }
}
