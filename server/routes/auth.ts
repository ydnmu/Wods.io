import crypto from 'node:crypto'
import { Router } from 'express'
import { sendMagicLinkEmail } from '../lib/email'
import { hashPassword, normalizeUsername, validatePassword, verifyPassword } from '../lib/passwords'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { requireSession } from '../middleware/auth'
import {
  ADMIN_SESSION_MAX_AGE_MS,
  createAdminSessionToken,
  verifyAdminAccessKey,
} from '../lib/adminAccess'

export const authRouter = Router()

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const sessionCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  priority: 'high' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
}
const adminSessionCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  priority: 'high' as const,
  maxAge: ADMIN_SESSION_MAX_AGE_MS,
  path: '/',
}

const createDashboardSession = async (memberId: string) => {
  const plainSession = crypto.randomBytes(32).toString('hex')
  const { error } = await supabase.from('dashboard_sessions').insert({
    member_id: memberId,
    token_hash: hashToken(plainSession),
    expires_at: new Date(Date.now() + sessionCookie.maxAge).toISOString(),
  })
  if (error) throw new Error('session_create_failed')
  return plainSession
}

authRouter.post('/admin-key-login', async (request, response) => {
  const configuredHash = String(process.env.ADMIN_ACCESS_KEY_HASH || '').trim().toLowerCase()
  const sessionSecret = String(process.env.ADMIN_SESSION_SECRET || '')
  if (!/^[a-f0-9]{64}$/.test(configuredHash) || sessionSecret.length < 32) {
    response.status(503).json({ error: 'admin_key_not_configured' })
    return
  }

  const key = String(request.body?.key || '')
  if (!verifyAdminAccessKey(key, configuredHash)) {
    await new Promise((resolve) => setTimeout(resolve, 650))
    response.status(401).json({ error: 'invalid_admin_key' })
    return
  }

  response
    .cookie('easytran_admin_session', createAdminSessionToken(sessionSecret), adminSessionCookie)
    .json({ success: true })
})

authRouter.post('/bootstrap-login', async (request, response) => {
  requireSupabaseConfig()
  const key = String(request.body?.key || '').trim()
  if (!key.startsWith('et_access_') || key.length < 24) {
    response.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const { data: member, error } = await supabase
    .from('dashboard_members')
    .select('id, username, email, role, active, onboarding_required, password_hash')
    .eq('access_key_hash', hashToken(key))
    .maybeSingle()

  if (error || !member || !member.active || member.password_hash) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    response.status(error?.code === '42703' || error?.code === 'PGRST204' ? 503 : 401).json({
      error: error?.code === '42703' || error?.code === 'PGRST204'
        ? 'credential_migration_required'
        : 'invalid_credentials',
    })
    return
  }

  try {
    const plainSession = await createDashboardSession(member.id)
    await supabase.from('dashboard_members').update({ last_login_at: new Date().toISOString() }).eq('id', member.id)
    response.cookie('easytran_session', plainSession, sessionCookie).json({
      success: true,
      requiresSetup: Boolean(member.onboarding_required),
    })
  } catch {
    response.status(503).json({ error: 'session_create_failed' })
  }
})

authRouter.post('/password-login', async (request, response) => {
  requireSupabaseConfig()
  let username: string
  try {
    username = normalizeUsername(request.body?.username)
    validatePassword(request.body?.password)
  } catch {
    response.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const { data: member } = await supabase
    .from('dashboard_members')
    .select('id, username, email, role, active, password_hash, onboarding_required')
    .ilike('username', username)
    .not('password_hash', 'is', null)
    .maybeSingle()

  if (!member || !member.active || member.onboarding_required || !await verifyPassword(request.body?.password, member.password_hash)) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    response.status(401).json({ error: 'invalid_credentials' })
    return
  }

  try {
    const plainSession = await createDashboardSession(member.id)
    await supabase.from('dashboard_members').update({ last_login_at: new Date().toISOString() }).eq('id', member.id)
    response.cookie('easytran_session', plainSession, sessionCookie).json({ success: true })
  } catch {
    response.status(503).json({ error: 'session_create_failed' })
  }
})

authRouter.get('/session', requireSession, (request, response) => {
  response.json({
    authenticated: true,
    onboardingRequired: Boolean(request.onboardingRequired),
    username: request.userName,
    email: request.userEmail,
    plan: request.userPlan,
  })
})

authRouter.post('/complete-setup', requireSession, async (request, response) => {
  if (!request.memberId || !request.onboardingRequired) {
    response.status(409).json({ error: 'setup_not_required' })
    return
  }

  let username: string
  let password: string
  try {
    username = normalizeUsername(request.body?.username)
    password = validatePassword(request.body?.password)
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'invalid_credentials' })
    return
  }

  const passwordHash = await hashPassword(password)
  const { data, error } = await supabase
    .from('dashboard_members')
    .update({
      username,
      password_hash: passwordHash,
      onboarding_required: false,
      access_key_hash: null,
      access_key_used_at: new Date().toISOString(),
    })
    .eq('id', request.memberId)
    .eq('onboarding_required', true)
    .select('id')
    .maybeSingle()

  if (error?.code === '23505') {
    response.status(409).json({ error: 'username_taken' })
    return
  }
  if (error || !data) {
    response.status(409).json({ error: 'setup_not_completed' })
    return
  }

  const currentSessionHash = hashToken(String(request.cookies?.easytran_session || ''))
  await supabase
    .from('dashboard_sessions')
    .update({ revoked: true })
    .eq('member_id', request.memberId)
    .neq('token_hash', currentSessionHash)
  response.json({ success: true, username })
})

