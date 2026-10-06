import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const KEY_LENGTH = 64

export function normalizeUsername(value: unknown) {
  const username = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('invalid_username')
  }
  return username
}

export function validatePassword(value: unknown) {
  const password = String(value || '')
  if (password.length < 10 || password.length > 128) {
    throw new Error('invalid_password')
  }
  return password
}

export async function hashPassword(passwordInput: unknown) {
  const password = validatePassword(passwordInput)
  const salt = crypto.randomBytes(16)
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(passwordInput: unknown, storedHash: unknown) {
  const password = String(passwordInput || '')
  const [scheme, encodedSalt, encodedHash] = String(storedHash || '').split('$')
  if (scheme !== 'scrypt' || !encodedSalt || !encodedHash || password.length > 128) return false

  try {
    const salt = Buffer.from(encodedSalt, 'base64url')
    const expected = Buffer.from(encodedHash, 'base64url')
    const actual = await scrypt(password, salt, expected.length) as Buffer
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
