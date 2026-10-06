import assert from 'node:assert/strict'
import test from 'node:test'
import { contentSecurityPolicy } from './securityHeaders'

test('allows every supported player and the Dailymotion embed redirect', () => {
  const frames = contentSecurityPolicy.split('; ').find(value => value.startsWith('frame-src '))!.split(' ').slice(1)
  for (const host of ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.dailymotion.com', 'geo.dailymotion.com', 'embed.ted.com', 'player.bilibili.com', 'www.bilibili.tv']) {
    assert.ok(frames.includes(`https://${host}`), `Player blocked: ${host}`)
  }
  assert.ok(!frames.includes('*'))
  assert.ok(contentSecurityPolicy.includes("script-src 'self'"))
  assert.ok(contentSecurityPolicy.includes("frame-ancestors 'none'"))
})
