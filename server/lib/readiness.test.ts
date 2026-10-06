import assert from 'node:assert/strict'
import test from 'node:test'
import { probeReadonlyRpcContracts } from './readiness'

test('readiness uses only read-only RPCs with nonexistent key and workspace', async () => {
  const calls: Array<{ name: string; parameters: Record<string, string> }> = []
  const result = await probeReadonlyRpcContracts(async (name, parameters) => {
    calls.push({ name, parameters })
    return { error: null }
  })
  assert.deepEqual(result, { ok: true, missingRpcs: [], failedRpcs: [] })
  assert.deepEqual(calls, [
    { name: 'validate_api_key', parameters: { p_key_hash: '0'.repeat(64) } },
    { name: 'get_workspace_monthly_usage', parameters: { p_user_id: '00000000-0000-0000-0000-000000000000' } },
  ])
})

test('readiness distinguishes missing schema from unavailable database', async () => {
  const result = await probeReadonlyRpcContracts(async name => ({
    error: name === 'validate_api_key' ? { code: 'PGRST202' } : { code: '57014' },
  }))
  assert.deepEqual(result, {
    ok: false,
    missingRpcs: ['validate_api_key'],
    failedRpcs: ['get_workspace_monthly_usage'],
  })
})

test('readiness fails closed on thrown transport errors without exposing details', async () => {
  const result = await probeReadonlyRpcContracts(async () => { throw new Error('private connection detail') })
  assert.equal(result.ok, false)
  assert.deepEqual(result.failedRpcs, ['validate_api_key', 'get_workspace_monthly_usage'])
  assert.equal(JSON.stringify(result).includes('private'), false)
})
