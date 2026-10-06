type RpcError = { code?: string; message?: string }
type ReadonlyRpcProbe = (name: string, parameters: Record<string, string>) => PromiseLike<{ error: RpcError | null }>

export type RuntimeSchemaReadiness = {
  ok: boolean
  missingRpcs: string[]
  failedRpcs: string[]
}

// These functions are read-only. Never use quota reservation or key-consumption
// functions as health probes: host checks must not spend customer allowance.
const readonlyContracts = [
  { name: 'validate_api_key', parameters: { p_key_hash: '0'.repeat(64) } },
  { name: 'get_workspace_monthly_usage', parameters: { p_user_id: '00000000-0000-0000-0000-000000000000' } },
] as const

export async function probeReadonlyRpcContracts(probe: ReadonlyRpcProbe): Promise<RuntimeSchemaReadiness> {
  const results = await Promise.all(readonlyContracts.map(async ({ name, parameters }) => {
    try {
      const { error } = await probe(name, parameters)
      if (!error) return { name, state: 'ready' as const }
      const missing = error.code === 'PGRST202' || error.code === '42883'
      return { name, state: missing ? 'missing' as const : 'failed' as const }
    } catch {
      return { name, state: 'failed' as const }
    }
  }))
  return {
    ok: results.every(result => result.state === 'ready'),
    missingRpcs: results.filter(result => result.state === 'missing').map(result => result.name),
    failedRpcs: results.filter(result => result.state === 'failed').map(result => result.name),
  }
}
