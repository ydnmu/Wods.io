import assert from 'node:assert/strict'
import test from 'node:test'
import { hashPassword, normalizeUsername, validatePassword, verifyPassword } from './passwords'

test('normalizes safe dashboard usernames', () => {
  assert.equal(normalizeUsername('  Easy.Dev  '), 'easy.dev')
  assert.throws(() => normalizeUsername('no spaces allowed'), /invalid_username/)
  assert.throws(() => normalizeUsername('ab'), /invalid_username/)
})

test('hashes and verifies dashboard passwords without storing plaintext', async () => {
  const password = validatePassword('correct horse battery staple')
  const stored = await hashPassword(password)

  assert.match(stored, /^scrypt\$/)
  assert.doesNotMatch(stored, /correct horse/)
  assert.equal(await verifyPassword(password, stored), true)
  assert.equal(await verifyPassword('wrong password', stored), false)
})
