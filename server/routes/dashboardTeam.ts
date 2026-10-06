import crypto from 'node:crypto'
import { Router } from 'express'
import { requireSupabaseConfig, supabase } from '../lib/supabase'
import { normalizePlan } from '../lib/plans'

export const dashboardTeamRouter = Router()

const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex')
const createKey = () => `et_team_${crypto.randomBytes(24).toString('base64url')}`

dashboardTeamRouter.use((request, response, next) => {
  const plan = normalizePlan(request.userPlan)
  if (plan !== 'business' && plan !== 'custom') {
    response.status(403).json({ error: 'business_plan_required' })
    return
  }
  next()
})

dashboardTeamRouter.get('/', async (request, response) => {
  requireSupabaseConfig()
  if (request.userRole !== 'admin') {
    response.status(403).json({ error: 'admin_required' })
    return
  }
  const { data, error } = await supabase
    .from('dashboard_members')
    .select('id, username, email, role, active, last_login_at, created_at')
    .eq('workspace_user_id', request.userId)
    .order('created_at', { ascending: true })
  if (error) {
    response.status(500).json({ error: 'team_load_failed', message: error.message })
    return
  }
  response.json(data ?? [])
})

dashboardTeamRouter.post('/', async (request, response) => {
  requireSupabaseConfig()
  if (request.userRole !== 'admin') {
    response.status(403).json({ error: 'admin_required' })
    return
  }
  const username = String(request.body?.username || '').trim()
  const email = String(request.body?.email || '').trim().toLowerCase()
  const role = request.body?.role === 'admin' ? 'admin' : 'teammate'
  if (username.length < 2 || !email.includes('@')) {
    response.status(400).json({ error: 'invalid_member' })
    return
  }
  const key = createKey()
  const { data, error } = await supabase
    .from('dashboard_members')
    .insert({
      workspace_user_id: request.userId,
      username,
      email,
      role,
      access_key_hash: hashKey(key),
      created_by: request.memberId,
    })
    .select('id, username, email, role, active, created_at')
    .single()
  if (error || !data) {
    response.status(409).json({ error: 'member_create_failed', message: error?.message || 'Member could not be created.' })
    return
  }
  response.json({ member: data, key })
})

dashboardTeamRouter.post('/:id/rotate-key', async (request, response) => {
  requireSupabaseConfig()
  if (request.userRole !== 'admin') {
    response.status(403).json({ error: 'admin_required' })
    return
  }
  const key = createKey()
  const { data } = await supabase
    .from('dashboard_members')
    .update({ access_key_hash: hashKey(key) })
    .eq('id', request.params.id)
    .eq('workspace_user_id', request.userId)
    .select('id')
    .single()
  if (!data) {
    response.status(404).json({ error: 'member_not_found' })
    return
  }
  await supabase.from('dashboard_sessions').update({ revoked: true }).eq('member_id', request.params.id)
  response.json({ key })
})

dashboardTeamRouter.patch('/:id', async (request, response) => {
  requireSupabaseConfig()
  if (request.userRole !== 'admin') {
    response.status(403).json({ error: 'admin_required' })
    return
  }
  const role = request.body?.role === 'admin' ? 'admin' : 'teammate'
  const active = request.body?.active !== false
  if (request.params.id === request.memberId && (role !== 'admin' || !active)) {
    response.status(400).json({ error: 'cannot_remove_own_admin_access' })
    return
  }
  const { data } = await supabase
    .from('dashboard_members')
    .update({ role, active })
    .eq('id', request.params.id)
    .eq('workspace_user_id', request.userId)
    .select('id, username, email, role, active, last_login_at, created_at')
    .single()
  if (!data) {
    response.status(404).json({ error: 'member_not_found' })
    return
  }
  if (!active) await supabase.from('dashboard_sessions').update({ revoked: true }).eq('member_id', request.params.id)
  response.json(data)
})
