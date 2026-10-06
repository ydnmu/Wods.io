import assert from 'node:assert/strict'
import test from 'node:test'
import { platformCaptionError } from './captionErrors'

test('separates missing tracks from upstream access, authentication and availability errors', () => {
  assert.equal(platformCaptionError('bilibili_access_restricted')?.status, 503)
  assert.equal(platformCaptionError('bilibili_session_required')?.error, 'bilibili_auth_required')
  assert.equal(platformCaptionError('bilibili_provider_unavailable')?.status, 502)
  assert.equal(platformCaptionError('source_unavailable')?.status, 404)
  const missing = platformCaptionError('no_captions')!
  assert.equal(missing.status, 422)
  assert.notEqual(missing.message, 'no_captions')
  assert.ok(!platformCaptionError('bilibili_session_required')!.message.includes('BILIBILI_SESSDATA'))
})
