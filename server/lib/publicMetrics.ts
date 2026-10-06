import { hasSupabaseConfig, supabase } from './supabase'

export type PublicTranscriptMetrics = {
  transcriptCount: number
  averageResponseMs: number | null
}

export const RECENT_TRANSCRIPT_SAMPLE_SIZE = 100

export type PublicMetricDependencies = {
  configured: () => boolean
  readCount: () => Promise<number>
  readRecentDurations: () => Promise<number[]>
  recordCompletion: (responseMs: number, completionId: string) => Promise<number>
}

const dependencies: PublicMetricDependencies = {
  configured: hasSupabaseConfig,
  async readCount() {
    const { data, error } = await supabase
      .from('public_transcript_metrics')
      .select('transcript_count')
      .eq('id', true)
      .maybeSingle()
    if (error) throw new Error(`public_metrics_read_failed: ${error.message}`)
    if (!data) throw new Error('public_metrics_unavailable')
    return Number(data.transcript_count)
  },
  async readRecentDurations() {
    // Receipts contain only successful completions, without URLs or transcript text.
    const { data, error } = await supabase
      .from('public_transcript_metric_receipts')
      .select('response_ms')
      .order('created_at', { ascending: false })
      .limit(RECENT_TRANSCRIPT_SAMPLE_SIZE)
    if (error) throw new Error(`public_metrics_read_failed: ${error.message}`)
    return (data ?? []).map(row => Number(row.response_ms))
  },
  async recordCompletion(responseMs, completionId) {
    const { data, error } = await supabase.rpc('record_public_transcript_metric', {
      p_completion_id: completionId,
      p_response_ms: responseMs,
    })
    if (error) throw new Error(`public_metrics_write_failed: ${error.message}`)
    const row = Array.isArray(data) ? data[0] : data
    return Number(row?.transcript_count)
  },
}

function metricsFromRecentRequests(transcriptCount: number, durations: number[]): PublicTranscriptMetrics {
  if (!Number.isSafeInteger(transcriptCount) || transcriptCount < 0) throw new Error('public_metrics_invalid_count')
  const successfulDurations = durations.filter(value => Number.isFinite(value) && value > 0)
  return {
    transcriptCount,
    averageResponseMs: successfulDurations.length
      ? Math.round(successfulDurations.reduce((sum, value) => sum + value, 0) / successfulDurations.length)
      : null,
  }
}

export async function getPublicTranscriptMetrics(source = dependencies): Promise<PublicTranscriptMetrics> {
  if (!source.configured()) throw new Error('public_metrics_unavailable')
  const [count, durations] = await Promise.all([source.readCount(), source.readRecentDurations()])
  return metricsFromRecentRequests(count, durations)
}

export async function recordPublicTranscriptMetric(
  responseMs: number,
  completionId: string,
  source = dependencies,
): Promise<PublicTranscriptMetrics> {
  if (!source.configured()) throw new Error('public_metrics_unavailable')
  if (!Number.isFinite(responseMs) || responseMs <= 0) throw new Error('invalid_response_ms')
  const safeResponseMs = Math.max(1, Math.min(3_600_000, Math.round(responseMs)))
  const count = await source.recordCompletion(safeResponseMs, completionId)
  return metricsFromRecentRequests(count, await source.readRecentDurations())
}
