-- Durable, atomic accounting for provider free-tier and trial-credit budgets.
-- Audio is measured in seconds because provider cost follows source duration,
-- not the number of transcript API requests.

CREATE TABLE IF NOT EXISTS speech_provider_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  audio_seconds INT NOT NULL CHECK (audio_seconds > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'success', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_speech_provider_usage_budget
  ON speech_provider_usage(provider, created_at DESC)
  WHERE status IN ('reserved', 'success');

ALTER TABLE speech_provider_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reserve_speech_provider_budget(
  p_provider TEXT,
  p_audio_seconds INT,
  p_daily_limit_seconds BIGINT DEFAULT NULL,
  p_lifetime_limit_seconds BIGINT DEFAULT NULL
)
RETURNS TABLE(
  allowed BOOLEAN,
  reservation_id UUID,
  daily_used_seconds BIGINT,
  lifetime_used_seconds BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT := lower(trim(p_provider));
  v_daily_used BIGINT;
  v_lifetime_used BIGINT;
  v_reservation_id UUID;
BEGIN
  IF v_provider NOT IN ('groq', 'cloudflare', 'fireworks', 'deepgram', 'assemblyai', 'worker') THEN
    RAISE EXCEPTION 'invalid_speech_provider';
  END IF;
  IF p_audio_seconds IS NULL OR p_audio_seconds <= 0 OR p_audio_seconds > 864000 THEN
    RAISE EXCEPTION 'invalid_audio_seconds';
  END IF;

  -- One advisory lock per provider prevents two app instances from spending
  -- the final free minutes at the same time.
  PERFORM pg_advisory_xact_lock(hashtext('speech-provider-budget:' || v_provider));

  SELECT coalesce(sum(audio_seconds), 0)
    INTO v_daily_used
  FROM speech_provider_usage
  WHERE provider = v_provider
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND (
      status = 'success'
      OR (status = 'reserved' AND created_at >= now() - interval '30 minutes')
    );

  SELECT coalesce(sum(audio_seconds), 0)
    INTO v_lifetime_used
  FROM speech_provider_usage
  WHERE provider = v_provider
    AND (
      status = 'success'
      OR (status = 'reserved' AND created_at >= now() - interval '30 minutes')
    );

  IF (p_daily_limit_seconds IS NOT NULL AND v_daily_used + p_audio_seconds > p_daily_limit_seconds)
    OR (p_lifetime_limit_seconds IS NOT NULL AND v_lifetime_used + p_audio_seconds > p_lifetime_limit_seconds) THEN
    RETURN QUERY SELECT false, NULL::UUID, v_daily_used, v_lifetime_used;
    RETURN;
  END IF;

  INSERT INTO speech_provider_usage(provider, audio_seconds, status)
  VALUES (v_provider, p_audio_seconds, 'reserved')
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT true, v_reservation_id, v_daily_used + p_audio_seconds, v_lifetime_used + p_audio_seconds;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_speech_provider_budget(
  p_reservation_id UUID,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('success', 'error') THEN
    RAISE EXCEPTION 'invalid_speech_budget_status';
  END IF;

  UPDATE speech_provider_usage
  SET status = p_status, finalized_at = now()
  WHERE id = p_reservation_id AND status = 'reserved';
END;
$$;

REVOKE ALL ON TABLE speech_provider_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reserve_speech_provider_budget(TEXT, INT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_speech_provider_budget(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE speech_provider_usage TO service_role;
GRANT EXECUTE ON FUNCTION reserve_speech_provider_budget(TEXT, INT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_speech_provider_budget(UUID, TEXT) TO service_role;
