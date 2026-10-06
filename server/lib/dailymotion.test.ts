import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchDailymotionCaptions } from './dailymotion'

test('recognizes removed Dailymotion videos inside an HTTP 200 metadata response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { type: 'not_found', code: '404' } }))
  await assert.rejects(fetchDailymotionCaptions('x20su5f'), { message: 'source_unavailable' })
})

test('returns ordered Dailymotion captions from a real-world SRT timing regression', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).includes('metadata')
    ? Response.json({ subtitles: { data: { en: { urls: ['https://captions.example.test/track.srt'] } } } })
    : new Response('1\r\n00:00:24,557 --> 00:00:27,000\r\nLater\r\n\r\n2\r\n00:00:20,593 --> 00:00:45,747\r\nEarlier\r\n'))
  const segments = await fetchDailymotionCaptions('xczg00')
  assert.equal(segments.length, 2)
  assert.deepEqual(segments.map(segment => segment.start), [20.593, 24.557])
})
