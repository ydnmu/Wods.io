import './env'
import { createClient } from '@supabase/supabase-js'

export const hasSupabaseConfig = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)

export const supabase = createClient(
  process.env.SUPABASE_URL || 'https://example.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'missing-service-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)

export const requireSupabaseConfig = () => {
  if (!hasSupabaseConfig()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for this endpoint.')
  }
}
