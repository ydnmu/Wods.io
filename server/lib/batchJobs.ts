import { getPlanPolicy } from './plans'
import { supabase } from './supabase'
import { extractVideoId } from './youtube'

type BatchInputError =
  | { error: 'urls_array_required' | 'invalid_url' }
  | { error: 'batch_limit_exceeded'; max: number }

type NormalizedBatch = { urls: string[]; duplicatesRemoved: number }

type QueuedBatchJob = { id: string; total: number; status: string; created_at: string }

export type QueueBatchJobResult =
  | { job: QueuedBatchJob; duplicatesRemoved: number }
  | BatchInputError
  | { error: 'db_error'; cleanup_failed?: true }

export function normalizeBatchUrls(value: unknown, maxUrls: number): NormalizedBatch | BatchInputError {
  if (!Array.isArray(value) || value.length === 0) return { error: 'urls_array_required' as const }
  if (maxUrls >= 0 && value.length > maxUrls) return { error: 'batch_limit_exceeded' as const, max: maxUrls }

  const unique = new Map<string, string>()
  for (const candidate of value) {
    const videoId = extractVideoId(String(candidate || '').trim())
    if (!videoId) return { error: 'invalid_url' as const }
    unique.set(videoId, `https://www.youtube.com/watch?v=${videoId}`)
  }
  return { urls: [...unique.values()], duplicatesRemoved: value.length - unique.size }
}

export async function queueBatchJob(userId: string, plan: string | undefined, value: unknown): Promise<QueueBatchJobResult> {
  const normalized = normalizeBatchUrls(value, getPlanPolicy(plan).maxBatchUrls)
  if ('error' in normalized) return normalized

  const { data: job, error } = await supabase
    .from('batch_jobs')
    .insert({ user_id: userId, total: normalized.urls.length })
    .select('id, total, status, created_at')
    .single<QueuedBatchJob>()
  if (error || !job) return { error: 'db_error' as const }

  const { error: itemsError } = await supabase
    .from('batch_items')
    .insert(normalized.urls.map((url) => ({ batch_job_id: job.id, url })))
  if (itemsError) {
    const { error: cleanupError } = await supabase.from('batch_jobs').delete().eq('id', job.id)
    if (cleanupError) {
      console.error('[batch] queue cleanup failed:', cleanupError)
      return { error: 'db_error', cleanup_failed: true }
    }
    return { error: 'db_error' as const }
  }
  return { job, duplicatesRemoved: normalized.duplicatesRemoved }
}
