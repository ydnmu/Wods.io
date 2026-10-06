import { Router } from 'express'
import {
  decodeLegacyApiKeyPolicy,
  encodeLegacyApiKeyPolicy,
  generateApiKey,
  hashKey,
  invalidateApiKeyCache,
  parseApiKeyCreationPolicy,
} from '../lib/apiKeys'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { getPlanPolicy } from '../lib/plans'

export const dashboardKeysRouter = Router()

dashboardKeysRouter.get('/', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).apiAccess) {
    response.status(403).json({ error: 'plan_required' })
    return
  }
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, request_limit, requests_used, expires_at, last_used_at, created_at, active')
    .eq('user_id', request.userId)
    .eq('active', true)
    .order('created_at', { ascending: false })

  if (error) {
    const { data: legacy, error: legacyError } = await supabase
      .from('api_keys')
      .select('id, name, last_used_at, created_at, active')
      .eq('user_id', request.userId)
      .eq('active', true)
      .order('created_at', { ascending: false })
    if (legacyError) {
      response.status(500).json({ error: 'db_error' })
      return
    }
    const compatible = await Promise.all((legacy ?? []).map(async (key) => {
      const policy = decodeLegacyApiKeyPolicy(key.name)
      let requestsUsed = 0
      if (policy) {
        const { count } = await supabase
          .from('usage_logs')
          .select('id', { count: 'exact', head: true })
          .eq('api_key_id', key.id)
          .eq('status', 'api_key_request')
        requestsUsed = count ?? 0
      }
      return {
        ...key,
        name: policy?.name || key.name,
        request_limit: policy?.requestLimit ?? null,
        requests_used: requestsUsed,
        expires_at: policy?.expiresAt ?? null,
      }
    }))
    response.json(compatible.map((key) => ({
      id: key.id,
      name: key.name,
      expires_at: key.expires_at,
      last_used_at: key.last_used_at,
      created_at: key.created_at,
      active: key.active,
    })))
    return
  }

  response.json((data ?? []).map((key) => ({
    id: key.id,
    name: key.name,
    expires_at: key.expires_at,
    last_used_at: key.last_used_at,
    created_at: key.created_at,
    active: key.active,
  })))
})

dashboardKeysRouter.post('/', async (request, response) => {
  requireSupabaseConfig()
  if (!getPlanPolicy(request.userPlan).apiAccess) {
    response.status(403).json({ error: 'plan_required' })
    return
  }
  let policy
  try {
    policy = parseApiKeyCreationPolicy(request.body)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_key_policy'
    response.status(400).json({
      error: code,
      message: code === 'invalid_key_name'
        ? 'Enter a key name between 1 and 64 characters.'
        : code === 'invalid_request_limit'
          ? 'Request limit must be a whole number between 1 and 10,000,000.'
          : 'Expiry must be a future date within the next five years.',
    })
    return
  }
  const plainKey = generateApiKey()
  const keyHash = hashKey(plainKey)

  const { error } = await supabase.from('api_keys').insert({
    user_id: request.userId,
    key_hash: keyHash,
    name: policy.name,
    request_limit: policy.requestLimit,
    expires_at: policy.expiresAt,
  })

  if (error) {
    const schemaMissing = error.code === 'PGRST204' || /request_limit|expires_at/i.test(error.message)
    if (schemaMissing) {
      const { error: compatibilityError } = await supabase.from('api_keys').insert({
        user_id: request.userId,
        key_hash: keyHash,
        name: encodeLegacyApiKeyPolicy(policy),
      })
      if (!compatibilityError) {
        response.json({
          key: plainKey,
          name: policy.name,
          expiresAt: policy.expiresAt,
          compatibilityMode: true,
          message: 'Save this key. It will not be shown again.',
        })
        return
      }
    }
    response.status(500).json({ error: 'db_error', message: 'API key could not be created.' })
    return
  }

  response.json({
    key: plainKey,
    name: policy.name,
    expiresAt: policy.expiresAt,
    message: 'Save this key. It will not be shown again.',
  })
})

dashboardKeysRouter.delete('/:id', async (request, response) => {
  requireSupabaseConfig()
  const { data, error } = await supabase
    .from('api_keys')
    .update({ active: false })
    .eq('id', request.params.id)
    .eq('user_id', request.userId)
    .select('key_hash')
    .single()

  if (error || !data) {
    response.status(404).json({ error: 'not_found' })
    return
  }

  await invalidateApiKeyCache(data.key_hash)
  response.json({ success: true })
})
