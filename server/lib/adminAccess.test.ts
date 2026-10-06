import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN_SESSION_MAX_AGE_MS,
  canUseLocalAdminTunnelBypass,
  canUseLocalDevAdminBypass,
  createAdminSessionToken,
  hashAdminAccessKey,
  verifyAdminAccessKey,
  verifyAdminSessionToken,
} from './adminAccess'

test('local admin bypass is restricted to explicit development loopback requests', () => {
  assert.equal(canUseLocalDevAdminBypass({ nodeEnv: 'development', enabled: 'true', remoteAddress: '127.0.0.1', hostname: 'localhost' }), true)
  assert.equal(canUseLocalDevAdminBypass({ nodeEnv: 'development', enabled: 'true', remoteAddress: '::1', hostname: '::1' }), true)
  assert.equal(canUseLocalDevAdminBypass({ nodeEnv: 'production', enabled: 'true', remoteAddress: '127.0.0.1', hostname: 'localhost' }), false)
  assert.equal(canUseLocalDevAdminBypass({ nodeEnv: 'development', enabled: 'true', remoteAddress: '127.0.0.1', hostname: '192.168.1.10' }), false)
  assert.equal(canUseLocalDevAdminBypass({ nodeEnv: 'development', enabled: 'false', remoteAddress: '127.0.0.1', hostname: 'localhost' }), false)
})

test('production local admin bypass requires the explicit tunnel flag and loopback', () => {
  assert.equal(canUseLocalAdminTunnelBypass({ nodeEnv: 'production', enabled: 'true', remoteAddress: '127.0.0.1' }), true)
  assert.equal(canUseLocalAdminTunnelBypass({ nodeEnv: 'production', enabled: 'true', remoteAddress: '::ffff:127.0.0.1' }), true)
  assert.equal(canUseLocalAdminTunnelBypass({ nodeEnv: 'production', enabled: 'true', remoteAddress: '203.0.113.10' }), false)
  assert.equal(canUseLocalAdminTunnelBypass({ nodeEnv: 'production', enabled: 'false', remoteAddress: '127.0.0.1' }), false)
  assert.equal(canUseLocalAdminTunnelBypass({ nodeEnv: 'development', enabled: 'true', remoteAddress: '127.0.0.1' }), false)
})

test('accepts only the configured long admin key', () => {
  const key = 'a'.repeat(64)
  const hash = hashAdminAccessKey(key)
  assert.equal(verifyAdminAccessKey(key, hash), true)
  assert.equal(verifyAdminAccessKey(`${key}x`, hash), false)
  assert.equal(verifyAdminAccessKey('short', hash), false)
  assert.equal(verifyAdminAccessKey(key, 'not-a-hash'), false)
})

test('creates signed, expiring admin sessions', () => {
  const secret = 'session-secret-'.repeat(4)
  const now = Date.now()
  const token = createAdminSessionToken(secret, now)
  assert.equal(verifyAdminSessionToken(token, secret, now + 1000), true)
  assert.equal(verifyAdminSessionToken(token, `${secret}wrong`, now + 1000), false)
  assert.equal(verifyAdminSessionToken(token, secret, now + ADMIN_SESSION_MAX_AGE_MS), false)
  assert.equal(verifyAdminSessionToken(`${token}tampered`, secret, now + 1000), false)
})
