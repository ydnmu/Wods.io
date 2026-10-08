import assert from 'node:assert/strict'
import test from 'node:test'
import { renderWorkspaceAccessEmail } from './email'

test('renders a safe Developer onboarding email with one-time dashboard access', () => {
  const email = renderWorkspaceAccessEmail({
    accessKey: 'et_access_<secret>',
    plan: 'api',
    limit: 10_000,
  })

  assert.match(email.subject, /Developer dashboard access/)
  assert.match(email.html, /Developer plan/)
  assert.doesNotMatch(email.html, /1000/)
  assert.doesNotMatch(email.html, /hours\/month/)
  assert.match(email.html, /\/dashboard/)
  assert.match(email.html, /et_access_&lt;secret&gt;/)
  assert.doesNotMatch(email.html, /et_access_<secret>/)
  assert.match(email.html, /Copy your key/)
  assert.match(email.html, /Your dashboard is ready\./)
  assert.doesNotMatch(email.html, /Welcome to WODS/)
  assert.match(email.html, /Copy access key/)
  assert.match(email.html, /This key is temporary/)
  assert.match(email.html, /Login with key/)
  assert.match(email.html, /After you use the key, make a username and password/)
  assert.match(email.html, /feedback@easytran\.app/)
  assert.match(email.html, /wods-logo\.svg/)
  assert.doesNotMatch(email.html, /Photo:/)
  assert.match(email.html, /evgeni-evgeniev-LPKk3wtkC-g-unsplash\.jpg/)
})
