import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchVimeoCaptions, fetchVimeoMeta } from './vimeo'

test('retains Vimeo metadata when oEmbed is blocked and captions remain available', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('oembed.json')) return new Response('', { status: 403 })
    if (url.includes('player.vimeo.com/video/')) return new Response(`<script>window.playerConfig = ${JSON.stringify({ video: { title: 'Real title', duration: 62, owner: { name: 'Creator' }, thumbs: { '640': 'https://i.vimeocdn.com/video/thumb.jpg' } }, request: { text_tracks: [{ kind: 'captions', url: 'https://captions.example.test/track.vtt' }] } })};</script>`)
    return new Response('WEBVTT\n\n00:01.000 --> 00:03.000\nCaption\n')
  })
  const [meta, segments] = await Promise.all([fetchVimeoMeta('76979871'), fetchVimeoCaptions('76979871')])
  assert.equal(meta.title, 'Real title')
  assert.equal(meta.channel, 'Creator')
  assert.equal(meta.duration, '1:02')
  assert.equal(meta.thumbnail, 'https://i.vimeocdn.com/video/thumb.jpg')
  assert.deepEqual(segments, [{ start: 1, duration: 2, text: 'Caption' }])
})
