import assert from 'node:assert/strict'
import test from 'node:test'
import { getSpeechProviderOrder } from './speechToText'

const originalEnv = { ...process.env }
const providerKeys = [
  'GROQ_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_AI_API_TOKEN',
  'FIREWORKS_API_KEY',
  'DEEPGRAM_API_KEY',
  'ASSEMBLYAI_API_KEY',
  'SPEECH_TO_TEXT_URL',
  'SPEECH_PROVIDER_ORDER_FREE',
  'SPEECH_PROVIDER_ORDER_PAID',
]

test.afterEach(() => {
  process.env = { ...originalEnv }
})

const clearProviders = () => providerKeys.forEach((key) => delete process.env[key])

test('routes free transcription through the configured free pool order', () => {
  clearProviders()
  process.env.GROQ_API_KEY = 'groq-key'
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account'
  process.env.CLOUDFLARE_AI_API_TOKEN = 'cloudflare-key'
  process.env.ASSEMBLYAI_API_KEY = 'assembly-key'
  process.env.FIREWORKS_API_KEY = 'fireworks-key'
  assert.deepEqual(getSpeechProviderOrder('free'), ['groq', 'cloudflare', 'fireworks', 'assemblyai'])
})

test('routes paid transcription through Fireworks with AssemblyAI failover', () => {
  clearProviders()
  process.env.ASSEMBLYAI_API_KEY = 'assembly-key'
  process.env.FIREWORKS_API_KEY = 'fireworks-key'
  process.env.SPEECH_PROVIDER_ORDER_FREE = 'fireworks,assemblyai'
  assert.deepEqual(getSpeechProviderOrder('api'), ['fireworks', 'assemblyai'])
  assert.deepEqual(getSpeechProviderOrder('business'), ['fireworks', 'assemblyai'])
})

test('keeps paid fallback available when only AssemblyAI is configured', () => {
  clearProviders()
  process.env.ASSEMBLYAI_API_KEY = 'assembly-key'
  assert.deepEqual(getSpeechProviderOrder('business'), ['assemblyai'])
})
