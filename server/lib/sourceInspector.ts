import { Innertube } from 'youtubei.js'
import { resolveChannel } from '../routes/channels'
import { extractVideoId, prepareBrowserYoutubeTranscript } from './youtube'

type InspectedVideo = { id: string; seconds: number }

type SourceInspectionOptions = {
  analyzeCaptions?: boolean
}

export type SourceBreakdown = {
  videos: number
  shorts: number
  live: number
}

export type SourceInspection = {
  type: 'video' | 'playlist' | 'channel' | 'bulk'
  title: string
  videoCount: number
  totalSeconds: number
  estimatedWords: number
  estimatedSegments: number
  estimatedMinutes: number
  thumbnailUrl?: string
  urls: string[]
  truncated: boolean
  breakdown?: SourceBreakdown
  captionSampleSize?: number
  captionedSampleCount?: number
  fallbackSampleCount?: number
  estimatedCaptionedVideos?: number
  estimatedAiFallbackVideos?: number
  captionEstimateExact?: boolean
  captionedContentMinutes?: number
  aiFallbackContentMinutes?: number
  estimatedCaptionProcessingMinutes?: number
  estimatedAiFallbackProcessingMinutes?: number
  processingConcurrency?: number
}

export const PAID_BATCH_CONCURRENCY = 6

export const estimatePaidBatchTiming = (
  captionedVideos: number,
  fallbackVideos: number,
  fallbackContentSeconds: number,
) => {
  const captionSeconds = captionedVideos * 2.5
  const fallbackSeconds = fallbackContentSeconds * 0.12 + fallbackVideos * 7
  const captionMinutes = Math.max(captionedVideos ? 1 : 0, Math.ceil(captionSeconds / PAID_BATCH_CONCURRENCY / 60))
  const fallbackMinutes = Math.max(fallbackVideos ? 1 : 0, Math.ceil(fallbackSeconds / PAID_BATCH_CONCURRENCY / 60))
  return {
    estimatedCaptionProcessingMinutes: captionMinutes,
    estimatedAiFallbackProcessingMinutes: fallbackMinutes,
    estimatedMinutes: Math.max(1, captionMinutes + fallbackMinutes),
    processingConcurrency: PAID_BATCH_CONCURRENCY,
  }
}

let youtubeClient: Promise<Innertube> | null = null

const getClient = () => {
  youtubeClient ??= Innertube.create({ retrieve_player: false })
  return youtubeClient
}

const asVideo = (item: unknown) => {
  const candidate = item as {
    id?: string
    title?: { toString(): string } | string
    duration?: { seconds?: number }
  }
  if (!candidate.id) return null
  return {
    id: candidate.id,
    title: typeof candidate.title === 'string' ? candidate.title : candidate.title?.toString() || candidate.id,
    seconds: Math.max(0, Number(candidate.duration?.seconds || 0)),
  }
}

const summarize = (
  type: SourceInspection['type'],
  title: string,
  videos: Array<{ id: string; seconds: number }>,
  truncated: boolean,
  breakdown?: SourceBreakdown,
  thumbnailUrl?: string,
): SourceInspection => {
  const unique = [...new Map(videos.map((video) => [video.id, video])).values()]
  const totalSeconds = unique.reduce((sum, video) => sum + video.seconds, 0)
  const estimatedWords = Math.round(totalSeconds * 2.25)
  const estimatedSegments = Math.ceil(totalSeconds / 6)
  const timing = estimatePaidBatchTiming(unique.length, 0, 0)
  return {
    type,
    title,
    videoCount: unique.length,
    totalSeconds,
    estimatedWords,
    estimatedSegments,
    estimatedMinutes: timing.estimatedMinutes,
    thumbnailUrl,
    urls: unique.map((video) => `https://www.youtube.com/watch?v=${video.id}`),
    truncated,
    breakdown,
  }
}

const evenlySpacedSample = (videos: InspectedVideo[], limit = 48) => {
  if (videos.length <= limit) return videos
  const picked = new Map<string, InspectedVideo>()
  for (let index = 0; index < limit; index += 1) {
    const position = Math.round(index * (videos.length - 1) / (limit - 1))
    picked.set(videos[position].id, videos[position])
  }
  return [...picked.values()]
}

