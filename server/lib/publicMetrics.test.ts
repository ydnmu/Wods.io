import assert from 'node:assert/strict'
import test from 'node:test'
import { getPublicTranscriptMetrics, recordPublicTranscriptMetric, type PublicMetricDependencies } from './publicMetrics'

const source = (overrides: Partial<PublicMetricDependencies> = {}): PublicMetricDependencies => ({
  configured: () => true,
  readCount: async () => 1000,
  readRecentDurations: async () => [1200, 2400, 3600],
  recordCompletion: async () => 1001,
  ...overrides,
})

test('public metrics keep the lifetime count but average only recent successful request timings', async () => {
  assert.deepEqual(await getPublicTranscriptMetrics(source()), { transcriptCount: 1000, averageResponseMs: 2400 })
  assert.deepEqual(await getPublicTranscriptMetrics(source({ readRecentDurations: async () => [400, 600] })),
    { transcriptCount: 1000, averageResponseMs: 500 })
})

test('no recent samples produce an unavailable average, without a fabricated duration', async () => {
  assert.deepEqual(await getPublicTranscriptMetrics(source({ readCount: async () => 0, readRecentDurations: async () => [] })),
    { transcriptCount: 0, averageResponseMs: null })
  assert.equal((await getPublicTranscriptMetrics(source({ readRecentDurations: async () => [] }))).averageResponseMs, null)
})

test('invalid durations cannot contaminate the recent average and invalid totals fail closed', async () => {
  assert.equal((await getPublicTranscriptMetrics(source({ readRecentDurations: async () => [NaN, Infinity, -1, 0, 1200] }))).averageResponseMs, 1200)
  await assert.rejects(getPublicTranscriptMetrics(source({ readCount: async () => NaN })), /invalid_count/)
})

test('missing configuration or a failed source never returns a fake zero metric', async () => {
  const unavailable = source({ configured: () => false })
  await assert.rejects(getPublicTranscriptMetrics(unavailable), /unavailable/)
  await assert.rejects(recordPublicTranscriptMetric(1200, 'completion', unavailable), /unavailable/)
  await assert.rejects(getPublicTranscriptMetrics(source({ readRecentDurations: async () => { throw new Error('read failed') } })), /read failed/)
})

test('completion uses the idempotent backend count and the updated recent sample', async () => {
  const calls: Array<[number, string]> = []
  const backend = source({ recordCompletion: async (duration, id) => { calls.push([duration, id]); return 1001 } })
  const first = await recordPublicTranscriptMetric(1820.4, 'same-completion', backend)
  const duplicate = await recordPublicTranscriptMetric(1820.4, 'same-completion', backend)
  assert.deepEqual(first, { transcriptCount: 1001, averageResponseMs: 2400 })
  assert.deepEqual(duplicate, first)
  assert.deepEqual(calls, [[1820, 'same-completion'], [1820, 'same-completion']])
  await assert.rejects(recordPublicTranscriptMetric(NaN, 'completion', backend), /invalid_response_ms/)
})
