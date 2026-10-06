import crypto from 'node:crypto'
import { hasSupabaseConfig, supabase } from './supabase'
import type { BudgetedSpeechProvider } from './speechProviderBudget'

type SpeechCredential = {
  apiKey?: string
  accountId?: string
}

type StoredCredentialRow = {
  provider: BudgetedSpeechProvider
  ciphertext: string
  iv: string
  auth_tag: string
  fingerprint: string
  updated_at: string
}

const supportedProviders: BudgetedSpeechProvider[] = [
  'groq',
  'cloudflare',
  'fireworks',
  'deepgram',
  'assemblyai',
  'worker',
]

const runtimeCredentials = new Map<BudgetedSpeechProvider, SpeechCredential>()
const storedMetadata = new Map<BudgetedSpeechProvider, Pick<StoredCredentialRow, 'fingerprint' | 'updated_at'>>()

const secretFor = (provider: BudgetedSpeechProvider): SpeechCredential => {
  const runtime = runtimeCredentials.get(provider)
  if (runtime) return runtime
  switch (provider) {
    case 'groq': return { apiKey: process.env.GROQ_API_KEY }
    case 'cloudflare': return { apiKey: process.env.CLOUDFLARE_AI_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID }
    case 'fireworks': return { apiKey: process.env.FIREWORKS_API_KEY }
    case 'deepgram': return { apiKey: process.env.DEEPGRAM_API_KEY }
    case 'assemblyai': return { apiKey: process.env.ASSEMBLYAI_API_KEY }
    case 'worker': return { apiKey: process.env.SPEECH_TO_TEXT_API_KEY }
  }
}

const encryptionKey = () => {
  const secret = String(process.env.PROVIDER_KEY_ENCRYPTION_SECRET || '')
  if (secret.length < 32) throw new Error('provider_key_encryption_secret_required')
  return crypto.scryptSync(secret, 'easytran/provider-credentials/v1', 32)
}

const encrypt = (credential: SpeechCredential) => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), 'utf8'),
    cipher.final(),
  ])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

const decrypt = (row: StoredCredentialRow): SpeechCredential => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as SpeechCredential
}

const fingerprint = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 10)

export const isSpeechProvider = (value: unknown): value is BudgetedSpeechProvider =>
  supportedProviders.includes(String(value || '').toLowerCase() as BudgetedSpeechProvider)

export function getSpeechProviderCredential(provider: BudgetedSpeechProvider) {
  return secretFor(provider)
}

export function speechProviderConfigured(provider: BudgetedSpeechProvider) {
  const credential = secretFor(provider)
  if (provider === 'worker') return Boolean(process.env.SPEECH_TO_TEXT_URL)
  if (provider === 'cloudflare') return Boolean(credential.apiKey && credential.accountId)
  return Boolean(credential.apiKey)
}

export function getSpeechProviderCredentialStatuses() {
  return supportedProviders.map((provider) => {
    const credential = secretFor(provider)
    const stored = storedMetadata.get(provider)
    const configured = speechProviderConfigured(provider)
    return {
      provider,
      configured,
      source: stored ? 'admin' : configured ? 'environment' : 'missing',
      fingerprint: stored?.fingerprint || (credential.apiKey ? fingerprint(credential.apiKey) : null),
      updatedAt: stored?.updated_at || null,
      accountIdConfigured: provider === 'cloudflare' ? Boolean(credential.accountId) : undefined,
    }
  })
}

export async function hydrateSpeechProviderCredentials() {
  if (!hasSupabaseConfig() || !process.env.PROVIDER_KEY_ENCRYPTION_SECRET) return
  const { data, error } = await supabase
    .from('speech_provider_credentials')
    .select('provider, ciphertext, iv, auth_tag, fingerprint, updated_at')
    .eq('active', true)
  if (error) {
    if (/speech_provider_credentials/i.test(error.message)) {
      console.warn('[speech-credentials] migration missing; using environment credentials')
      return
    }
    throw new Error(`speech_credentials_load_failed: ${error.message}`)
  }
  for (const row of (data || []) as StoredCredentialRow[]) {
    if (!isSpeechProvider(row.provider)) continue
    runtimeCredentials.set(row.provider, decrypt(row))
    storedMetadata.set(row.provider, { fingerprint: row.fingerprint, updated_at: row.updated_at })
  }
}

export async function saveSpeechProviderCredential(params: {
  provider: BudgetedSpeechProvider
  apiKey: string
  accountId?: string
  updatedBy?: string | null
}) {
  if (params.provider === 'worker') throw new Error('worker_credential_override_not_supported')
  if (!hasSupabaseConfig()) throw new Error('database_not_configured')
  const apiKey = params.apiKey.trim()
  const accountId = params.accountId?.trim()
  if (apiKey.length < 12) throw new Error('invalid_provider_key')
  if (params.provider === 'cloudflare' && !accountId) throw new Error('cloudflare_account_id_required')

  const credential: SpeechCredential = { apiKey, ...(accountId ? { accountId } : {}) }
  await validateSpeechProviderCredential(params.provider, credential)
  const encrypted = encrypt(credential)
  const keyFingerprint = fingerprint(apiKey)
  const updatedAt = new Date().toISOString()
  const { error } = await supabase.from('speech_provider_credentials').upsert({
    provider: params.provider,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
    fingerprint: keyFingerprint,
    active: true,
    updated_by: params.updatedBy || null,
    updated_at: updatedAt,
  }, { onConflict: 'provider' })
  if (error) throw new Error(`speech_credentials_save_failed: ${error.message}`)

  runtimeCredentials.set(params.provider, credential)
  storedMetadata.set(params.provider, { fingerprint: keyFingerprint, updated_at: updatedAt })
  return { provider: params.provider, fingerprint: keyFingerprint, updatedAt }
}

export async function validateSpeechProviderCredential(
  provider: Exclude<BudgetedSpeechProvider, 'worker'>,
  credential: SpeechCredential,
) {
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
    deepgram: {
      url: 'https://api.deepgram.com/v1/projects',
      headers: { Authorization: `Token ${apiKey}` },
    },
    assemblyai: {
      url: 'https://api.assemblyai.com/v2/transcript?limit=1',
      headers: { Authorization: apiKey },
    },
    fireworks: {
      url: 'https://api.fireworks.ai/inference/v1/models',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  }
  const request = requests[provider]
  const response = await fetch(request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    throw new Error(`provider_validation_unreachable: ${error instanceof Error ? error.message : 'network_error'}`)
  })
  if (!response.ok) {
    throw new Error(`provider_validation_failed_${response.status}`)
  }
  return true
}

export async function removeSpeechProviderCredential(provider: BudgetedSpeechProvider) {
  if (!hasSupabaseConfig()) throw new Error('database_not_configured')
  const { error } = await supabase
    .from('speech_provider_credentials')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('provider', provider)
  if (error) throw new Error(`speech_credentials_remove_failed: ${error.message}`)
  runtimeCredentials.delete(provider)
  storedMetadata.delete(provider)
}

export function resetSpeechProviderCredentialsForTests() {
  runtimeCredentials.clear()
  storedMetadata.clear()
}
