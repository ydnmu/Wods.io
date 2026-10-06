import type { TranscriptSegment } from './youtube'

export const extractTedId = (value: string): string | null => {
  const trimmed = value.trim()

  try {
    const url = new URL(trimmed)
    if (!url.hostname.includes('ted.com')) return null

    const match = url.pathname.match(/\/talks\/([\w_-]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export const fetchTedCaptions = async (slug: string): Promise<TranscriptSegment[]> => {
  const response = await fetch(`https://www.ted.com/talks/${slug}/transcript`, {
    headers: {
      'Accept': 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) throw new Error('no_captions')

  const html = await response.text()

  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s)
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1])
      const paragraphs = data.props?.pageProps?.transcriptData?.translation?.paragraphs
      if (paragraphs && paragraphs.length > 0) {
        return parseTedNextDataParagraphs(paragraphs)
      }
    } catch { /* fall through */ }
  }

  const segments = parseTedHtml(html)
  if (segments.length > 0) return segments

  throw new Error('no_captions')
}

type TedNextDataParagraph = {
  cues: { text: string; time: number }[]
}

const parseTedNextDataParagraphs = (paragraphs: TedNextDataParagraph[]): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = []

  for (const para of paragraphs) {
    if (!para.cues) continue
    for (let i = 0; i < para.cues.length; i++) {
      const cue = para.cues[i]
      const next = para.cues[i + 1]
      const duration = next ? (next.time - cue.time) / 1000 : 3
      const text = cue.text.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
      if (!text) continue
      segments.push({ text, start: cue.time / 1000, duration })
    }
  }

  if (segments.length === 0) throw new Error('no_captions')
  return segments
}

const parseTedHtml = (html: string): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = []
  const timeRegex = /data-time="([\d.]+)"[^>]*>([^<]+)/g
  let match: RegExpExecArray | null

  while ((match = timeRegex.exec(html)) !== null) {
    const start = parseFloat(match[1]) / 1000
    const text = match[2].replace(/\s+/g, ' ').trim()
    if (!text) continue
    segments.push({ text, start, duration: 3 })
  }

  if (segments.length === 0) throw new Error('no_captions')

  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].duration = segments[i + 1].start - segments[i].start
  }

  return segments
}

export type TedMeta = {
  id: string
  videoId: string
  title: string
  channel: string
  duration: string
  url: string
  thumbnail: string
  language: string
}

export const fetchTedMeta = async (slug: string): Promise<TedMeta> => {
  const url = `https://www.ted.com/talks/${slug}`
  const fallback: TedMeta = {
    id: slug,
    videoId: slug,
    title: slug.replace(/_/g, ' '),
    channel: 'TED',
    duration: '0:00',
    url,
    thumbnail: '',
    language: 'en',
  }

  try {
    const response = await fetch(
      `https://www.ted.com/services/v1/oembed.json?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(6000) },
    )

    if (!response.ok) return fallback
    const payload = await response.json()

    return {
      ...fallback,
      title: payload.title || fallback.title,
      channel: payload.author_name || 'TED',
      thumbnail: payload.thumbnail_url || fallback.thumbnail,
    }
  } catch {
    return fallback
  }
}

export const fetchTedTranscriptWithFallback = async (slug: string, _plan?: string | null) => {
  void _plan
  const segments = await fetchTedCaptions(slug)
  return { segments, captionSource: 'ted' as const }
}
