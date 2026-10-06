-- Targeted repair for the two RPCs missing from the production PostgREST contract.
-- Preconditions: api_keys, users and usage_logs already have their current columns.
-- Apply this file alone in a transaction; never replay the hour-based quota migration.
-- Repeated execution is safe. No table, key limit, counter or customer row is changed.
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

NOTIFY pgrst, 'reload schema';
