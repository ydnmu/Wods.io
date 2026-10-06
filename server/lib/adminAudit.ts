import { hasSupabaseConfig, supabase } from './supabase'

export async function recordAdminAudit(input: {
  actorId?: string | null
  actorEmail?: string | null
  action: string
  targetType?: string
  targetId?: string | null
  metadata?: Record<string, unknown>
}) {
  if (!hasSupabaseConfig()) return
  const { error } = await supabase.from('admin_audit_log').insert({
    actor_id: input.actorId || null,
    actor_email: input.actorEmail || null,
    action: input.action,
    target_type: input.targetType || 'system',
    target_id: input.targetId || null,
    metadata: input.metadata || {},
  })
  if (error && !/admin_audit_log|schema cache/i.test(error.message)) {
    console.error('[admin-audit] write failed:', error.message)
  }
}
