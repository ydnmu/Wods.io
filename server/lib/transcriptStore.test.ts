import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTranscriptDuration } from './transcriptStore'

test('keeps a real metadata duration', () => {
  assert.equal(resolveTranscriptDuration('12:34', [{ text: 'test', start: 0, duration: 2 }]), '12:34')
})

test('derives duration from transcript segments when metadata has none', () => {
  assert.equal(resolveTranscriptDuration('0:00', [
    { text: 'first', start: 0, duration: 4 },
    { text: 'last', start: 598.1, duration: 3.6 },
  ]), '10:02')
})
