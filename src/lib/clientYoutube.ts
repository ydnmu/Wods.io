import type { TranscriptResponse, TranscriptSegment } from './types'

type YoutubePreparation = {
  videoId: string
  sourceUrl: string
  captionUrl: string
  language: string
  title: string
  channel: string
  thumbnail: string
}

export class ClientYoutubeError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const decodeXmlText = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))

const normalizeCaptionText = (value: string) =>
  decodeXmlText(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

export function parseYoutubeCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []

  for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const attributes = match[1]
    const startMatch = attributes.match(/\bt="(\d+)"/)
    const durationMatch = attributes.match(/\bd="(\d+)"/)
    if (!startMatch) continue

    const textParts = [...match[2].matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)]
    const text = normalizeCaptionText(
      textParts.length ? textParts.map((part) => part[1]).join('') : match[2],
    )
    if (!text) continue

    segments.push({
      text,
      start: Number(startMatch[1]) / 1000,
      duration: Number(durationMatch?.[1] || 0) / 1000,
    })
  }

  if (segments.length) return segments

  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const startMatch = match[1].match(/\bstart="([^"]+)"/)
    const durationMatch = match[1].match(/\bdur="([^"]+)"/)
    if (!startMatch) continue
    const text = normalizeCaptionText(match[2])
    if (!text) continue
    segments.push({
      text,
      start: Number(startMatch[1]),
      duration: Number(durationMatch?.[1] || 0),
    })
  }

  return segments
}

export function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value)
    return url.hostname === 'youtu.be' || url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')
  } catch {
    return /^[\w-]{11}$/.test(value.trim())
  }
}

export async function fetchYoutubeTranscriptFromClient(url: string): Promise<TranscriptResponse> {
  const preparationResponse = await fetch('/api/transcript/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const preparation = await preparationResponse.json().catch(() => ({})) as Partial<YoutubePreparation> & {
    error?: string
    message?: string
  }

  if (!preparationResponse.ok || !preparation.captionUrl || !preparation.videoId || !preparation.sourceUrl) {
    throw new ClientYoutubeError(
      preparation.error || 'caption_prepare_failed',
      preparation.message || 'YouTube caption preparation failed.',
    )
  }

  const captionResponse = await fetch(preparation.captionUrl, {
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  })
  if (!captionResponse.ok) {
    throw new ClientYoutubeError('caption_fetch_failed', 'YouTube captions could not be downloaded.')
  }

  const segments = parseYoutubeCaptionXml(await captionResponse.text())
  if (!segments.length) {
    throw new ClientYoutubeError('no_captions', 'This video does not expose usable captions.')
  }

  return {
    title: preparation.title || `Video ${preparation.videoId}`,
    videoId: preparation.videoId,
    sourceUrl: preparation.sourceUrl,
    segments,
    plainText: segments.map((segment) => segment.text).join(' '),
    captionSource: 'youtube',
  }
}
