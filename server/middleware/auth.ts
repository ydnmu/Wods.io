import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { validateApiKey } from '../lib/apiKeys'
import { normalizePlan } from '../lib/plans'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { effectivePlan } from '../lib/entitlements'
import { canUseLocalAdminTunnelBypass, canUseLocalDevAdminBypass, isLoopbackAddress, verifyAdminSessionToken } from '../lib/adminAccess'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
      userPlan?: string
      userEmail?: string
      userName?: string
      userRole?: 'admin' | 'teammate'
      memberId?: string
      apiKeyId?: string
      onboardingRequired?: boolean
    }
  }
}

export async function requireApiKey(request: Request, response: Response, next: NextFunction) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    response.status(401).json({ error: 'missing_api_key' })
    return
  }

  try {
    const result = await validateApiKey(authHeader.slice(7))
    if (!result.valid) {
      const limitExceeded = result.reason === 'api_key_limit_exceeded'
      response.status(limitExceeded ? 429 : 401).json({
        error: result.reason || 'invalid_api_key',
        message: limitExceeded
          ? 'This API key has reached its request limit.'
          : result.reason === 'expired_api_key'
            ? 'This API key has expired.'
            : 'This API key is invalid or no longer active.',
      })
      return
    }

    request.userId = result.userId
    request.userPlan = result.plan
    request.apiKeyId = result.apiKeyId
    next()
  } catch (error) {
    response.status(503).json({
      error: 'auth_unavailable',
      message: error instanceof Error ? error.message : 'API key auth is unavailable.',
    })
  }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  await requireApiKey(request, response, next)
}

export function requirePlan(...plans: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const currentPlan = normalizePlan(request.userPlan)
    const allowedPlans = plans.map(normalizePlan)
    if (!allowedPlans.includes(currentPlan)) {
      response.status(403).json({
        error: 'plan_required',
        message: `This endpoint requires one of: ${allowedPlans.join(', ')} plan.`,
      })
      return
    }

    next()
  }
}

// Dev-only: skip email/magic-link auth. Opt-in via DEV_AUTH_BYPASS=true.
// Finds or creates a single dev user so the dashboard works end-to-end.
let devUserCache: { id: string; email: string; plan: string } | null = null

async function getOrCreateDevUser() {
  if (devUserCache) return devUserCache

  requireSupabaseConfig()
  const email = (process.env.DEV_USER_EMAIL || 'dev@easytran.local').toLowerCase()

  const { data: existing } = await supabase
    .from('users')
    .select('id, email, plan')
    .eq('email', email)
    .single()

  if (existing) {
    devUserCache = existing
    return existing
  }

  const { data: created, error } = await supabase
    .from('users')
    .insert({ email, plan: 'business', transcripts_limit: 100000 })
    .select('id, email, plan')
    .single()

  if (error || !created) {
    throw new Error(error?.message || 'Failed to create dev user')
  }

  devUserCache = created
  return created
}

