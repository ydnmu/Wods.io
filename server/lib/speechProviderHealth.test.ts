import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSpeechProviderHealthSnapshot,
  resetSpeechProviderHealthForTests,
} from './speechProviderHealth'

test('reports every free speech provider and checks configured providers', async () => {
  const originalFetch = globalThis.fetch
  const originalGroqKey = process.env.GROQ_API_KEY
  const providerKeys = ['CLOUDFLARE_AI_API_TOKEN', 'FIREWORKS_API_KEY', 'DEEPGRAM_API_KEY', 'ASSEMBLYAI_API_KEY', 'SPEECH_TO_TEXT_URL']
  process.env.GROQ_API_KEY = 'test-provider-key'
  for (const key of providerKeys) delete process.env[key]
  resetSpeechProviderHealthForTests()

  let observedUrl = ''
  globalThis.fetch = (async (input) => {
    observedUrl = String(input)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await getSpeechProviderHealthSnapshot({ force: true })
    assert.equal(result.length, 6)
    assert.equal(result.find((item) => item.provider === 'groq')?.status, 'healthy')
    assert.equal(result.find((item) => item.provider === 'groq')?.freeRoute, true)
    assert.equal(result.find((item) => item.provider === 'cloudflare')?.status, 'not_configured')
    assert.equal(observedUrl, 'https://api.groq.com/openai/v1/models')
  } finally {
    globalThis.fetch = originalFetch
    if (originalGroqKey == null) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = originalGroqKey
    resetSpeechProviderHealthForTests()
  }
})

test('surfaces provider authentication failures without exposing credentials', async () => {
  const originalFetch = globalThis.fetch
  const originalGroqKey = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'test-provider-key'
  resetSpeechProviderHealthForTests()
  globalThis.fetch = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch

  try {
    const result = await getSpeechProviderHealthSnapshot({ force: true })
    const groq = result.find((item) => item.provider === 'groq')
    assert.equal(groq?.status, 'unauthorized')
    assert.equal(groq?.detail.includes('test-provider-key'), false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalGroqKey == null) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = originalGroqKey
    resetSpeechProviderHealthForTests()
  }
})
