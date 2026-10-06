import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchPublicYoutubeCaptions,
  isPublicCaptionMissingError,
} from './youtubePublicCaptions'

test('normalizes timestamped public YouTube caption segments', async () => {
  const mockFetch: typeof fetch = async () => new Response(JSON.stringify({
    videoId: '4UqcsTPiEXs',
    available: true,
    transcript: [
      { text: '  First   caption  ', start: 0, duration: 2.5 },
      { text: 'Second caption', start: 2.5, duration: 3 },
      { text: '', start: 5, duration: 1 },
    ],
  }), { headers: { 'content-type': 'application/json' } })

  assert.deepEqual(await fetchPublicYoutubeCaptions('4UqcsTPiEXs', mockFetch), [
    { text: 'First caption', start: 0, duration: 2.5 },
    { text: 'Second caption', start: 2.5, duration: 3 },
  ])
})

test('distinguishes missing captions from a provider outage', async () => {
  const missingFetch: typeof fetch = async () => new Response('', { status: 404 })
  await assert.rejects(
    fetchPublicYoutubeCaptions('4UqcsTPiEXs', missingFetch),
    (error) => isPublicCaptionMissingError(error),
  )

  const unavailableFetch: typeof fetch = async () => new Response('', { status: 429 })
  await assert.rejects(
    fetchPublicYoutubeCaptions('4UqcsTPiEXs', unavailableFetch),
    /provider_unavailable/,
  )
})
