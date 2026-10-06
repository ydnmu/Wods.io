import assert from 'node:assert/strict'
import test from 'node:test'
import { estimatePaidBatchTiming, PAID_BATCH_CONCURRENCY } from './sourceInspector'

test('estimates paid caption batches using the configured parallel capacity', () => {
  const result = estimatePaidBatchTiming(706, 0, 0)
  assert.equal(PAID_BATCH_CONCURRENCY, 6)
  assert.equal(result.estimatedCaptionProcessingMinutes, 5)
  assert.equal(result.estimatedAiFallbackProcessingMinutes, 0)
  assert.equal(result.estimatedMinutes, 5)
})

test('adds realtime-weighted AI fallback work to the paid estimate', () => {
  const result = estimatePaidBatchTiming(677, 29, 29 * 15 * 60)
  assert.equal(result.estimatedCaptionProcessingMinutes, 5)
  assert.equal(result.estimatedAiFallbackProcessingMinutes, 10)
  assert.equal(result.estimatedMinutes, 15)
})