authRouter.post('/key-login', async (request, response) => {
  requireSupabaseConfig()
  const username = String(request.body?.username || '').trim()
  const email = String(request.body?.email || '').trim().toLowerCase()
  const key = String(request.body?.key || '').trim()
  if (username.length < 2 || !email.includes('@') || key.length < 16) {
    response.status(401).json({ error: 'invalid_credentials' })
    return
  }

  let { data: member, error: memberError } = await supabase
    .from('dashboard_members')
    .select('id, workspace_user_id, username, email, role, active')
    .eq('email', email)
    .eq('username', username)
    .eq('access_key_hash', hashToken(key))
    .maybeSingle()

  const adminEmails = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  const configuredAdminKey = String(process.env.DASHBOARD_ADMIN_ACCESS_KEY || '')
  const suppliedKeyHash = Buffer.from(hashToken(key))
  const configuredKeyHash = Buffer.from(hashToken(configuredAdminKey || 'not-configured'))
  const validBootstrapAdmin = configuredAdminKey.length >= 16
    && adminEmails.includes(email)
    && crypto.timingSafeEqual(suppliedKeyHash, configuredKeyHash)

  if (!member && validBootstrapAdmin && !memberError) {
    const { data: owner } = await supabase.from('users').select('id').eq('email', email).maybeSingle()
    if (owner) {
      const result = await supabase
        .from('dashboard_members')
        .upsert({
          workspace_user_id: owner.id,
          username,
          email,
          role: 'admin',
          access_key_hash: hashToken(key),
          active: true,
        }, { onConflict: 'workspace_user_id,email' })
        .select('id, workspace_user_id, username, email, role, active')
        .single()
      member = result.data
      memberError = result.error
    }
  }

  if (memberError || !member || !member.active) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    response.status(memberError?.code === '42P01' ? 503 : 401).json({
      error: memberError?.code === '42P01' ? 'team_access_setup_required' : 'invalid_credentials',
    })
    return
  }

  let plainSession: string
  try {
    plainSession = await createDashboardSession(member.id)
  } catch {
    response.status(503).json({ error: 'session_create_failed' })
    return
  }
  await supabase.from('dashboard_members').update({ last_login_at: new Date().toISOString() }).eq('id', member.id)
  response.cookie('easytran_session', plainSession, sessionCookie).json({
    success: true,
    user: { username: member.username, email: member.email, role: member.role },
  })
})

authRouter.post('/magic-link', async (request, response) => {
  requireSupabaseConfig()
  const email = String(request.body?.email || '').trim().toLowerCase()
  const genericResponse = { success: true, message: 'If an account exists, a login link has been sent.' }

  if (!email) {
    response.status(400).json({ error: 'email required' })
    return
  }

  const { data: user } = await supabase
    .from('users')
    .select('id, plan')
    .eq('email', email)
    .single()

  if (!user || user.plan === 'free') {
    await new Promise((resolve) => setTimeout(resolve, 900))
    response.json(genericResponse)
    return
  }

  const { data: dashboardMember } = await supabase
    .from('dashboard_members')
    .select('id')
    .eq('workspace_user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (dashboardMember) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    response.json(genericResponse)
    return
  }

  const plainToken = crypto.randomBytes(32).toString('hex')
  await supabase
    .from('magic_tokens')
    .update({ used: true })
    .eq('user_id', user.id)
    .eq('used', false)

  const { data: createdToken } = await supabase.from('magic_tokens').insert({
    user_id: user.id,
    token_hash: hashToken(plainToken),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }).select('id').single()

  try {
    await sendMagicLinkEmail({ to: email, token: plainToken })
  } catch (error) {
    console.error('Magic link email failed:', error)
    if (createdToken?.id) await supabase.from('magic_tokens').delete().eq('id', createdToken.id)
  }

  response.json(genericResponse)
})

authRouter.get('/verify', async (request, response) => {
  requireSupabaseConfig()
  const token = String(request.query.token || '')

  if (!token) {
    response.redirect('/?auth=invalid')
    return
  }

  const { data: record } = await supabase
    .from('magic_tokens')
    .select('id, user_id, expires_at, used')
    .eq('token_hash', hashToken(token))
    .single()

  if (!record || record.used || new Date(record.expires_at) < new Date()) {
    response.redirect('/?auth=expired')
    return
  }

  const { data: dashboardMember } = await supabase
    .from('dashboard_members')
    .select('id, onboarding_required')
    .eq('workspace_user_id', record.user_id)
    .limit(1)
    .maybeSingle()
  if (dashboardMember) {
    await supabase.from('magic_tokens').update({ used: true }).eq('id', record.id)
    response.redirect(dashboardMember.onboarding_required ? '/dashboard?mode=access' : '/dashboard')
    return
  }

  const { data: claimed } = await supabase
    .from('magic_tokens')
    .update({ used: true })
    .eq('id', record.id)
    .eq('used', false)
    .select('id')
    .single()
  if (!claimed) {
    response.redirect('/?auth=expired')
    return
  }

  const sessionToken = crypto.randomBytes(32).toString('hex')
  await supabase.from('magic_tokens').insert({
    user_id: record.user_id,
    token_hash: `session_${hashToken(sessionToken)}`,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  response
    .cookie('easytran_session', sessionToken, sessionCookie)
    .redirect('/dashboard')
})

authRouter.post('/logout', async (request, response) => {
  const sessionToken = request.cookies?.easytran_session
  if (sessionToken) {
    const sessionHash = hashToken(sessionToken)
    await supabase
      .from('dashboard_sessions')
      .update({ revoked: true })
      .eq('token_hash', sessionHash)
    await supabase
      .from('magic_tokens')
      .update({ used: true })
      .eq('token_hash', `session_${sessionHash}`)
  }
  response
    .clearCookie('easytran_session', { path: '/' })
    .clearCookie('easytran_admin_session', { path: '/' })
    .json({ success: true })
})
