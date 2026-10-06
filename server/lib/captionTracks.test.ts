import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCaptionTrack } from './captionTracks'

test('normalizes CRLF SRT and the out-of-order Dailymotion cue regression', () => {
  const srt = '\uFEFF1\r\n00:00:24,557 --> 00:00:27,000\r\nLater\r\n\r\n2\r\n00:00:20,593 --> 00:00:45,747\r\nEarlier\r\nsecond line\r\n'
  assert.deepEqual(parseCaptionTrack(srt), [
    { text: 'Earlier second line', start: 20.593, duration: 25.154 },
    { text: 'Later', start: 24.557, duration: 2.4430000000000014 },
  ])
})

test('reads WebVTT cue settings, decodes text and skips notes and invalid durations', () => {
  const track = 'WEBVTT\n\nNOTE example\n00:00.000 --> 00:03.000\nIgnore\n\ncue-id\n01:02.250 --> 01:04.500 align:start position:0%\n<v Speaker>Hello &amp; &#x1F600;</v>\n\n00:70.000 --> 01:11.000\nBad time\n\n00:03.000 --> 00:02.000\nReversed\n\n00:04.000 --> 00:04.000\nZero\n'
  assert.deepEqual(parseCaptionTrack(track), [{ text: 'Hello & 😀', start: 62.25, duration: 2.25 }])
})
