-- Per-key total request budgets and explicit expiry dates.
-- Workspace monthly quotas continue to apply independently.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS request_limit BIGINT,
  ADD COLUMN IF NOT EXISTS requests_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_request_limit_check,
  ADD CONSTRAINT api_keys_request_limit_check CHECK (request_limit IS NULL OR request_limit > 0),
  DROP CONSTRAINT IF EXISTS api_keys_requests_used_check,
  ADD CONSTRAINT api_keys_requests_used_check CHECK (requests_used >= 0);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_created
  ON api_keys(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION consume_api_key_request(p_key_hash TEXT)
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key api_keys%ROWTYPE;
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_key
  FROM api_keys
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid_api_key', NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TIMESTAMPTZ, NULL::BIGINT, NULL::BIGINT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_key.user_id;

  IF NOT v_key.active THEN
    RETURN QUERY SELECT false, 'revoked_api_key', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, v_key.request_limit, v_key.requests_used, v_key.expires_at;
    RETURN;
  END IF;

  IF v_key.expires_at IS NOT NULL AND v_key.expires_at <= now() THEN
    UPDATE api_keys SET active = false WHERE id = v_key.id;
    RETURN QUERY SELECT false, 'expired_api_key', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, v_key.request_limit, v_key.requests_used, v_key.expires_at;
    RETURN;
  END IF;

  IF v_user.access_source = 'beta'
    AND v_user.beta_expires_at IS NOT NULL
    AND v_user.beta_expires_at <= now() THEN
    RETURN QUERY SELECT false, 'workspace_access_expired', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, v_key.request_limit, v_key.requests_used, v_key.expires_at;
    RETURN;
  END IF;

  IF v_key.request_limit IS NOT NULL AND v_key.requests_used >= v_key.request_limit THEN
    RETURN QUERY SELECT false, 'api_key_limit_exceeded', v_key.id, v_key.user_id, v_user.plan,
      v_user.access_source, v_user.beta_expires_at, v_key.request_limit, v_key.requests_used, v_key.expires_at;
    RETURN;
  END IF;

  UPDATE api_keys
  SET requests_used = requests_used + 1,
      last_used_at = now()
  WHERE id = v_key.id
  RETURNING * INTO v_key;

  RETURN QUERY SELECT true, NULL::TEXT, v_key.id, v_key.user_id, v_user.plan,
    v_user.access_source, v_user.beta_expires_at, v_key.request_limit, v_key.requests_used, v_key.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION consume_api_key_request(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_api_key_request(TEXT) TO service_role;
