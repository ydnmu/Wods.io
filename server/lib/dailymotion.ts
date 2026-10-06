import type { TranscriptSegment } from './youtube'
import { parseCaptionTrack } from './captionTracks'

export const extractDailymotionId = (value: string): string | null => {
  const trimmed = value.trim()

  try {
    const url = new URL(trimmed)
    if (!url.hostname.includes('dailymotion.com') && !url.hostname.includes('dai.ly')) return null

    if (url.hostname.includes('dai.ly')) {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id && /^[a-z0-9]+$/i.test(id) ? id : null
    }

    const match = url.pathname.match(/\/video\/([a-z0-9]+)/i)
    if (match) return match[1]

    const embedMatch = url.pathname.match(/\/embed\/video\/([a-z0-9]+)/i)
    if (embedMatch) return embedMatch[1]

    return null
  } catch {
    if (/^[a-z0-9]{6,}$/i.test(trimmed)) return trimmed
    return null
  }
}

export const fetchDailymotionCaptions = async (videoId: string): Promise<TranscriptSegment[]> => {
  const metaResponse = await fetch(
    `https://www.dailymotion.com/player/metadata/video/${videoId}`,
    {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    },
  )

  if (metaResponse.status === 404) throw new Error('source_unavailable')
  if (!metaResponse.ok) throw new Error('dailymotion_provider_unavailable')

  const meta = await metaResponse.json()
  if (meta.error?.type === 'not_found' || String(meta.error?.code) === '404') throw new Error('source_unavailable')
  if (meta.error) throw new Error('dailymotion_provider_unavailable')
  const subtitles = meta.subtitles?.data

  if (!subtitles || Object.keys(subtitles).length === 0) {
    throw new Error('no_captions')
  }

  const lang = subtitles['en'] ? 'en' : Object.keys(subtitles)[0]
  const trackUrl = subtitles[lang]?.urls?.[0] || subtitles[lang]?.url

  if (!trackUrl) throw new Error('no_captions')

  const vttResponse = await fetch(trackUrl, { signal: AbortSignal.timeout(10000) })
  if (!vttResponse.ok) throw new Error('no_captions')

  const vttText = await vttResponse.text()
  const segments = parseCaptionTrack(vttText)

  if (segments.length === 0) throw new Error('no_captions')
  return segments
}

export type DailymotionMeta = {
  id: string
  videoId: string
  title: string
  channel: string
  duration: string
  url: string
  thumbnail: string
  language: string
}

export const fetchDailymotionMeta = async (videoId: string): Promise<DailymotionMeta> => {
  const url = `https://www.dailymotion.com/video/${videoId}`
  const fallback: DailymotionMeta = {
    id: videoId,
    videoId,
    title: `Dailymotion video ${videoId}`,
    channel: 'Unknown',
    duration: '0:00',
    url,
    thumbnail: '',
    language: 'en',
  }

  try {
    const response = await fetch(
      `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}&format=json`,
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

export const fetchDailymotionTranscriptWithFallback = async (videoId: string, _plan?: string | null) => {
  void _plan
  const segments = await fetchDailymotionCaptions(videoId)
  return { segments, captionSource: 'dailymotion' as const }
}
