import assert from 'node:assert/strict'
import test from 'node:test'
import { extractBilibiliId, fetchBilibiliCaptions, normalizeSubtitleBody } from './bilibili'

test('extracts supported Bilibili URL variants without accepting lookalike hosts', () => {
  assert.equal(extractBilibiliId('https://www.bilibili.com/video/BV1Wy4y167Z9/'), 'BV1Wy4y167Z9')
  assert.equal(extractBilibiliId('https://m.bilibili.com/video/av647750991'), 'av647750991')
  assert.equal(extractBilibiliId('https://www.bilibili.tv/en/video/2041863208'), 'global:2041863208')
  assert.equal(extractBilibiliId('https://b23.tv/AbCd123'), 'short:AbCd123')
  assert.equal(extractBilibiliId('https://bilibili.com.example.test/video/BV1Wy4y167Z9'), null)
})

test('normalizes Bilibili subtitle rows and removes unusable cues', () => {
  assert.deepEqual(
    normalizeSubtitleBody([
      { from: 1.25, to: 3.5, content: '  First   caption  ' },
      { from: 4, to: 4, content: 'zero duration' },
      { from: 5, to: 7, content: '   ' },
      { from: -2, to: 2, content: 'Second caption' },
    ]),
    [
      { start: 0, duration: 4, text: 'Second caption' },
      { start: 1.25, duration: 2.25, text: 'First caption' },
    ],
  )
})

test('reports source bans, invalid provider responses and connection failures without claiming missing captions', async (t) => {
  const failures: Array<{ fetch: typeof fetch; error: string }> = [
    { fetch: async () => new Response('', { status: 412 }), error: 'bilibili_access_restricted' },
    { fetch: async () => Response.json({ code: -352 }), error: 'bilibili_access_restricted' },
    { fetch: async () => new Response('<html>challenge</html>'), error: 'bilibili_provider_unavailable' },
    { fetch: async () => { throw new TypeError('fetch failed') }, error: 'bilibili_provider_unavailable' },
  ]
  for (const failure of failures) {
    const mocked = t.mock.method(globalThis, 'fetch', failure.fetch)
    await assert.rejects(fetchBilibiliCaptions('BV12N4y1M7rh'), { message: failure.error })
    mocked.mock.restore()
  }
})

test('uses the provider login flag to distinguish required authentication from missing subtitles', async (t) => {
  for (const requiresLogin of [true, false]) {
    const mocked = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input)
      return Response.json({ code: 0, data: url.includes('web-interface') ? { cid: 123 } : { need_login_subtitle: requiresLogin, subtitle: { subtitles: [] } } })
    })
    await assert.rejects(fetchBilibiliCaptions('BV12N4y1M7rh'), { message: requiresLogin ? 'bilibili_session_required' : 'no_captions' })
    mocked.mock.restore()
  }
})

test('accepts international video_subtitle fallback when subtitles is an empty array', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input).includes('gateway')) return Response.json({ code: 0, data: { subtitles: [], video_subtitle: [{ lang_key: 'en', url: '//captions.example.test/track.json' }] } })
    assert.equal(String(input), 'https://captions.example.test/track.json')
    return Response.json({ body: [{ from: 1, to: 3, content: 'Caption' }] })
  })
  assert.deepEqual(await fetchBilibiliCaptions('global:2041863208'), [{ start: 1, duration: 2, text: 'Caption' }])
})
