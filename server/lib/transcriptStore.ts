import { supabase } from './supabase'
import type { TranscriptSegment, VideoMeta } from './youtube'

function formatDuration(totalSeconds: number) {
  const rounded = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function resolveTranscriptDuration(metaDuration: string, lines: TranscriptSegment[]) {
  if (metaDuration && metaDuration !== '0:00') return metaDuration
  const finalSecond = lines.reduce(
    (maximum, line) => Math.max(maximum, Number(line.start || 0) + Number(line.duration || 0)),
    0,
  )
  return formatDuration(finalSecond)
}

export async function saveTranscript(params: {
  id: string
  userId: string
  meta: VideoMeta
  lines: TranscriptSegment[]
  captionSource?: string
  speechProviders?: string[]
  aiFallbackSeconds?: number
}) {
  const wordCount = params.lines.reduce(
    (sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length,
    0,
  )

  const baseRow = {
    id: params.id,
    user_id: params.userId,
    video_id: params.meta.videoId,
    video_title: params.meta.title,
    video_channel: params.meta.channel,
    video_duration: resolveTranscriptDuration(params.meta.duration, params.lines),
    video_thumbnail: params.meta.thumbnail,
    lines: params.lines,
    word_count: wordCount,
    caption_source: params.captionSource || 'youtube',
  }
  const { error } = await supabase.from('transcripts').upsert({
    ...baseRow,
    speech_providers: params.speechProviders ?? [],
    ai_fallback_seconds: Math.max(0, Math.round(params.aiFallbackSeconds ?? 0)),
  })

  if (error) {
    const missingAudioMeterColumn = error.code === 'PGRST204' ||
      error.code === '42703' ||
      /ai_fallback_seconds|speech_providers/i.test(String(error.message || ''))
    if (!missingAudioMeterColumn) throw new Error(`transcript_store_failed: ${error.message}`)
    const { error: legacyError } = await supabase.from('transcripts').upsert(baseRow)
    if (legacyError) throw new Error(`transcript_store_failed: ${legacyError.message}`)
  }
  return wordCount
}
