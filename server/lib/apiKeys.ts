import crypto from 'node:crypto'
import { requireSupabaseConfig, supabase } from './supabase'
import { effectivePlan, isBetaExpired } from './entitlements'

type ConsumedApiKeyRow = {
  key_valid: boolean
  invalid_reason?: string | null
  api_key_id?: string | null
  workspace_user_id?: string | null
  workspace_plan?: string | null
  workspace_access_source?: string | null
  workspace_beta_expires_at?: string | null
  key_request_limit?: number | null
  key_requests_used?: number | null
  key_expires_at?: string | null
}

type LegacyApiKeyRow = {
  id: string
  user_id: string
  name?: string | null
  users?: { plan?: string; access_source?: string | null; beta_expires_at?: string | null } | Array<{ plan?: string; access_source?: string | null; beta_expires_at?: string | null }>
}

const LEGACY_POLICY_PREFIX = '__ETP1__'

export function encodeLegacyApiKeyPolicy(policy: ApiKeyCreationPolicy) {
  const payload = Buffer.from(JSON.stringify(policy), 'utf8').toString('base64url')
  return `${LEGACY_POLICY_PREFIX}${payload}`
}

export function decodeLegacyApiKeyPolicy(value: unknown): ApiKeyCreationPolicy | null {
  const stored = String(value || '')
  if (!stored.startsWith(LEGACY_POLICY_PREFIX)) return null
  try {
    const parsed = JSON.parse(Buffer.from(stored.slice(LEGACY_POLICY_PREFIX.length), 'base64url').toString('utf8'))
    return parseApiKeyCreationPolicy(parsed)
  } catch {
    return null
  }
}

export type ApiKeyValidation = {
  valid: boolean
  reason?: string
  userId?: string
  plan?: string
  apiKeyId?: string
  requestLimit?: number | null
  requestsUsed?: number
  expiresAt?: string | null
}

export type ApiKeyCreationPolicy = {
  name: string
  requestLimit: number | null
  expiresAt: string
}

export function parseApiKeyCreationPolicy(body: unknown): ApiKeyCreationPolicy {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = String(input.name || '').trim()
  const requestLimit = input.requestLimit === undefined || input.requestLimit === null || input.requestLimit === ''
    ? null
    : Number(input.requestLimit)
  const expiresAt = new Date(String(input.expiresAt || ''))
  const latestExpiry = new Date()
  latestExpiry.setUTCFullYear(latestExpiry.getUTCFullYear() + 5)

  if (!name || name.length > 64) throw new Error('invalid_key_name')
  if (requestLimit !== null && (!Number.isSafeInteger(requestLimit) || requestLimit < 1 || requestLimit > 10_000_000)) {
    throw new Error('invalid_request_limit')
  }
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt > latestExpiry) {
    throw new Error('invalid_expiry')
  }

  return { name, requestLimit, expiresAt: expiresAt.toISOString() }
}

export function generateApiKey() {
  const random = crypto.randomBytes(32).toString('base64url')
  return `et_${random}`
}

export function hashKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex')
}

const hasKvConfig = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
const keyTouchTimes = new Map<string, number>()
const KEY_TOUCH_INTERVAL_MS = 15 * 60_000

function touchApiKeyLastUsed(id: string) {
  const now = Date.now()
  if (now - (keyTouchTimes.get(id) || 0) < KEY_TOUCH_INTERVAL_MS) return
  keyTouchTimes.set(id, now)
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date(now).toISOString() })
    .eq('id', id)
    .then(({ error }) => {
      if (error) keyTouchTimes.delete(id)
    })
}

export async function validateApiKey(key: string): Promise<ApiKeyValidation> {
  if (!key.startsWith('et_')) return { valid: false, reason: 'invalid_api_key' }
  requireSupabaseConfig()

  const hash = hashKey(key)
  let { data, error } = await supabase
    .rpc('validate_api_key', { p_key_hash: hash })

  const missingReadOnlyValidator = error?.code === 'PGRST202'
    || error?.code === '42883'
    || /validate_api_key/i.test(error?.message || '')
  if (error && missingReadOnlyValidator) {
    const compatibilityResult = await supabase.rpc('consume_api_key_request', { p_key_hash: hash })
    data = compatibilityResult.data
    error = compatibilityResult.error
  }

  if (error) {
    const missingPolicyFunction = error.code === 'PGRST202' || error.code === '42883' || /consume_api_key_request/i.test(error.message)
    if (!missingPolicyFunction) throw new Error(`api_key_policy_unavailable: ${error.message}`)

    // Deployment compatibility: existing keys keep working until the policy migration is applied.
    // New limited keys are not created without that migration, so this never fakes enforcement.
    const { data: legacy, error: legacyError } = await supabase
      .from('api_keys')
      .select('id, user_id, name, active, users(plan, access_source, beta_expires_at)')
      .eq('key_hash', hash)
      .eq('active', true)
      .single<LegacyApiKeyRow>()
    if (legacyError || !legacy) return { valid: false, reason: 'invalid_api_key' }
    const joinedUser = Array.isArray(legacy.users) ? legacy.users[0] : legacy.users
    if (isBetaExpired(joinedUser || {})) return { valid: false, reason: 'workspace_access_expired' }
    const legacyPolicy = decodeLegacyApiKeyPolicy(legacy.name)
    if (legacyPolicy && new Date(legacyPolicy.expiresAt).getTime() <= Date.now()) {
      await supabase.from('api_keys').update({ active: false }).eq('id', legacy.id)
      return { valid: false, reason: 'expired_api_key' }
    }
    let requestsUsed = 0
    if (legacyPolicy) {
      const { count } = await supabase
        .from('usage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('api_key_id', legacy.id)
        .eq('status', 'api_key_request')
      requestsUsed = count ?? 0
      if (legacyPolicy.requestLimit !== null && requestsUsed >= legacyPolicy.requestLimit) {
        return { valid: false, reason: 'api_key_limit_exceeded' }
      }
    }
    await supabase.from('usage_logs').insert({
      api_key_id: legacy.id,
      user_id: legacy.user_id,
      video_id: null,
      endpoint: 'api-key',
      status: 'api_key_request',
    })
    touchApiKeyLastUsed(legacy.id)
    return {
      valid: true,
      userId: legacy.user_id,
      plan: effectivePlan(joinedUser || {}),
      apiKeyId: legacy.id,
      requestLimit: legacyPolicy?.requestLimit ?? null,
      requestsUsed: requestsUsed + 1,
      expiresAt: legacyPolicy?.expiresAt ?? null,
    }
  }
  const record = (Array.isArray(data) ? data[0] : data) as ConsumedApiKeyRow | null
  if (!record?.key_valid || !record.workspace_user_id) {
    return { valid: false, reason: record?.invalid_reason || 'invalid_api_key' }
  }
  if (record.api_key_id) touchApiKeyLastUsed(record.api_key_id)

  return {
    valid: true,
    userId: record.workspace_user_id,
    plan: effectivePlan({
      plan: record.workspace_plan,
      access_source: record.workspace_access_source,
      beta_expires_at: record.workspace_beta_expires_at,
    }),
    apiKeyId: record.api_key_id || undefined,
    requestLimit: record.key_request_limit,
    requestsUsed: Number(record.key_requests_used || 0),
    expiresAt: record.key_expires_at,
  }
}

export async function invalidateApiKeyCache(keyHash: string) {
  if (!hasKvConfig()) return
  const { kv } = await import('@vercel/kv')
  await kv.del(`apikey:${keyHash}`).catch(() => {})
}
