import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getProviderBudget,
  reserveSpeechProviderBudget,
  resetSpeechProviderBudgetMemoryForTests,
} from './speechProviderBudget'

test('uses the documented recurring free audio budgets', () => {
  process.env.SPEECH_PROVIDER_FREE_ONLY = 'true'
  delete process.env.GROQ_FREE_AUDIO_MINUTES_PER_DAY
  delete process.env.CLOUDFLARE_FREE_AUDIO_MINUTES_PER_DAY
  assert.equal(getProviderBudget('groq').dailySeconds, 480 * 60)
  assert.equal(getProviderBudget('cloudflare').dailySeconds, 214 * 60)
})

test('stops a provider before its process-local free budget is exceeded', async () => {
  resetSpeechProviderBudgetMemoryForTests()
  process.env.SPEECH_BUDGET_FORCE_MEMORY = 'true'
  process.env.SPEECH_PROVIDER_FREE_ONLY = 'true'
  process.env.GROQ_FREE_AUDIO_MINUTES_PER_DAY = '1'

  const first = await reserveSpeechProviderBudget('groq', 40)
  assert.ok(first)
  await first.release('success')
  assert.equal(await reserveSpeechProviderBudget('groq', 21), null)
})

test('returns failed reservations to the process-local free budget', async () => {
  resetSpeechProviderBudgetMemoryForTests()
  process.env.SPEECH_BUDGET_FORCE_MEMORY = 'true'
  process.env.SPEECH_PROVIDER_FREE_ONLY = 'true'
  process.env.CLOUDFLARE_FREE_AUDIO_MINUTES_PER_DAY = '1'

  const failed = await reserveSpeechProviderBudget('cloudflare', 60)
  assert.ok(failed)
  await failed.release('error')
  assert.ok(await reserveSpeechProviderBudget('cloudflare', 60))
})
