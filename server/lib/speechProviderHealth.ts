import type { BudgetedSpeechProvider } from './speechProviderBudget'
import { getProviderBudget } from './speechProviderBudget'
import {
  getSpeechProviderCredential,
  getSpeechProviderCredentialStatuses,
  speechProviderConfigured,
} from './speechProviderCredentials'
import { getSpeechProviderOrder, getSpeechProviderPoolSnapshot } from './speechToText'

export type SpeechProviderHealthStatus =
  | 'healthy'
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'unreachable'
  | 'unhealthy'
  | 'unknown'

export type SpeechProviderHealth = {
  provider: BudgetedSpeechProvider
  configured: boolean
  freeRoute: boolean
  status: SpeechProviderHealthStatus
  detail: string
  checkedAt: string | null
  latencyMs: number | null
  budget: { dailyMinutes: number | null; lifetimeMinutes: number | null }
  pool: { active: number; concurrency: number; coolingDownUntil: number | null } | null
}

const supportedProviders: BudgetedSpeechProvider[] = [
  'groq',
  'cloudflare',
  'fireworks',
  'deepgram',
  'assemblyai',
  'worker',
]

const healthTimeoutMs = () => Math.max(1_000, Number(process.env.SPEECH_PROVIDER_HEALTH_TIMEOUT_MS || 4_000))
const cacheTtlMs = () => Math.max(5_000, Number(process.env.SPEECH_PROVIDER_HEALTH_CACHE_MS || 30_000))
const cache = new Map<BudgetedSpeechProvider, SpeechProviderHealth>()
let checkedAt = 0
let inFlight: Promise<SpeechProviderHealth[]> | null = null

const budgetFor = (provider: BudgetedSpeechProvider) => {
  const budget = getProviderBudget(provider)
  return {
    dailyMinutes: budget.dailySeconds == null ? null : Math.round(budget.dailySeconds / 60),
    lifetimeMinutes: budget.lifetimeSeconds == null ? null : Math.round(budget.lifetimeSeconds / 60),
  }
}

const statusForResponse = (status: number): SpeechProviderHealthStatus => {
  if (status >= 200 && status < 300) return 'healthy'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  return 'unhealthy'
}

const requestFor = (provider: Exclude<BudgetedSpeechProvider, 'worker'>) => {
  const credential = getSpeechProviderCredential(provider)
  const apiKey = String(credential.apiKey || '')
  const accountId = String(credential.accountId || '')
  const requests: Record<Exclude<BudgetedSpeechProvider, 'worker'>, { url: string; headers: Record<string, string> }> = {
    groq: {
      url: 'https://api.groq.com/openai/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    cloudflare: {
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1`,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    fireworks: {
      url: 'https://api.fireworks.ai/inference/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    deepgram: {
      url: 'https://api.deepgram.com/v1/projects',
      headers: { Authorization: `Token ${apiKey}` },
    },
    assemblyai: {
      url: 'https://api.assemblyai.com/v2/transcript?limit=1',
      headers: { Authorization: apiKey },
    },
  }
  return requests[provider]
}

const poolFor = (provider: BudgetedSpeechProvider) =>
  getSpeechProviderPoolSnapshot('free').find((item) => item.provider === provider) || null

const baseHealth = (provider: BudgetedSpeechProvider, status: SpeechProviderHealthStatus, detail: string): SpeechProviderHealth => ({
  provider,
  configured: speechProviderConfigured(provider),
  freeRoute: getSpeechProviderOrder('free').includes(provider),
  status,
  detail,
  checkedAt: null,
  latencyMs: null,
  budget: budgetFor(provider),
  pool: poolFor(provider),
})

async function checkProvider(provider: BudgetedSpeechProvider): Promise<SpeechProviderHealth> {
  if (!speechProviderConfigured(provider)) return baseHealth(provider, 'not_configured', 'Credential or endpoint is missing.')

  if (provider === 'worker') {
    const baseUrl = String(process.env.SPEECH_TO_TEXT_URL || '').replace(/\/+$/, '')
    const url = String(process.env.SPEECH_TO_TEXT_HEALTH_URL || `${baseUrl}/health`)
    const started = Date.now()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(healthTimeoutMs()) })
      const latencyMs = Date.now() - started
      const status = response.status === 404 ? 'unknown' : statusForResponse(response.status)
      return {
        ...baseHealth(provider, status, response.status === 404 ? 'Health endpoint is not exposed; transcription smoke test not run.' : `Health endpoint returned HTTP ${response.status}.`),
        checkedAt: new Date().toISOString(),
        latencyMs,
      }
    } catch (error) {
      return {
        ...baseHealth(provider, 'unreachable', error instanceof Error ? error.message.slice(0, 160) : 'Health endpoint is unreachable.'),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      }
    }
  }

  const started = Date.now()
  try {
    const request = requestFor(provider)
    const response = await fetch(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(healthTimeoutMs()),
    })
    const latencyMs = Date.now() - started
    return {
      ...baseHealth(provider, statusForResponse(response.status), `Control-plane endpoint returned HTTP ${response.status}.`),
      checkedAt: new Date().toISOString(),
      latencyMs,
    }
  } catch (error) {
    return {
      ...baseHealth(provider, 'unreachable', error instanceof Error ? error.message.slice(0, 160) : 'Provider endpoint is unreachable.'),
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    }
  }
}

export async function getSpeechProviderHealthSnapshot(options: { force?: boolean } = {}) {
  const now = Date.now()
  if (!options.force && checkedAt && now - checkedAt < cacheTtlMs() && cache.size === supportedProviders.length) {
    return supportedProviders.map((provider) => cache.get(provider) as SpeechProviderHealth)
  }
  if (inFlight) return inFlight

  inFlight = Promise.all(supportedProviders.map(checkProvider)).then((results) => {
    checkedAt = Date.now()
    for (const result of results) cache.set(result.provider, result)
    return results
  }).finally(() => {
    inFlight = null
  })
  return inFlight
}

export function resetSpeechProviderHealthForTests() {
  cache.clear()
  checkedAt = 0
  inFlight = null
}

export function getSpeechProviderHealthSummary() {
  const credentials = getSpeechProviderCredentialStatuses()
  const health = supportedProviders.map((provider) => cache.get(provider)).filter(Boolean) as SpeechProviderHealth[]
  return { credentials, health, checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null }
}