const inspectCaptionAvailability = async (videos: InspectedVideo[]) => {
  const sample = evenlySpacedSample(videos)
  let captioned = 0
  let captionedSeconds = 0
  let fallbackSeconds = 0
  let cursor = 0
  const probeFetch: typeof fetch = (input, init) => fetch(input, {
    ...init,
    signal: AbortSignal.timeout(6_000),
  })

  const worker = async () => {
    while (cursor < sample.length) {
      const video = sample[cursor]
      cursor += 1
      try {
        // Availability probe only: this reads the caption manifest and never runs speech-to-text.
        await prepareBrowserYoutubeTranscript(video.id, probeFetch)
        captioned += 1
        captionedSeconds += video.seconds || 360
      } catch {
        // An unavailable or unusable caption track needs the fallback path.
        fallbackSeconds += video.seconds || 360
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, sample.length) }, worker))
  const fallback = sample.length - captioned
  const exact = sample.length === videos.length
  const estimatedFallback = exact
    ? fallback
    : Math.round(videos.length * (fallback / Math.max(sample.length, 1)))
  const totalSeconds = videos.reduce((sum, video) => sum + video.seconds, 0)
  const sampledSeconds = captionedSeconds + fallbackSeconds
  const fallbackDurationRatio = sampledSeconds
    ? fallbackSeconds / sampledSeconds
    : fallback / Math.max(sample.length, 1)
  const estimatedFallbackSeconds = Math.round(totalSeconds * fallbackDurationRatio)
  const estimatedCaptioned = Math.max(0, videos.length - estimatedFallback)

  return {
    captionSampleSize: sample.length,
    captionedSampleCount: captioned,
    fallbackSampleCount: fallback,
    estimatedCaptionedVideos: estimatedCaptioned,
    estimatedAiFallbackVideos: estimatedFallback,
    captionEstimateExact: exact,
    captionedContentMinutes: Math.round(Math.max(0, totalSeconds - estimatedFallbackSeconds) / 60),
    aiFallbackContentMinutes: Math.round(estimatedFallbackSeconds / 60),
    ...estimatePaidBatchTiming(estimatedCaptioned, estimatedFallback, estimatedFallbackSeconds),
  }
}

const withCaptionAnalysis = async (
  inspection: SourceInspection,
  videos: InspectedVideo[],
  enabled: boolean,
) => enabled && videos.length
  ? { ...inspection, ...await inspectCaptionAvailability(videos) }
  : inspection

const scrapeCollectionPage = async (url: URL, advertisedTotal: string, maxVideos: number) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WODS/1.0)' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return { videos: [], truncated: false }
  const html = await response.text()
  const ids = [...new Set([...html.matchAll(/"videoId":"([\w-]{11})"/g)].map((match) => match[1]))]
  const advertised = Number(advertisedTotal.match(/\d[\d,]*/)?.[0]?.replaceAll(',', '') || 0)
  const target = advertised || maxVideos
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1]
  let continuation = html.match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1]

  while (continuation && apiKey && clientVersion && ids.length < Math.min(target, maxVideos)) {
    const continuationResponse = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; WODS/1.0)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion } },
        continuation,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!continuationResponse.ok) break
    const payload = JSON.stringify(await continuationResponse.json())
    const pageIds = [...new Set([...payload.matchAll(/"videoId":"([\w-]{11})"/g)].map((match) => match[1]))]
    const before = ids.length
    for (const id of pageIds) {
      if (!ids.includes(id)) ids.push(id)
      if (ids.length >= maxVideos) break
    }
    continuation = payload.match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1]
    if (ids.length === before) break
  }

  return {
    videos: ids.slice(0, maxVideos).map((id) => ({ id, seconds: 360 })),
    truncated: Boolean(continuation) || advertised > Math.min(ids.length, maxVideos),
  }
}

const collectFeed = async (
  initialFeed: {
    videos: unknown[]
    items?: unknown[]
    has_continuation: boolean
    getContinuation(): Promise<unknown>
  },
  maxVideos: number,
) => {
  const videos = new Map<string, InspectedVideo>()
  let feed = initialFeed

  while (videos.size < maxVideos) {
    const feedItems = feed.items?.length ? feed.items : feed.videos
    for (const video of feedItems.map(asVideo).filter((item): item is NonNullable<typeof item> => Boolean(item))) {
      videos.set(video.id, video)
      if (videos.size >= maxVideos) break
    }
    if (!feed.has_continuation || videos.size >= maxVideos) break
    feed = await feed.getContinuation() as typeof initialFeed
  }

  return { videos: [...videos.values()], truncated: feed.has_continuation }
}

