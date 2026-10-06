import crypto from 'node:crypto'

export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000

export const hashAdminAccessKey = (key: string) => crypto
  .createHash('sha256')
  .update(key)
  .digest('hex')

export function verifyAdminAccessKey(key: string, configuredHash: string) {
  const validHash = /^[a-f0-9]{64}$/i.test(configuredHash)
  const expected = validHash ? Buffer.from(configuredHash, 'hex') : Buffer.alloc(32)
  const supplied = Buffer.from(hashAdminAccessKey(key), 'hex')
  return key.length >= 48 && validHash && crypto.timingSafeEqual(supplied, expected)
}

const sign = (payload: string, secret: string) => crypto
  .createHmac('sha256', secret)
  .update(payload)
  .digest('base64url')

export function createAdminSessionToken(secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error('admin_session_secret_missing')
  const payload = `${now}.${now + ADMIN_SESSION_MAX_AGE_MS}.${crypto.randomBytes(24).toString('base64url')}`
  return `${payload}.${sign(payload, secret)}`
}

export function verifyAdminSessionToken(token: string, secret: string, now = Date.now()) {
  if (secret.length < 32) return false
  const parts = token.split('.')
  if (parts.length !== 4) return false
  const [issuedRaw, expiresRaw, nonce, signature] = parts
  const issuedAt = Number(issuedRaw)
  const expiresAt = Number(expiresRaw)
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || nonce.length < 24) return false
  if (issuedAt > now + 60_000 || expiresAt <= now || expiresAt - issuedAt !== ADMIN_SESSION_MAX_AGE_MS) return false
  const expected = Buffer.from(sign(`${issuedRaw}.${expiresRaw}.${nonce}`, secret))
  const supplied = Buffer.from(signature)
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)
}

export function isLoopbackAddress(value?: string) {
  const address = String(value || '').toLowerCase()
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

// Production access is intentionally opt-in. The only supported production
// caller is an SSH local-port forward, which the API sees as loopback.
export function canUseLocalAdminTunnelBypass(params: {
  nodeEnv?: string
  enabled?: string
  remoteAddress?: string
}) {
  return params.nodeEnv === 'production'
    && params.enabled === 'true'
    && isLoopbackAddress(params.remoteAddress)
}

export function canUseLocalDevAdminBypass(params: {
  nodeEnv?: string
  enabled?: string
  remoteAddress?: string
  hostname?: string
}) {
  if (params.nodeEnv === 'production' || params.enabled !== 'true') return false

  const hostname = String(params.hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  const loopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

  return isLoopbackAddress(params.remoteAddress) && loopbackHost
}
