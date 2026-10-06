import assert from 'node:assert/strict'
import test from 'node:test'
import { getReleasePolicy } from './releasePolicy'

test('keeps paid workspaces disabled unless explicitly released', () => {
  assert.deepEqual(getReleasePolicy({}), { paidWorkspacesEnabled: false })
  for (const value of ['', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
    assert.deepEqual(getReleasePolicy({ PAID_WORKSPACES_ENABLED: value }), { paidWorkspacesEnabled: false })
  }
  assert.deepEqual(getReleasePolicy({ PAID_WORKSPACES_ENABLED: 'true' }), { paidWorkspacesEnabled: true })
})

test('reads the current environment when no argument is supplied', () => {
  const previous = process.env.PAID_WORKSPACES_ENABLED
  try {
    delete process.env.PAID_WORKSPACES_ENABLED
    assert.equal(getReleasePolicy().paidWorkspacesEnabled, false)
    process.env.PAID_WORKSPACES_ENABLED = 'true'
    assert.equal(getReleasePolicy().paidWorkspacesEnabled, true)
    process.env.PAID_WORKSPACES_ENABLED = 'false'
    assert.equal(getReleasePolicy().paidWorkspacesEnabled, false)
  } finally {
    if (previous === undefined) delete process.env.PAID_WORKSPACES_ENABLED
    else process.env.PAID_WORKSPACES_ENABLED = previous
  }
})