export async function inspectYouTubeSource(
  value: string,
  maxVideos = 1000,
  options: SourceInspectionOptions = {},
): Promise<SourceInspection> {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 1) {
    const urls = [...new Set(lines)].slice(0, maxVideos)
    const estimatedSeconds = urls.length * 360
    return {
      type: 'bulk',
      title: 'Bulk URL list',
      videoCount: urls.length,
      totalSeconds: estimatedSeconds,
      estimatedWords: Math.round(estimatedSeconds * 2.25),
      estimatedSegments: Math.ceil(estimatedSeconds / 6),
      estimatedMinutes: estimatePaidBatchTiming(urls.length, 0, 0).estimatedMinutes,
      urls,
      truncated: lines.length > maxVideos,
    }
  }

  const raw = lines[0] || ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid_source_url')
  }

  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) throw new Error('unsupported_source')

  const playlistId = url.searchParams.get('list')
  if (playlistId) {
    const playlist = await (await getClient()).getPlaylist(playlistId)
    let result = await collectFeed(playlist, maxVideos)
    if (!result.videos.length) {
      result = await scrapeCollectionPage(url, playlist.info.total_items, maxVideos)
    }
    return withCaptionAnalysis(
      summarize(
        'playlist',
        playlist.info.title || 'YouTube playlist',
        result.videos,
        result.truncated && result.videos.length >= maxVideos,
        undefined,
        playlist.info.thumbnails.at(-1)?.url,
      ),
      result.videos,
      Boolean(options.analyzeCaptions),
    )
  }

  if (/^\/(?:@|channel\/|c\/|user\/)/i.test(url.pathname)) {
    const resolved = await resolveChannel(raw)
    if (!resolved) throw new Error('channel_not_found')
    const channel = await (await getClient()).getChannel(resolved.channelId)
    const unique = new Map<string, InspectedVideo>()
    const breakdown: SourceBreakdown = { videos: 0, shorts: 0, live: 0 }
    let truncated = false

    const appendCategory = async (
      category: keyof SourceBreakdown,
      available: boolean,
      getFeed: () => Promise<Parameters<typeof collectFeed>[0]>,
    ) => {
      if (!available || unique.size >= maxVideos) {
        if (available && unique.size >= maxVideos) truncated = true
        return
      }
      try {
        const result = await collectFeed(await getFeed(), maxVideos - unique.size)
        const before = unique.size
        result.videos.forEach((video) => unique.set(video.id, video))
        breakdown[category] = unique.size - before
        truncated ||= result.truncated
      } catch {
        // Some channels expose an empty tab. The public page fallback below handles it.
      }
    }

    await appendCategory('videos', channel.has_videos, () => channel.getVideos())
    await appendCategory('shorts', channel.has_shorts, () => channel.getShorts())
    await appendCategory('live', channel.has_live_streams, () => channel.getLiveStreams())

    if (!unique.size) {
      const paths: Array<[keyof SourceBreakdown, string]> = [
        ['videos', 'videos'],
        ['shorts', 'shorts'],
        ['live', 'streams'],
      ]
      for (const [category, path] of paths) {
        if (unique.size >= maxVideos) {
          truncated = true
          break
        }
        const result = await scrapeCollectionPage(
          new URL(`https://www.youtube.com/channel/${resolved.channelId}/${path}`),
          '',
          maxVideos - unique.size,
        )
        const before = unique.size
        result.videos.forEach((video) => unique.set(video.id, video))
        breakdown[category] = unique.size - before
        truncated ||= result.truncated
      }
    }

    const videos = [...unique.values()]
    return withCaptionAnalysis(
      summarize(
        'channel',
        resolved.channelName,
        videos,
        truncated && videos.length >= maxVideos,
        breakdown,
        channel.metadata.avatar?.at(-1)?.url,
      ),
      videos,
      Boolean(options.analyzeCaptions),
    )
  }

  const videoId = extractVideoId(raw)
  if (!videoId) throw new Error('invalid_source_url')

  let title = 'Single video'
  let seconds = 360
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`

  try {
    const info = await (await getClient()).getBasicInfo(videoId)
    title = info.basic_info.title || title
    seconds = Math.max(1, Number(info.basic_info.duration || seconds))
    thumbnailUrl = info.basic_info.thumbnail?.at(0)?.url || thumbnailUrl
  } catch {
    // Keep useful estimates and the canonical thumbnail if metadata is temporarily unavailable.
  }

  const videos = [{ id: videoId, seconds }]
  return withCaptionAnalysis(
    summarize('video', title, videos, false, undefined, thumbnailUrl),
    videos,
    Boolean(options.analyzeCaptions),
  )
}
