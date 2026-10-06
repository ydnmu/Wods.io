import crypto from 'node:crypto'
import { hashKey, invalidateApiKeyCache } from './apiKeys'
import { sendWorkspaceAccessEmail } from './email'
import { supabase } from './supabase'

const createAccessKey = () => `et_access_${crypto.randomBytes(24).toString('base64url')}`

export async function ensureWorkspaceAccess(userId: string, plan: string, limit: number) {
  const { data: user } = await supabase.from('users').select('email').eq('id', userId).single()
  if (!user?.email) {
    throw new Error('workspace_access_delivery_failed: user_email_missing')
  }

  const { data: existingMember, error: memberLookupError } = await supabase
    .from('dashboard_members')
    .select('id, password_hash, active, access_key_hash, onboarding_required')
    .eq('workspace_user_id', userId)
    .eq('email', user.email)
    .maybeSingle()
  if (memberLookupError) throw new Error(`workspace_access_setup_failed: ${memberLookupError.message}`)

  if (existingMember?.password_hash) {
    if (!existingMember.active) {
      await supabase.from('dashboard_members').update({ active: true }).eq('id', existingMember.id)
    }
    return { created: false }
  }

  const plainKey = createAccessKey()
  const accessKeyHash = hashKey(plainKey)
  const memberWrite = existingMember
    ? await supabase
      .from('dashboard_members')
      .update({
        access_key_hash: accessKeyHash,
        access_key_used_at: null,
        onboarding_required: true,
        active: true,
      })
      .eq('id', existingMember.id)
      .select('id')
      .single()
    : await supabase
      .from('dashboard_members')
      .insert({
        workspace_user_id: userId,
        username: null,
        email: user.email,
        role: 'admin',
        access_key_hash: accessKeyHash,
        onboarding_required: true,
      })
      .select('id')
      .single()
  if (memberWrite.error || !memberWrite.data) {
    throw new Error(`workspace_access_setup_failed: ${memberWrite.error?.message || 'member_not_created'}`)
  }

  try {
    await sendWorkspaceAccessEmail({ to: user.email, accessKey: plainKey, plan, limit })
  } catch (error) {
    if (existingMember) {
      await supabase.from('dashboard_members').update({
        access_key_hash: existingMember.access_key_hash,
        onboarding_required: existingMember.onboarding_required,
        active: existingMember.active,
      }).eq('id', memberWrite.data.id)
    } else {
      await supabase.from('dashboard_members').delete().eq('id', memberWrite.data.id)
    }
    throw new Error(
      `workspace_access_delivery_failed: ${error instanceof Error ? error.message : 'unknown_email_error'}`,
      { cause: error },
    )
  }
  return { created: true }
}

export async function deactivateWorkspace(userId: string) {
  const { data: keys } = await supabase.from('api_keys').select('key_hash').eq('user_id', userId).eq('active', true)
  const { data: members } = await supabase.from('dashboard_members').select('id').eq('workspace_user_id', userId)
  await Promise.all([
    supabase.from('api_keys').update({ active: false }).eq('user_id', userId),
    supabase.from('webhooks').update({ active: false }).eq('user_id', userId),
    supabase.from('channel_subscriptions').update({ active: false }).eq('user_id', userId),
    supabase.from('dashboard_members').update({ active: false }).eq('workspace_user_id', userId),
  ])
  await Promise.all([
    ...(keys ?? []).map((key) => invalidateApiKeyCache(key.key_hash)),
    ...(members ?? []).map((member) => supabase.from('dashboard_sessions').update({ revoked: true }).eq('member_id', member.id)),
  ])
}

export async function expireBetaAccess() {
  const now = new Date().toISOString()
  const { data: expired } = await supabase
    .from('users')
    .select('id')
    .eq('access_source', 'beta')
    .lt('beta_expires_at', now)
    .neq('plan', 'free')

  for (const user of expired ?? []) {
    await deactivateWorkspace(user.id)
    await supabase
      .from('users')
      .update({ plan: 'free', transcripts_limit: 100, access_source: 'expired_beta' })
      .eq('id', user.id)
  }
  return expired?.length ?? 0
}
