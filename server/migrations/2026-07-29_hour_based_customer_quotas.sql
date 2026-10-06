-- Customer plans are metered by source duration, not transcript request count.
-- Every completed video consumes at least one billable minute.

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS caption_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_fallback_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS request_limit BIGINT,
  ADD COLUMN IF NOT EXISTS requests_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Old per-key request caps conflict with hour-based workspace billing.
-- Keys still retain expiry/revocation controls and share the workspace meters.
UPDATE api_keys SET request_limit = NULL WHERE request_limit IS NOT NULL;

-- API authentication is read-only. The earlier request-budget function locked
-- and updated the same key row for every call, which serialized high-volume
-- clients even though commercial usage is now metered by source duration.
CREATE OR REPLACE FUNCTION validate_api_key(p_key_hash TEXT)
RETURNS TABLE(
  key_valid BOOLEAN,
  invalid_reason TEXT,
  api_key_id UUID,
  workspace_user_id UUID,
  workspace_plan TEXT,
  workspace_access_source TEXT,
  workspace_beta_expires_at TIMESTAMPTZ,
  key_request_limit BIGINT,
  key_requests_used BIGINT,
  key_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key api_keys%ROWTYPE;
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_key FROM api_keys WHERE key_hash = p_key_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid_api_key', NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TIMESTAMPTZ, NULL::BIGINT, NULL::BIGINT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_key.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid_api_key', v_key.id, v_key.user_id, NULL::TEXT,
      NULL::TEXT, NULL::TIMESTAMPTZ, NULL::BIGINT, NULL::BIGINT, v_key.expires_at;
    RETURN;
  END IF;

  IF NOT v_key.active THEN
    RETURN QUERY SELECT false, 'revoked_api_key', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, NULL::BIGINT, NULL::BIGINT, v_key.expires_at;
    RETURN;
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired_api_key', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, NULL::BIGINT, NULL::BIGINT, v_key.expires_at;
    RETURN;
  END IF;

  IF v_user.access_source = 'beta'
    AND v_user.beta_expires_at IS NOT NULL
    AND v_user.beta_expires_at <= now() THEN
    RETURN QUERY SELECT false, 'workspace_access_expired', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, NULL::BIGINT, NULL::BIGINT, v_key.expires_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, v_key.id, v_key.user_id, v_user.plan,
    v_user.access_source, v_user.beta_expires_at, NULL::BIGINT, NULL::BIGINT, v_key.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION validate_api_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validate_api_key(TEXT) TO service_role;

-- Dashboard usage must remain constant-size even for workspaces with millions
-- of completed items. Aggregate in Postgres instead of transferring every log.
CREATE OR REPLACE FUNCTION get_workspace_monthly_usage(p_user_id UUID)
RETURNS TABLE(
  completed_transcripts BIGINT,
  caption_seconds BIGINT,
  ai_fallback_seconds BIGINT,
  caption_transcripts BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::BIGINT,
    COALESCE(sum(log.caption_seconds), 0)::BIGINT,
    COALESCE(sum(log.ai_fallback_seconds), 0)::BIGINT,
    count(*) FILTER (WHERE log.ai_fallback_seconds = 0)::BIGINT
  FROM usage_logs AS log
  WHERE log.user_id = p_user_id
    AND log.status = 'success'
    AND log.created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
$$;

REVOKE ALL ON FUNCTION get_workspace_monthly_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_workspace_monthly_usage(UUID) TO service_role;

ALTER TABLE usage_logs
  DROP CONSTRAINT IF EXISTS usage_logs_caption_seconds_nonnegative;

ALTER TABLE usage_logs
  ADD CONSTRAINT usage_logs_caption_seconds_nonnegative
  CHECK (caption_seconds >= 0);

CREATE INDEX IF NOT EXISTS usage_logs_user_hour_meter_idx
  ON usage_logs (user_id, created_at DESC)
  WHERE status IN ('reserved', 'success')
    AND (caption_seconds > 0 OR ai_fallback_seconds > 0);

-- Reserving a transcript no longer checks a commercial request-count quota.
-- Request counts remain analytics only; duration is reserved separately below.
CREATE OR REPLACE FUNCTION reserve_transcript_usage(
  p_user_id UUID,
  p_video_id TEXT,
  p_endpoint TEXT
)
RETURNS TABLE(allowed BOOLEAN, used BIGINT, quota_limit INT, usage_log_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used BIGINT;
  v_usage_log_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  SELECT count(*) INTO v_used
  FROM usage_logs
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND status = 'success';

  INSERT INTO usage_logs(user_id, video_id, endpoint, status)
  VALUES (p_user_id, p_video_id, p_endpoint, 'reserved')
  RETURNING id INTO v_usage_log_id;

  RETURN QUERY SELECT true, v_used, NULL::INT, v_usage_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION reserve_transcript_hours(
  p_usage_log_id UUID,
  p_route TEXT,
  p_source_seconds INTEGER
)
RETURNS TABLE(
  allowed BOOLEAN,
  billable_seconds INTEGER,
  used_seconds BIGINT,
  limit_seconds BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_plan TEXT;
  v_billable_seconds INTEGER;
  v_used_seconds BIGINT;
  v_limit_seconds BIGINT;
BEGIN
  IF p_route NOT IN ('caption', 'ai_fallback') THEN
    RAISE EXCEPTION 'invalid_usage_route';
  END IF;
  IF p_source_seconds IS NULL OR p_source_seconds <= 0 OR p_source_seconds > 864000 THEN
    RAISE EXCEPTION 'invalid_source_seconds';
  END IF;

  SELECT logs.user_id, lower(users.plan)
    INTO v_user_id, v_plan
  FROM usage_logs AS logs
  JOIN users ON users.id = logs.user_id
  WHERE logs.id = p_usage_log_id AND logs.status = 'reserved'
  FOR UPDATE OF users, logs;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage_reservation_not_found';
  END IF;

  v_billable_seconds := GREATEST(60, CEIL(p_source_seconds / 60.0)::INTEGER * 60);
  v_limit_seconds := CASE
    WHEN v_plan IN ('api', 'pro') AND p_route = 'caption' THEN 1000::BIGINT * 3600
    WHEN v_plan IN ('api', 'pro') AND p_route = 'ai_fallback' THEN 50::BIGINT * 3600
    WHEN v_plan = 'business' AND p_route = 'caption' THEN 10000::BIGINT * 3600
    WHEN v_plan = 'business' AND p_route = 'ai_fallback' THEN 500::BIGINT * 3600
    WHEN v_plan = 'custom' THEN NULL
    ELSE 0
  END;

  SELECT COALESCE(SUM(
    CASE WHEN p_route = 'caption' THEN caption_seconds ELSE ai_fallback_seconds END
  ), 0)
    INTO v_used_seconds
  FROM usage_logs
  WHERE user_id = v_user_id
    AND id <> p_usage_log_id
    AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND (
      status = 'success'
      OR (status = 'reserved' AND created_at >= now() - interval '2 hours')
    );

  IF v_limit_seconds IS NOT NULL AND v_used_seconds + v_billable_seconds > v_limit_seconds THEN
    RETURN QUERY SELECT false, v_billable_seconds, v_used_seconds, v_limit_seconds;
    RETURN;
  END IF;

  UPDATE usage_logs
  SET caption_seconds = CASE WHEN p_route = 'caption' THEN v_billable_seconds ELSE 0 END,
      ai_fallback_seconds = CASE WHEN p_route = 'ai_fallback' THEN v_billable_seconds ELSE 0 END
  WHERE id = p_usage_log_id;

  RETURN QUERY SELECT true, v_billable_seconds, v_used_seconds + v_billable_seconds, v_limit_seconds;
END;
$$;

REVOKE ALL ON FUNCTION reserve_transcript_hours(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_transcript_hours(UUID, TEXT, INTEGER) TO service_role;
