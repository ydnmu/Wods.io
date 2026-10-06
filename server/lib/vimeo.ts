import type { TranscriptSegment } from './youtube'
import { parseCaptionTrack } from './captionTracks'

export const extractVimeoId = (value: string): string | null => {
  const trimmed = value.trim()

  try {
    const url = new URL(trimmed)
    if (!url.hostname.includes('vimeo.com')) return null

    if (url.hostname === 'player.vimeo.com') {
      const parts = url.pathname.split('/').filter(Boolean)
      return parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null
    }

    const parts = url.pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    return last && /^\d+$/.test(last) ? last : null
  } catch {
    if (/^\d{6,}$/.test(trimmed)) return trimmed
  }

  return null
}

type VimeoTextTrack = {
  lang: string
  label: string
  url: string
  kind: string
}

type VimeoConfigResponse = {
  video?: {
    title?: string
    owner?: { name?: string }
    thumbs?: { base?: string; '640'?: string; '1280'?: string }
    duration?: number
  }
  request?: {
    text_tracks?: VimeoTextTrack[]
  }
}

const fetchPlayerConfig = async (videoId: string): Promise<VimeoConfigResponse> => {
  const playerUrl = `https://player.vimeo.com/video/${videoId}`
  const response = await fetch(playerUrl, {
    headers: {
      'Accept': 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': 'https://vimeo.com/',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`vimeo_config_failed:${response.status}`)
  }

  const html = await response.text()

  const configMatch = html.match(/window\.playerConfig\s*=\s*({.+?});?\s*<\/script/s)
    || html.match(/"config_url":"(https:[^"]+)"/);

  if (configMatch) {
    if (configMatch[1].startsWith('{')) {
      return JSON.parse(configMatch[1]) as VimeoConfigResponse
    }
    const configUrl = configMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/')
    const cfgRes = await fetch(configUrl, {
      headers: { 'Referer': playerUrl },
      signal: AbortSignal.timeout(8000),
    })
    if (!cfgRes.ok) throw new Error(`vimeo_config_failed:${cfgRes.status}`)
    return cfgRes.json() as Promise<VimeoConfigResponse>
  }

  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.+?)<\/script/s)
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1])
      return { video: { title: ld.name, duration: ld.duration } } as VimeoConfigResponse
    } catch { /* fall through */ }
  }

  throw new Error('vimeo_config_failed:parse_error')
}

const pendingConfigs = new Map<string, Promise<VimeoConfigResponse>>()
const fetchConfig = (videoId: string) => {
  const pending = pendingConfigs.get(videoId)
  if (pending) return pending
  const request = fetchPlayerConfig(videoId).finally(() => pendingConfigs.delete(videoId))
  pendingConfigs.set(videoId, request)
  return request
}

export const fetchVimeoCaptions = async (videoId: string): Promise<TranscriptSegment[]> => {
  const config = await fetchConfig(videoId)
  const tracks = config.request?.text_tracks

  if (!tracks || tracks.length === 0) {
    throw new Error('no_captions')
  }

  const preferred =
    tracks.find((t) => t.kind === 'captions') ||
    tracks.find((t) => t.kind === 'subtitles') ||
    tracks[0]

  let trackUrl = preferred.url
  if (trackUrl.startsWith('//')) trackUrl = `https:${trackUrl}`
  else if (trackUrl.startsWith('/')) trackUrl = `https://vimeo.com${trackUrl}`

  const vttResponse = await fetch(trackUrl, {
    signal: AbortSignal.timeout(10000),
  })

  if (!vttResponse.ok) {
    throw new Error('vimeo_track_fetch_failed')
  }

  const vttText = await vttResponse.text()
  const segments = parseCaptionTrack(vttText)

  if (segments.length === 0) {
    throw new Error('no_captions')
  }

  return segments
}

export type VimeoMeta = {
  id: string
  videoId: string
  title: string
  channel: string
  duration: string
  url: string
  thumbnail: string
  language: string
}

export const fetchVimeoMeta = async (videoId: string): Promise<VimeoMeta> => {
  const url = `https://vimeo.com/${videoId}`
  const fallback: VimeoMeta = {
    id: videoId,
    videoId,
    title: `Vimeo video ${videoId}`,
    channel: 'Unknown',
    duration: '0:00',
    url,
    thumbnail: '',
    language: 'en',
  }

  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(6000) },
    )

    if (!response.ok) throw new Error('vimeo_metadata_unavailable')
    const payload = await response.json()

    return {
      ...fallback,
      title: payload.title || fallback.title,
      channel: payload.author_name || fallback.channel,
      thumbnail: payload.thumbnail_url || fallback.thumbnail,
    }
  } catch {
    try {
      const config = await fetchConfig(videoId)
      const video = config.video
      const duration = Number(video?.duration)
      return {
        ...fallback,
        title: video?.title || fallback.title,
        channel: video?.owner?.name || fallback.channel,
        thumbnail: video?.thumbs?.['1280'] || video?.thumbs?.['640'] || video?.thumbs?.base || '',
        duration: Number.isFinite(duration) && duration > 0
          ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
          : fallback.duration,
      }
    } catch {
      return fallback
    }
  }
}

export const fetchVimeoTranscriptWithFallback = async (videoId: string, plan?: string | null) => {
  void plan
  const segments = await fetchVimeoCaptions(videoId)
  return { segments, captionSource: 'vimeo' as const }
}
