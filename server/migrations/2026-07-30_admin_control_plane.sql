-- Production admin control plane.
-- Retired billing columns are intentionally left in place so this migration is
-- additive and cannot discard historical billing data.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings(key, value)
VALUES ('operations_mode', 'live')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'system',
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  route TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_incidents_recent_idx
  ON rate_limit_incidents(occurred_at DESC);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_settings, admin_audit_log, rate_limit_incidents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE app_settings, admin_audit_log, rate_limit_incidents TO service_role;

DROP FUNCTION IF EXISTS admin_list_customer_usage(TEXT, TEXT, TEXT, INT, INT);

CREATE FUNCTION admin_list_customer_usage(
  p_search TEXT DEFAULT '',
  p_plan TEXT DEFAULT '',
  p_status TEXT DEFAULT '',
  p_limit INT DEFAULT 250,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  total_count BIGINT,
  user_id UUID,
  email TEXT,
  plan TEXT,
  access_source TEXT,
  subscription_status TEXT,
  polar_customer_id TEXT,
  polar_subscription_id TEXT,
  polar_product_id TEXT,
  polar_quantity INT,
  caption_limit_seconds BIGINT,
  caption_used_seconds BIGINT,
  caption_remaining_seconds BIGINT,
  caption_percentage NUMERIC,
  ai_fallback_limit_seconds BIGINT,
  ai_fallback_used_seconds BIGINT,
  ai_fallback_remaining_seconds BIGINT,
  ai_fallback_percentage NUMERIC,
  completed_transcripts BIGINT,
  last_used_at TIMESTAMPTZ,
  active_keys BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH monthly_usage AS (
    SELECT
      user_id,
      count(*) FILTER (WHERE status = 'success') AS completed_transcripts,
      coalesce(sum(caption_seconds) FILTER (WHERE status = 'success'), 0)::BIGINT AS caption_used_seconds,
      coalesce(sum(ai_fallback_seconds) FILTER (WHERE status = 'success'), 0)::BIGINT AS ai_fallback_used_seconds,
      max(created_at) FILTER (WHERE status = 'success') AS last_used_at
    FROM usage_logs
    WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    GROUP BY user_id
  ), active_key_counts AS (
    SELECT user_id, count(*) AS active_keys
    FROM api_keys
    WHERE active = true
    GROUP BY user_id
  ), limits AS (
    SELECT
      u.*,
      CASE
        WHEN lower(u.plan) IN ('api', 'pro') THEN 1000::BIGINT * 3600
        WHEN lower(u.plan) = 'business' THEN 10000::BIGINT * 3600
        ELSE NULL
      END AS caption_limit_seconds,
      CASE
        WHEN lower(u.plan) IN ('api', 'pro') THEN 50::BIGINT * 3600
        WHEN lower(u.plan) = 'business' THEN 500::BIGINT * 3600
        ELSE NULL
      END AS ai_fallback_limit_seconds
    FROM users u
  ), customer_rows AS (
    SELECT
      l.id AS user_id,
      l.email,
      lower(l.plan) AS plan,
      l.access_source,
      l.subscription_status,
      l.polar_customer_id,
      l.polar_subscription_id,
      l.polar_product_id,
      l.polar_quantity,
      l.caption_limit_seconds,
      coalesce(mu.caption_used_seconds, 0)::BIGINT AS caption_used_seconds,
      CASE WHEN l.caption_limit_seconds IS NULL THEN NULL
        ELSE greatest(l.caption_limit_seconds - coalesce(mu.caption_used_seconds, 0), 0) END AS caption_remaining_seconds,
      CASE WHEN l.caption_limit_seconds IS NULL OR l.caption_limit_seconds = 0 THEN 0::NUMERIC
        ELSE least(100::NUMERIC, round(coalesce(mu.caption_used_seconds, 0)::NUMERIC * 100 / l.caption_limit_seconds, 1)) END AS caption_percentage,
      l.ai_fallback_limit_seconds,
      coalesce(mu.ai_fallback_used_seconds, 0)::BIGINT AS ai_fallback_used_seconds,
      CASE WHEN l.ai_fallback_limit_seconds IS NULL THEN NULL
        ELSE greatest(l.ai_fallback_limit_seconds - coalesce(mu.ai_fallback_used_seconds, 0), 0) END AS ai_fallback_remaining_seconds,
      CASE WHEN l.ai_fallback_limit_seconds IS NULL OR l.ai_fallback_limit_seconds = 0 THEN 0::NUMERIC
        ELSE least(100::NUMERIC, round(coalesce(mu.ai_fallback_used_seconds, 0)::NUMERIC * 100 / l.ai_fallback_limit_seconds, 1)) END AS ai_fallback_percentage,
      coalesce(mu.completed_transcripts, 0)::BIGINT AS completed_transcripts,
      mu.last_used_at,
      coalesce(akc.active_keys, 0)::BIGINT AS active_keys,
      l.created_at
    FROM limits l
    LEFT JOIN monthly_usage mu ON mu.user_id = l.id
    LEFT JOIN active_key_counts akc ON akc.user_id = l.id
    WHERE
      (coalesce(p_search, '') = '' OR l.email ILIKE '%' || p_search || '%')
      AND (coalesce(p_plan, '') = '' OR lower(l.plan) = lower(p_plan))
      AND (
        coalesce(p_status, '') = ''
        OR lower(coalesce(l.subscription_status, l.access_source, '')) = lower(p_status)
      )
  )
  SELECT count(*) OVER() AS total_count, customer_rows.*
  FROM customer_rows
  ORDER BY last_used_at DESC NULLS LAST, created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 250), 500))
  OFFSET greatest(0, coalesce(p_offset, 0));
$$;

REVOKE ALL ON FUNCTION admin_list_customer_usage(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_customer_usage(TEXT, TEXT, TEXT, INT, INT) TO service_role;