export async function requireSession(request: Request, response: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS === 'true') {
    try {
      const devUser = await getOrCreateDevUser()
      request.userId = devUser.id
      request.userEmail = devUser.email
      request.userName = 'Developer'
      request.userRole = 'admin'
      request.userPlan = devUser.plan
      next()
      return
    } catch (error) {
      response.status(503).json({
        error: 'dev_bypass_failed',
        message: error instanceof Error ? error.message : 'Dev auth bypass failed.',
      })
      return
    }
  }

  const sessionToken = request.cookies?.easytran_session
  if (!sessionToken) {
    response.status(401).json({ error: 'not_authenticated' })
    return
  }

  try {
    requireSupabaseConfig()
    const sessionHash = crypto.createHash('sha256').update(sessionToken).digest('hex')
    const { data: dashboardSession } = await supabase
      .from('dashboard_sessions')
      .select('member_id, expires_at, revoked, dashboard_members(id, workspace_user_id, username, email, role, active, onboarding_required)')
      .eq('token_hash', sessionHash)
      .maybeSingle()

    if (dashboardSession) {
      const member = Array.isArray(dashboardSession.dashboard_members)
        ? dashboardSession.dashboard_members[0]
        : dashboardSession.dashboard_members
      if (!member || dashboardSession.revoked || !member.active || new Date(dashboardSession.expires_at) < new Date()) {
        response.status(401).json({ error: 'session_expired' })
        return
      }
      const { data: workspace } = await supabase
        .from('users')
        .select('plan, access_source, beta_expires_at')
        .eq('id', member.workspace_user_id)
        .single()
      request.userId = member.workspace_user_id
      request.memberId = member.id
      request.userEmail = member.email
      request.userName = member.username || member.email.split('@')[0]
      request.userRole = member.role === 'admin' ? 'admin' : 'teammate'
      request.userPlan = effectivePlan(workspace || {})
      request.onboardingRequired = Boolean(member.onboarding_required)
      next()
      return
    }

    const { data: record } = await supabase
      .from('magic_tokens')
      .select('user_id, expires_at, used')
      .eq('token_hash', `session_${sessionHash}`)
      .single()

    if (!record || record.used || new Date(record.expires_at) < new Date()) {
      response.status(401).json({ error: 'session_expired' })
      return
    }

    request.userId = record.user_id
    const { data: user } = await supabase
      .from('users')
      .select('email, plan, access_source, beta_expires_at')
      .eq('id', record.user_id)
      .single()

    request.userEmail = user?.email
    request.userName = user?.email?.split('@')[0]
    request.userRole = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((email) => email.trim()).includes(user?.email?.toLowerCase() || '')
      ? 'admin'
      : 'teammate'
    request.userPlan = effectivePlan(user || {})
    next()
  } catch (error) {
    response.status(503).json({
      error: 'session_unavailable',
      message: error instanceof Error ? error.message : 'Session auth is unavailable.',
    })
  }
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const adminEmails = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  const isLocalDevAdmin = process.env.NODE_ENV !== 'production'
    && process.env.DEV_AUTH_BYPASS === 'true'
    && request.userRole === 'admin'
  if (!isLocalDevAdmin && (!request.userEmail || !adminEmails.includes(request.userEmail.toLowerCase()))) {
    response.status(403).json({ error: 'admin_required' })
    return
  }

  next()
}

export function requireAdminSession(request: Request, response: Response, next: NextFunction) {
  if (canUseLocalDevAdminBypass({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.DEV_AUTH_BYPASS,
    remoteAddress: request.socket.remoteAddress,
    hostname: request.hostname,
  })) {
    request.userEmail = process.env.DEV_USER_EMAIL || 'dev@easytran.local'
    request.userName = 'Local Administrator'
    request.userRole = 'admin'
    next()
    return
  }

  if (canUseLocalAdminTunnelBypass({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.ADMIN_LOCAL_TUNNEL_BYPASS,
    remoteAddress: request.socket.remoteAddress,
  })) {
    request.userEmail = 'local-tunnel-admin'
    request.userName = 'Local Administrator'
    request.userRole = 'admin'
    next()
    return
  }

  const token = String(request.cookies?.easytran_admin_session || '')
  const secret = String(process.env.ADMIN_SESSION_SECRET || '')
  if (!token || !verifyAdminSessionToken(token, secret)) {
    response.status(401).json({ error: 'admin_not_authenticated' })
    return
  }

  request.userEmail = 'local-admin'
  request.userName = 'Administrator'
  request.userRole = 'admin'
  next()
}

// The public reverse proxy never reaches the Node service through a loopback
// socket. An SSH -L tunnel does, so this keeps the admin surface private while
// retaining a convenient local entry point for the operator.
export function requirePrivateAdminNetwork(request: Request, response: Response, next: NextFunction) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(404).end()
    return
  }
  next()
}
