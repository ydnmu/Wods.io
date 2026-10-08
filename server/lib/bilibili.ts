import type { TranscriptSegment } from './youtube'

type BilibiliSite = 'cn' | 'global'

const isHost = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`)

export const extractBilibiliId = (value: string): string | null => {
  const trimmed = value.trim()

  try {
    const url = new URL(trimmed)
    if (
      !isHost(url.hostname, 'bilibili.com') &&
      !isHost(url.hostname, 'bilibili.tv') &&
      !isHost(url.hostname, 'b23.tv')
    ) return null

    if (isHost(url.hostname, 'b23.tv')) {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id ? `short:${id}` : null
    }

    if (isHost(url.hostname, 'bilibili.tv')) {
      const aidMatch = url.pathname.match(/\/video\/(\d+)/)
      if (aidMatch) return `global:${aidMatch[1]}`
      return null
    }

    const bvMatch = url.pathname.match(/\/(BV[a-z0-9]{10})(?:\/|$)/i)
    if (bvMatch) return bvMatch[1]

    const avMatch = url.pathname.match(/av(\d+)/i)
    if (avMatch) return `av${avMatch[1]}`

    return null
  } catch {
    if (/^BV[\w]{10}$/i.test(trimmed)) return trimmed
    if (/^av\d+$/i.test(trimmed)) return trimmed
    return null
  }
}

export const resolveBilibiliId = async (value: string): Promise<string | null> => {
  const extracted = extractBilibiliId(value)
  if (!extracted?.startsWith('short:')) return extracted

  const slug = extracted.slice(6)
  try {
    const response = await fetch(`https://b23.tv/${encodeURIComponent(slug)}`, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WODS/1.0)' },
      signal: AbortSignal.timeout(6000),
    })
    const resolved = extractBilibiliId(response.url)
    return resolved?.startsWith('short:') ? null : resolved
  } catch {
    return null
  }
}

const detectSite = (videoId: string): BilibiliSite =>
  videoId.startsWith('global:') ? 'global' : 'cn'

const stripGlobalPrefix = (videoId: string): string =>
  videoId.startsWith('global:') ? videoId.slice(7) : videoId

type BilibiliSubtitle = {
  from: number
  to: number
  content: string
}

export const fetchBilibiliCaptions = async (videoId: string): Promise<TranscriptSegment[]> => {
  const site = detectSite(videoId)

  if (site === 'global') {
    return fetchGlobalCaptions(stripGlobalPrefix(videoId))
  }

  return fetchCnCaptions(videoId)
}

const getCnHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.bilibili.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }
  const sessdata = process.env.BILIBILI_SESSDATA
  if (sessdata) {
    headers['Cookie'] = `SESSDATA=${sessdata}`
  }
  return headers
}

async function fetchBilibiliJson(url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error('bilibili_provider_unavailable')
  }
  if (response.status === 401) throw new Error('bilibili_session_required')
  if ([403, 412, 429].includes(response.status)) throw new Error('bilibili_access_restricted')
  if (response.status === 404) throw new Error('source_unavailable')
  if (!response.ok) throw new Error('bilibili_provider_unavailable')
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object') throw new Error('bilibili_provider_unavailable')
  const code = Number(data.code ?? 0)
  if (code === -101) throw new Error('bilibili_session_required')
  if ([-403, -412, -352].includes(code)) throw new Error('bilibili_access_restricted')
  if ([-404, 62002].includes(code)) throw new Error('source_unavailable')
  if (code !== 0) throw new Error('bilibili_provider_unavailable')
  return data
}

const fetchCnCaptions = async (videoId: string): Promise<TranscriptSegment[]> => {
  const cid = await fetchCid(videoId)
  if (!cid) throw new Error('no_captions')

  const aid = videoId.startsWith('av') ? videoId.slice(2) : null
  const bvid = videoId.startsWith('BV') ? videoId : null

  const query = bvid ? `bvid=${bvid}&cid=${cid}` : `aid=${aid}&cid=${cid}`
  const subtitleEndpoints = [
    `https://api.bilibili.com/x/player/wbi/v2?${query}`,
    `https://api.bilibili.com/x/player/v2?${query}`,
  ]
  let subtitles: Array<{ lan?: string; subtitle_url?: string }> = []
  let requiresLogin = false

  for (const subtitleListUrl of subtitleEndpoints) {
    const listData = await fetchBilibiliJson(subtitleListUrl, {
      headers: getCnHeaders(),
      signal: AbortSignal.timeout(8000),
    })
    requiresLogin ||= listData.data?.need_login_subtitle === true
    const tracks = listData.data?.subtitle?.subtitles
    subtitles = Array.isArray(tracks) ? tracks : []
    if (subtitles.length) break
  }

  if (subtitles.length === 0) {
    throw new Error(requiresLogin ? 'bilibili_session_required' : 'no_captions')
  }

  const preferred = subtitles.find((s) => s.lan === 'zh-CN')
    || subtitles.find((s) => s.lan?.startsWith('zh'))
    || subtitles.find((s) => s.lan === 'en')
    || subtitles[0]

  let subtitleUrl = preferred.subtitle_url || ''
  if (!subtitleUrl) throw new Error('no_captions')
  if (subtitleUrl.startsWith('//')) subtitleUrl = `https:${subtitleUrl}`

  const subtitleData = await fetchBilibiliJson(subtitleUrl, {
    headers: getCnHeaders(),
    signal: AbortSignal.timeout(10000),
  })

  const body: BilibiliSubtitle[] = subtitleData.body

  if (!body || body.length === 0) throw new Error('no_captions')

  return normalizeSubtitleBody(body)
}

