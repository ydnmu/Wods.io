import { hasSupabaseConfig, supabase } from './supabase'

export type BudgetedSpeechProvider =
  | 'groq'
  | 'cloudflare'
  | 'fireworks'
  | 'deepgram'
  | 'assemblyai'
  | 'worker'

type ProviderBudget = {
  dailySeconds: number | null
  lifetimeSeconds: number | null
}

export type SpeechBudgetLease = {
  provider: BudgetedSpeechProvider
  reservationId: string | null
  audioSeconds: number
  source: 'database' | 'memory'
  release(status: 'success' | 'error'): Promise<void>
}

type MemoryUsage = {
  daily: Map<string, number>
  lifetime: Map<BudgetedSpeechProvider, number>
}

const memoryUsage: MemoryUsage = {
  daily: new Map(),
  lifetime: new Map(),
}

const warnedMissingBudgetRpc = new Set<string>()

const positiveNumber = (value: string | undefined, fallback: number | null) => {
  if (value == null || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

const minutesToSeconds = (value: number | null) =>
  value == null ? null : Math.round(value * 60)

export function getProviderBudget(provider: BudgetedSpeechProvider): ProviderBudget {
  const freeOnly = String(process.env.SPEECH_PROVIDER_FREE_ONLY ?? 'true').toLowerCase() !== 'false'
  if (!freeOnly || provider === 'worker') return { dailySeconds: null, lifetimeSeconds: null }

  const defaults: Record<BudgetedSpeechProvider, { dailyMinutes: number | null; lifetimeMinutes: number | null }> = {
    groq: { dailyMinutes: 480, lifetimeMinutes: null },
    cloudflare: { dailyMinutes: 214, lifetimeMinutes: null },
    fireworks: { dailyMinutes: null, lifetimeMinutes: 1_111 },
    deepgram: { dailyMinutes: null, lifetimeMinutes: 43_000 },
    assemblyai: { dailyMinutes: null, lifetimeMinutes: 11_100 },
    worker: { dailyMinutes: null, lifetimeMinutes: null },
  }

  const prefix = provider.toUpperCase()
  return {
    dailySeconds: minutesToSeconds(positiveNumber(
      process.env[`${prefix}_FREE_AUDIO_MINUTES_PER_DAY`],
      defaults[provider].dailyMinutes,
    )),
    lifetimeSeconds: minutesToSeconds(positiveNumber(
      process.env[`${prefix}_FREE_AUDIO_MINUTES_TOTAL`],
      defaults[provider].lifetimeMinutes,
    )),
  }
}

const utcDay = (now = new Date()) => now.toISOString().slice(0, 10)

function reserveInMemory(
  provider: BudgetedSpeechProvider,
  audioSeconds: number,
  budget: ProviderBudget,
): SpeechBudgetLease | null {
  const dayKey = `${provider}:${utcDay()}`
  const dailyUsed = memoryUsage.daily.get(dayKey) ?? 0
  const lifetimeUsed = memoryUsage.lifetime.get(provider) ?? 0
  if (budget.dailySeconds != null && dailyUsed + audioSeconds > budget.dailySeconds) return null
  if (budget.lifetimeSeconds != null && lifetimeUsed + audioSeconds > budget.lifetimeSeconds) return null

  memoryUsage.daily.set(dayKey, dailyUsed + audioSeconds)
  memoryUsage.lifetime.set(provider, lifetimeUsed + audioSeconds)
  let finalized = false

  return {
    provider,
    reservationId: null,
    audioSeconds,
    source: 'memory',
    async release(status) {
      if (finalized) return
      finalized = true
      if (status === 'success') return
      memoryUsage.daily.set(dayKey, Math.max(0, (memoryUsage.daily.get(dayKey) ?? 0) - audioSeconds))
      memoryUsage.lifetime.set(provider, Math.max(0, (memoryUsage.lifetime.get(provider) ?? 0) - audioSeconds))
    },
  }
}

const isMissingBudgetRpc = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST202' ||
  error.code === '42883' ||
  /reserve_speech_provider_budget/i.test(String(error.message || ''))

export async function reserveSpeechProviderBudget(
  provider: BudgetedSpeechProvider,
  rawAudioSeconds: number,
): Promise<SpeechBudgetLease | null> {
  const audioSeconds = Math.max(1, Math.ceil(rawAudioSeconds))
  const budget = getProviderBudget(provider)

  const forceMemory = String(process.env.SPEECH_BUDGET_FORCE_MEMORY || '').toLowerCase() === 'true'
  if (forceMemory || !hasSupabaseConfig()) return reserveInMemory(provider, audioSeconds, budget)

  const { data, error } = await supabase.rpc('reserve_speech_provider_budget', {
    p_provider: provider,
    p_audio_seconds: audioSeconds,
    p_daily_limit_seconds: budget.dailySeconds,
    p_lifetime_limit_seconds: budget.lifetimeSeconds,
  })

  if (error) {
    if (!isMissingBudgetRpc(error)) throw new Error(`speech_budget_reservation_failed: ${error.message}`)
    const requireDatabase = String(
      process.env.SPEECH_BUDGET_REQUIRE_DATABASE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false'),
    ).toLowerCase() === 'true'
    if (requireDatabase) throw new Error('speech_budget_migration_required')
    if (!warnedMissingBudgetRpc.has(provider)) {
      warnedMissingBudgetRpc.add(provider)
      console.warn(`[speech-budget] ${provider}: database migration missing; using process-local budget tracking`)
    }
    return reserveInMemory(provider, audioSeconds, budget)
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result?.allowed || !result?.reservation_id) return null
  const reservationId = String(result.reservation_id)
  let finalized = false

  return {
    provider,
    reservationId,
    audioSeconds,
    source: 'database',
    async release(status) {
      if (finalized) return
      finalized = true
      const { error: finalizeError } = await supabase.rpc('finalize_speech_provider_budget', {
        p_reservation_id: reservationId,
        p_status: status,
      })
      if (finalizeError) throw new Error(`speech_budget_finalization_failed: ${finalizeError.message}`)
    },
  }
}

export function resetSpeechProviderBudgetMemoryForTests() {
  memoryUsage.daily.clear()
  memoryUsage.lifetime.clear()
  warnedMissingBudgetRpc.clear()
}
