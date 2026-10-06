import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSpeechProviderCredential } from './speechProviderCredentials'

test('validates a provider key before activation', async () => {
  const originalFetch = globalThis.fetch
  let observedUrl = ''
  let observedAuthorization = ''
  globalThis.fetch = (async (input, init) => {
    observedUrl = String(input)
    observedAuthorization = String((init?.headers as Record<string, string>)?.Authorization || '')
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }) as typeof fetch

  try {
    await validateSpeechProviderCredential('groq', { apiKey: 'test-provider-key' })
    assert.equal(observedUrl, 'https://api.groq.com/openai/v1/models')
    assert.equal(observedAuthorization, 'Bearer test-provider-key')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects a provider key that fails authentication', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch
  try {
    await assert.rejects(
      validateSpeechProviderCredential('deepgram', { apiKey: 'invalid-provider-key' }),
      /provider_validation_failed_401/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('includes the Cloudflare account in credential validation', async () => {
  const originalFetch = globalThis.fetch
  let observedUrl = ''
  globalThis.fetch = (async (input) => {
    observedUrl = String(input)
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }) as typeof fetch
  try {
    await validateSpeechProviderCredential('cloudflare', {
      apiKey: 'test-provider-key',
      accountId: 'account/id',
    })
    assert.match(observedUrl, /accounts\/account%2Fid\/ai\/models\/search/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
