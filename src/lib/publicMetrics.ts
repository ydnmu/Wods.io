export type PublicTranscriptMetrics = {
  transcriptCount: number
  averageResponseMs: number | null
}

export function parsePublicTranscriptMetrics(value: unknown): PublicTranscriptMetrics | null {
  if (!value || typeof value !== 'object') return null
  const { transcriptCount, averageResponseMs } = value as Record<string, unknown>
  if (typeof transcriptCount !== 'number' || !Number.isSafeInteger(transcriptCount) || transcriptCount < 0) return null
  if (averageResponseMs !== null && (typeof averageResponseMs !== 'number' || !Number.isFinite(averageResponseMs) || averageResponseMs <= 0)) return null
  return { transcriptCount, averageResponseMs: averageResponseMs as number | null }
}
