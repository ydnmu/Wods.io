import { supabase } from './supabase'

const missingAudioMeterColumn = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST204' ||
  error.code === '42703' ||
  /ai_fallback_seconds|caption_seconds|speech_providers|reserve_transcript_hours/i.test(String(error.message || ''))

export function transcriptDurationSeconds(lines: Array<{ start?: number; duration?: number }>) {
  return Math.max(1, Math.ceil(lines.reduce(
    (maximum, line) => Math.max(maximum, Number(line.start || 0) + Number(line.duration || 0)),
    0,
  )))
}

export function nextMonthStart() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

export type UsageReservation = {
  id: string
  used: number
  limit: number | null
}

export async function reserveUsage(params: {
  userId: string
  videoId: string
  endpoint: string
}): Promise<{ allowed: boolean; used: number; limit: number | null; reservation: UsageReservation | null }> {
  const { data, error } = await supabase.rpc('reserve_transcript_usage', {
    p_user_id: params.userId,
    p_video_id: params.videoId,
    p_endpoint: params.endpoint,
  })

  if (error) throw new Error(`usage_reservation_failed: ${error.message}`)

  const result = Array.isArray(data) ? data[0] : data
  const used = Number(result?.used ?? 0)
  const limit = result?.quota_limit == null ? null : Number(result.quota_limit)
  const id = result?.usage_log_id ? String(result.usage_log_id) : null

  return {
    allowed: Boolean(result?.allowed),
    used,
    limit,
    reservation: id ? { id, used, limit } : null,
  }
}

export async function finalizeUsage(reservationId: string, status: 'success' | 'error') {
  const { error } = await supabase.rpc('finalize_transcript_usage', {
    p_usage_log_id: reservationId,
    p_status: status,
  })
  if (error) throw new Error(`usage_finalization_failed: ${error.message}`)
}

export async function recordUsageSpeech(params: {
  reservationId: string
  captionSeconds?: number
  aiFallbackSeconds?: number
  speechProviders?: string[]
}) {
  const captionSeconds = Math.max(0, Math.round(params.captionSeconds ?? 0))
  const aiFallbackSeconds = Math.max(0, Math.round(params.aiFallbackSeconds ?? 0))
  const route = aiFallbackSeconds > 0 ? 'ai_fallback' : 'caption'
  const sourceSeconds = aiFallbackSeconds || captionSeconds
  if (!sourceSeconds) return { allowed: true, route, billableSeconds: 0 }

  const { data: reservationData, error: reservationError } = await supabase.rpc('reserve_transcript_hours', {
    p_usage_log_id: params.reservationId,
    p_route: route,
    p_source_seconds: sourceSeconds,
  })

  if (!reservationError) {
    const result = Array.isArray(reservationData) ? reservationData[0] : reservationData
    if (!result?.allowed) {
      return {
        allowed: false,
        route,
        billableSeconds: Number(result?.billable_seconds || 0),
        usedSeconds: Number(result?.used_seconds || 0),
        limitSeconds: result?.limit_seconds == null ? null : Number(result.limit_seconds),
      }
    }
    if (params.speechProviders?.length) {
      await supabase.from('usage_logs').update({ speech_providers: params.speechProviders }).eq('id', params.reservationId)
    }
    return { allowed: true, route, billableSeconds: Number(result?.billable_seconds || sourceSeconds) }
  }

  if (!missingAudioMeterColumn(reservationError)) {
    throw new Error(`usage_hour_reservation_failed: ${reservationError.message}`)
  }

  // Compatibility path until the hour-meter migration is applied.
  const { error } = await supabase
    .from('usage_logs')
    .update({
      ai_fallback_seconds: aiFallbackSeconds,
      speech_providers: params.speechProviders ?? [],
    })
    .eq('id', params.reservationId)
  if (error && !missingAudioMeterColumn(error)) {
    throw new Error(`usage_speech_record_failed: ${error.message}`)
  }
  return { allowed: true, route, billableSeconds: sourceSeconds, legacy: true }
}

export async function logUsage(params: {
  userId: string
  videoId: string
  endpoint: string
  status: 'success' | 'error'
}) {
  await supabase.from('usage_logs').insert({
    user_id: params.userId,
    video_id: params.videoId,
    endpoint: params.endpoint,
    status: params.status,
  })
}
