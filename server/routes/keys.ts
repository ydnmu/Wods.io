import { Router } from 'express'
import { generateApiKey, hashKey, invalidateApiKeyCache, parseApiKeyCreationPolicy } from '../lib/apiKeys'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'

export const keysRouter = Router()

keysRouter.get('/', requireAuth, async (request, response) => {
  requireSupabaseConfig()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, request_limit, requests_used, expires_at, last_used_at, created_at, active')
    .eq('user_id', request.userId)
    .order('created_at', { ascending: false })

  if (error) {
    const { data: legacy, error: legacyError } = await supabase
      .from('api_keys')
      .select('id, name, last_used_at, created_at, active')
      .eq('user_id', request.userId)
      .order('created_at', { ascending: false })
    if (legacyError) {
      response.status(500).json({ error: 'db_error' })
      return
    }
    response.json((legacy ?? []).map((key) => ({ ...key, request_limit: null, requests_used: 0, expires_at: null })))
    return
  }

  response.json(data)
})

keysRouter.post('/', requireAuth, async (request, response) => {
  requireSupabaseConfig()
  let policy
  try {
    policy = parseApiKeyCreationPolicy(request.body)
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'invalid_key_policy' })
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
    response.status(schemaMissing ? 503 : 500).json({
      error: schemaMissing ? 'api_key_policy_schema_required' : 'db_error',
      message: schemaMissing ? 'Apply the latest database migration before creating controlled keys.' : 'API key could not be created.',
    })
    return
  }

  response.json({
    key: plainKey,
    name: policy.name,
    requestLimit: policy.requestLimit,
    expiresAt: policy.expiresAt,
    message: 'Save this key. It will not be shown again.',
  })
})

keysRouter.delete('/:id', requireAuth, async (request, response) => {
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