const fetchGlobalCaptions = async (aid: string): Promise<TranscriptSegment[]> => {
  const data = await fetchBilibiliJson(
    `https://api.bilibili.tv/intl/gateway/web/v2/subtitle?s_locale=en_US&platform=web&aid=${aid}`,
    {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    },
  )

  const subtitles = [data.data?.subtitles, data.data?.video_subtitle]
    .find((tracks) => Array.isArray(tracks) && tracks.length > 0)

  if (!subtitles || subtitles.length === 0) throw new Error('no_captions')

  const preferred = subtitles.find((s: { lang_key: string }) => s.lang_key === 'en')
    || subtitles.find((s: { lang_key: string }) => s.lang_key?.startsWith('zh'))
    || subtitles[0]

  let subtitleUrl = preferred.url || preferred.subtitle_url
  if (!subtitleUrl) throw new Error('no_captions')
  if (subtitleUrl.startsWith('//')) subtitleUrl = `https:${subtitleUrl}`

  const subData = await fetchBilibiliJson(subtitleUrl, { signal: AbortSignal.timeout(10000) })
  const body: BilibiliSubtitle[] = subData.body

  if (!body || body.length === 0) throw new Error('no_captions')

  return normalizeSubtitleBody(body)
}

export const normalizeSubtitleBody = (body: BilibiliSubtitle[]): TranscriptSegment[] =>
  body.map((item) => ({
    text: String(item.content || '').replace(/\s+/g, ' ').trim(),
    start: Math.max(0, Number(item.from)),
    duration: Number(item.to) - Number(item.from),
  })).filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.duration) && item.duration > 0)
    .sort((left, right) => left.start - right.start)

const fetchCid = async (videoId: string): Promise<string | null> => {
  const bvid = videoId.startsWith('BV') ? videoId : null
  const aid = videoId.startsWith('av') ? videoId.slice(2) : null

  const url = bvid
    ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
    : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`

  const data = await fetchBilibiliJson(url, {
    headers: getCnHeaders(),
    signal: AbortSignal.timeout(6000),
  })

  return data.data?.cid ? String(data.data.cid) : null
}

export type BilibiliMeta = {
  id: string
  videoId: string
  title: string
  channel: string
  duration: string
  url: string
  thumbnail: string
  language: string
}

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

const normalizeMediaUrl = (value: unknown) => {
  const url = String(value || '')
  return url.startsWith('//') ? `https:${url}` : url.replace(/^http:/, 'https:')
}

export const fetchBilibiliMeta = async (videoId: string): Promise<BilibiliMeta> => {
  const site = detectSite(videoId)

  if (site === 'global') {
    return fetchGlobalMeta(stripGlobalPrefix(videoId))
  }

  const url = `https://www.bilibili.com/video/${videoId}`
  const fallback: BilibiliMeta = {
    id: videoId,
    videoId,
    title: `Bilibili video ${videoId}`,
    channel: 'Unknown',
    duration: '0:00',
    url,
    thumbnail: '',
    language: 'zh',
  }

  try {
    const bvid = videoId.startsWith('BV') ? videoId : null
    const aid = videoId.startsWith('av') ? videoId.slice(2) : null

    const apiUrl = bvid
      ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
      : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`

    const response = await fetch(apiUrl, {
      headers: getCnHeaders(),
      signal: AbortSignal.timeout(6000),
    })

    if (!response.ok) return fallback
    const data = await response.json()
    const info = data.data

    if (!info) return fallback

    return {
      ...fallback,
      title: info.title || fallback.title,
      channel: info.owner?.name || fallback.channel,
      duration: formatDuration(Number(info.duration || 0)),
      thumbnail: normalizeMediaUrl(info.pic) || fallback.thumbnail,
    }
  } catch {
    return fallback
  }
}

const fetchGlobalMeta = async (aid: string): Promise<BilibiliMeta> => {
  const url = `https://www.bilibili.tv/en/video/${aid}`
  const fallback: BilibiliMeta = {
    id: `global:${aid}`,
    videoId: `global:${aid}`,
    title: `Bilibili video ${aid}`,
    channel: 'Unknown',
    duration: '0:00',
    url,
    thumbnail: '',
    language: 'en',
  }

  try {
    const response = await fetch(
      `https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/episode_id?episode_id=${aid}&s_locale=en_US&platform=web`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(6000),
      },
    )

    if (!response.ok) return fallback
    const data = await response.json()
    const info = data.data

    if (!info) return fallback

    return {
      ...fallback,
      title: info.title || fallback.title,
      channel: info.author?.name || fallback.channel,
      duration: formatDuration(Number(info.duration || info.total_time || 0)),
      thumbnail: normalizeMediaUrl(info.cover) || fallback.thumbnail,
    }
  } catch {
    return fallback
  }
}

export const fetchBilibiliTranscriptWithFallback = async (videoId: string, _plan?: string | null) => {
  void _plan
  const segments = await fetchBilibiliCaptions(videoId)
  return { segments, captionSource: 'bilibili' as const }
}
