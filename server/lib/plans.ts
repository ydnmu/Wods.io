export type AppPlan = 'free' | 'api' | 'business' | 'custom'

export type PlanPolicy = {
  transcriptsLimit: number | null
  captionSecondsLimit: number | null
  aiFallbackSecondsLimit: number | null
  maxWebhooks: number
  maxChannels: number
  maxBatchUrls: number
  apiAccess: boolean
  batch: boolean
  channelSync: boolean
  transcriptArchive: boolean
}

export const PLAN_POLICIES: Record<AppPlan, PlanPolicy> = {
  free: {
    transcriptsLimit: null,
    captionSecondsLimit: null,
    aiFallbackSecondsLimit: null,
    maxWebhooks: 0,
    maxChannels: 0,
    maxBatchUrls: 0,
    apiAccess: false,
    batch: false,
    channelSync: false,
    transcriptArchive: false,
  },
  api: {
    transcriptsLimit: 10_000,
    captionSecondsLimit: 1_000 * 60 * 60,
    aiFallbackSecondsLimit: 50 * 60 * 60,
    maxWebhooks: 3,
    maxChannels: 0,
    maxBatchUrls: 0,
    apiAccess: true,
    batch: false,
    channelSync: false,
    transcriptArchive: false,
  },
  business: {
    transcriptsLimit: 100_000,
    captionSecondsLimit: 10_000 * 60 * 60,
    aiFallbackSecondsLimit: 500 * 60 * 60,
    maxWebhooks: 20,
    maxChannels: 10,
    maxBatchUrls: 1_000,
    apiAccess: true,
    batch: true,
    channelSync: true,
    transcriptArchive: true,
  },
  custom: {
    transcriptsLimit: null,
    captionSecondsLimit: null,
    aiFallbackSecondsLimit: null,
    maxWebhooks: -1,
    maxChannels: -1,
    maxBatchUrls: -1,
    apiAccess: true,
    batch: true,
    channelSync: true,
    transcriptArchive: true,
  },
}

const LEGACY_PLAN_MAP: Record<string, AppPlan> = {
  pro: 'api',
}

export function normalizePlan(plan?: string | null): AppPlan {
  const value = String(plan || 'free').toLowerCase()
  if (value in PLAN_POLICIES) return value as AppPlan
  return LEGACY_PLAN_MAP[value] ?? 'free'
}

export function getPlanPolicy(plan?: string | null) {
  return PLAN_POLICIES[normalizePlan(plan)]
}

export function isWithinLimit(current: number, maximum: number) {
  return maximum < 0 || current < maximum
}

export function shouldStoreTranscript(plan?: string | null) {
  return getPlanPolicy(plan).transcriptArchive
}
