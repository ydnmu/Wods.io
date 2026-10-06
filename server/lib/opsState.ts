import { createHash, randomBytes } from 'node:crypto'
import { hasSupabaseConfig, supabase } from './supabase'

export type OperationsMode = 'live' | 'maintenance' | 'security'

type FlaggedClient = {
  fingerprint: string
  hits: number
  route: string
  lastSeenAt: string
}

let mode: OperationsMode = process.env.MAINTENANCE_MODE === 'true' ? 'maintenance' : 'live'
let changedAt = new Date().toISOString()
const flaggedClients = new Map<string, FlaggedClient>()
// An omitted configuration must not make visitor hashes reproducible using a
// public constant. A configured salt keeps incident grouping across restarts.
const fingerprintSalt = process.env.OPS_FINGERPRINT_SALT || randomBytes(32).toString('hex')

const fingerprintFor = (ip: string) => createHash('sha256')
  .update(`${fingerprintSalt}:${ip}`)
  .digest('hex')
  .slice(0, 12)

export function getOperationsState() {
  return { mode, changedAt }
}

export async function hydrateOperationsState() {
  if (!hasSupabaseConfig()) return getOperationsState()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('key', 'operations_mode')
    .maybeSingle()
  if (error) {
    if (/app_settings|schema cache/i.test(error.message)) return getOperationsState()
    throw error
  }
  const persisted = String(data?.value || '')
  if (['live', 'maintenance', 'security'].includes(persisted)) mode = persisted as OperationsMode
  if (data?.updated_at) changedAt = data.updated_at
  return getOperationsState()
}

export async function setOperationsMode(nextMode: OperationsMode, updatedBy?: string | null) {
  const previousMode = mode
  const previousChangedAt = changedAt
  mode = nextMode
  changedAt = new Date().toISOString()

  if (!hasSupabaseConfig()) return getOperationsState()
  const { error } = await supabase.from('app_settings').upsert({
    key: 'operations_mode',
    value: nextMode,
    updated_by: updatedBy || null,
    updated_at: changedAt,
  }, { onConflict: 'key' })
  if (error) {
    mode = previousMode
    changedAt = previousChangedAt
    throw new Error(`operations_mode_save_failed: ${error.message}`)
  }
  return getOperationsState()
}

export function recordRateLimitedClient(ip: string, route: string) {
  const fingerprint = fingerprintFor(ip || 'unknown')
  const existing = flaggedClients.get(fingerprint)
  const incident = {
    fingerprint,
    hits: (existing?.hits || 0) + 1,
    route,
    lastSeenAt: new Date().toISOString(),
  }
  flaggedClients.set(fingerprint, incident)
  if (hasSupabaseConfig()) {
    void supabase.from('rate_limit_incidents').insert({
      fingerprint,
      route,
      occurred_at: incident.lastSeenAt,
    }).then(({ error }) => {
      if (error && !/rate_limit_incidents|schema cache/i.test(error.message)) {
        console.error('[operations] rate-limit incident persistence failed:', error.message)
      }
    })
  }
}

export function getFlaggedClients() {
  return [...flaggedClients.values()]
    .sort((left, right) => right.hits - left.hits || right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, 50)
}
