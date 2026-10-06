-- Atomically enforce the shared monthly quota across API, dashboard, batch, and channel sync.
UPDATE users SET transcripts_limit = 100000
WHERE lower(plan) = 'business' AND transcripts_limit <> 100000;

UPDATE users SET transcripts_limit = 10000
WHERE lower(plan) IN ('api', 'pro') AND transcripts_limit < 10000;

ALTER TABLE processed_videos
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_usage_logs_active_quota
  ON usage_logs(user_id, created_at DESC)
  WHERE status IN ('reserved', 'success');

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
  v_plan TEXT;
  v_configured_limit INT;
  v_limit INT;
  v_used BIGINT;
  v_usage_log_id UUID;
BEGIN
  SELECT lower(plan), transcripts_limit
    INTO v_plan, v_configured_limit
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  v_limit := CASE
    WHEN v_plan = 'custom' THEN NULL
    WHEN v_plan = 'business' THEN COALESCE(NULLIF(v_configured_limit, 0), 100000)
    WHEN v_plan IN ('api', 'pro') THEN COALESCE(NULLIF(v_configured_limit, 0), 10000)
    ELSE 0
  END;

  SELECT count(*)
    INTO v_used
  FROM usage_logs
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND (
      status = 'success'
      OR (status = 'reserved' AND created_at >= now() - interval '2 hours')
    );

  IF v_limit IS NOT NULL AND v_used >= v_limit THEN
    RETURN QUERY SELECT false, v_used, v_limit, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO usage_logs(user_id, video_id, endpoint, status)
  VALUES (p_user_id, p_video_id, p_endpoint, 'reserved')
  RETURNING id INTO v_usage_log_id;

  RETURN QUERY SELECT true, v_used, v_limit, v_usage_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_transcript_usage(p_usage_log_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF p_status NOT IN ('success', 'error') THEN
    RAISE EXCEPTION 'invalid_usage_status';
  END IF;

  UPDATE usage_logs
  SET status = p_status
  WHERE id = p_usage_log_id AND status = 'reserved'
  RETURNING user_id INTO v_user_id;

  IF p_status = 'success' AND v_user_id IS NOT NULL THEN
    UPDATE users SET transcripts_used = transcripts_used + 1 WHERE id = v_user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION claim_channel_video(p_channel_subscription_id UUID, p_video_id TEXT)
RETURNS TABLE(processed_video_id UUID, claim_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_claim_token UUID := gen_random_uuid();
BEGIN
  INSERT INTO processed_videos(channel_subscription_id, video_id, status, attempts, claim_token, updated_at)
  VALUES (p_channel_subscription_id, p_video_id, 'processing', 1, v_claim_token, now())
  ON CONFLICT (channel_subscription_id, video_id) DO UPDATE
  SET status = 'processing',
      attempts = processed_videos.attempts + 1,
      last_error = NULL,
      claim_token = v_claim_token,
      updated_at = now()
  WHERE processed_videos.status = 'failed'
     OR (processed_videos.status = 'processing' AND processed_videos.updated_at < now() - interval '30 minutes')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_claim_token WHERE v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION complete_channel_video(
  p_processed_video_id UUID,
  p_claim_token UUID,
  p_usage_log_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_id UUID;
BEGIN
  UPDATE processed_videos
  SET status = 'completed', last_error = NULL, updated_at = now(), processed_at = now()
  WHERE id = p_processed_video_id AND status = 'processing' AND claim_token = p_claim_token
  RETURNING id INTO v_completed_id;

  IF v_completed_id IS NULL THEN
    RAISE EXCEPTION 'stale_channel_video_claim';
  END IF;

  PERFORM finalize_transcript_usage(p_usage_log_id, 'success');
END;
$$;

CREATE OR REPLACE FUNCTION fail_channel_video(
  p_processed_video_id UUID,
  p_claim_token UUID,
  p_usage_log_id UUID,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_usage_log_id IS NOT NULL THEN
    PERFORM finalize_transcript_usage(p_usage_log_id, 'error');
  END IF;
  UPDATE processed_videos
  SET status = 'failed', last_error = left(p_error, 500), updated_at = now()
  WHERE id = p_processed_video_id AND status = 'processing' AND claim_token = p_claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_channel_subscription(
  p_user_id UUID,
  p_channel_id TEXT,
  p_channel_name TEXT
)
RETURNS TABLE(
  subscription_id UUID,
  channel_id TEXT,
  channel_name TEXT,
  last_synced_at TIMESTAMPTZ,
  active BOOLEAN,
  created_at TIMESTAMPTZ,
  limit_reached BOOLEAN,
  max_channels INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_max_channels INT;
  v_active_count BIGINT;
  v_subscription channel_subscriptions%ROWTYPE;
BEGIN
  SELECT lower(plan) INTO v_plan FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  v_max_channels := CASE
    WHEN v_plan = 'custom' THEN -1
    WHEN v_plan = 'business' THEN 10
    ELSE 0
  END;

  SELECT * INTO v_subscription
  FROM channel_subscriptions
  WHERE user_id = p_user_id AND channel_subscriptions.channel_id = p_channel_id;

  IF v_subscription.id IS NOT NULL AND v_subscription.active THEN
    RETURN QUERY SELECT v_subscription.id, v_subscription.channel_id, v_subscription.channel_name,
      v_subscription.last_synced_at, v_subscription.active, v_subscription.created_at, false, v_max_channels;
    RETURN;
  END IF;

  SELECT count(*) INTO v_active_count
  FROM channel_subscriptions
  WHERE user_id = p_user_id AND channel_subscriptions.active = true;

  IF v_max_channels >= 0 AND v_active_count >= v_max_channels THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ,
      NULL::BOOLEAN, NULL::TIMESTAMPTZ, true, v_max_channels;
    RETURN;
  END IF;

  INSERT INTO channel_subscriptions(user_id, channel_id, channel_name, active)
  VALUES (p_user_id, p_channel_id, p_channel_name, true)
  ON CONFLICT (user_id, channel_id) DO UPDATE
  SET channel_name = EXCLUDED.channel_name, active = true
  RETURNING * INTO v_subscription;

  RETURN QUERY SELECT v_subscription.id, v_subscription.channel_id, v_subscription.channel_name,
    v_subscription.last_synced_at, v_subscription.active, v_subscription.created_at, false, v_max_channels;
END;
$$;

REVOKE ALL ON FUNCTION reserve_transcript_usage(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_transcript_usage(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_channel_video(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_channel_video(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_channel_video(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION upsert_channel_subscription(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_transcript_usage(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_transcript_usage(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_channel_video(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_channel_video(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fail_channel_video(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION upsert_channel_subscription(UUID, TEXT, TEXT) TO service_role;
