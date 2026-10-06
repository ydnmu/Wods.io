import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractVideoId,
  fetchTranscriptWithFallback,
  parseYoutubeCaptionXml,
  prepareBrowserYoutubeTranscript,
  toSrt,
  toVtt,
} from './youtube'

test('extracts supported YouTube video URL formats', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('not a valid video id'), null)
})

test('renders valid subtitle headers and timestamps', () => {
  const lines = [{ text: 'Hello', start: 1, duration: 2 }]
  assert.match(toSrt(lines), /00:00:01,000 --> 00:00:04,000/)
  assert.match(toVtt(lines), /^WEBVTT/)
})

test('prepares a signed caption URL without downloading caption bytes on the server', async () => {
  const calls: string[] = []
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    return new Response(JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl: 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en',
            languageCode: 'en',
          }],
        },
      },
      videoDetails: {
        title: 'Me at the zoo',
        author: 'jawed',
        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg' }] },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const preparation = await prepareBrowserYoutubeTranscript('jNQXAC9IVRw', mockFetch)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /youtubei\/v1\/player/)
  assert.match(preparation.captionUrl, /^https:\/\/www\.youtube\.com\/api\/timedtext/)
  assert.match(preparation.captionUrl, /fmt=srv3/)
  assert.equal(preparation.title, 'Me at the zoo')
  assert.equal(preparation.channel, 'jawed')
})

test('parses browser-fetched srv3 and classic caption XML', () => {
  assert.deepEqual(
    parseYoutubeCaptionXml('<transcript><p t="1000" d="2500"><s>Hello </s><s>world &amp; friends</s></p></transcript>'),
    [{ text: 'Hello world & friends', start: 1, duration: 2.5 }],
  )
  assert.deepEqual(
    parseYoutubeCaptionXml('<transcript><text start="2.5" dur="1.25">Classic line</text></transcript>'),
    [{ text: 'Classic line', start: 2.5, duration: 1.25 }],
  )
})

test('reports missing speech provider clearly when captions are unavailable', async () => {
  const providerKeys = [
    'GROQ_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_AI_API_TOKEN',
    'FIREWORKS_API_KEY',
    'DEEPGRAM_API_KEY',
    'ASSEMBLYAI_API_KEY',
    'SPEECH_TO_TEXT_URL',
  ] as const
  const originalValues = Object.fromEntries(providerKeys.map((key) => [key, process.env[key]]))
  providerKeys.forEach((key) => delete process.env[key])

  try {
    await assert.rejects(
      fetchTranscriptWithFallback('invalidvideo', 'free'),
      /speech_to_text_not_configured/,
    )
  } finally {
    for (const key of providerKeys) {
      const originalValue = originalValues[key]
      if (originalValue === undefined) delete process.env[key]
      else process.env[key] = originalValue
    }
  }
})

test('requires explicit approval before starting audio fallback', async () => {
  await assert.rejects(
    fetchTranscriptWithFallback('invalidvideo', 'free', { allowAiFallback: false }),
    /ai_fallback_confirmation_required/,
  )
})
