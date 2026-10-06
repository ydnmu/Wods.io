CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  polar_customer_id TEXT UNIQUE,
  polar_subscription_id TEXT UNIQUE,
  polar_product_id TEXT,
  polar_quantity INT NOT NULL DEFAULT 1,
  subscription_status TEXT,
  pending_checkout_id TEXT,
  pending_plan TEXT,
  pending_quantity INT,
  access_source TEXT NOT NULL DEFAULT 'manual',
  beta_expires_at TIMESTAMPTZ,
  plan TEXT NOT NULL DEFAULT 'free',
  transcripts_used INT NOT NULL DEFAULT 0,
  transcripts_limit INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  request_limit BIGINT CHECK (request_limit IS NULL OR request_limit > 0),
  requests_used BIGINT NOT NULL DEFAULT 0 CHECK (requests_used >= 0),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  video_id TEXT,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  caption_seconds INT NOT NULL DEFAULT 0 CHECK (caption_seconds >= 0),
  ai_fallback_seconds INT NOT NULL DEFAULT 0 CHECK (ai_fallback_seconds >= 0),
  speech_providers TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE speech_provider_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  audio_seconds INT NOT NULL CHECK (audio_seconds > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'success', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX idx_speech_provider_usage_budget
  ON speech_provider_usage(provider, created_at DESC)
  WHERE status IN ('reserved', 'success');

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

CREATE TABLE billing_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT ARRAY['transcript.completed'],
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  claim_token UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channel_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  schedule_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (schedule_frequency IN ('every_15_minutes', 'hourly', 'daily')),
  schedule_time TIME NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  auto_summary BOOLEAN NOT NULL DEFAULT true,
  ai_fallback BOOLEAN NOT NULL DEFAULT true,
  backfill_limit INT NOT NULL DEFAULT 0 CHECK (backfill_limit BETWEEN 0 AND 1000),
  paused BOOLEAN NOT NULL DEFAULT false,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_started_at TIMESTAMPTZ,
  last_run_completed_at TIMESTAMPTZ,
  last_run_status TEXT NOT NULL DEFAULT 'pending',
  last_run_error TEXT,
  last_run_processed INT NOT NULL DEFAULT 0,
  last_run_failed INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);

CREATE TABLE processed_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_subscription_id UUID NOT NULL REFERENCES channel_subscriptions(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'completed',
  attempts INT NOT NULL DEFAULT 1,
  last_error TEXT,
  claim_token UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel_subscription_id, video_id)
);

CREATE TABLE batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total INT NOT NULL,
  completed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  completion_notified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id UUID NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transcript_id TEXT,
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  claim_token UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE active = true;
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_webhook_deliveries_worker ON webhook_deliveries(status, next_retry_at, updated_at);
CREATE INDEX idx_batch_items_pending ON batch_items(batch_job_id) WHERE status = 'pending';
CREATE INDEX idx_batch_items_worker ON batch_items(status, updated_at, created_at);
CREATE INDEX idx_channel_subscriptions_active ON channel_subscriptions(active) WHERE active = true;
CREATE INDEX idx_usage_logs_user ON usage_logs(user_id, created_at DESC);
CREATE INDEX idx_billing_webhook_events_processed ON billing_webhook_events(processed_at DESC);

CREATE OR REPLACE FUNCTION increment_usage(user_id UUID)
RETURNS void AS $$
  UPDATE users SET transcripts_used = transcripts_used + 1 WHERE id = user_id;
$$ LANGUAGE sql;

CREATE TABLE IF NOT EXISTS magic_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_hash ON magic_tokens(token_hash) WHERE used = false;

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  video_channel TEXT NOT NULL,
  video_duration TEXT NOT NULL DEFAULT '0:00',
  video_thumbnail TEXT NOT NULL DEFAULT '',
  lines JSONB NOT NULL,
  word_count INT NOT NULL DEFAULT 0,
  caption_source TEXT NOT NULL DEFAULT 'youtube',
  speech_providers TEXT[] NOT NULL DEFAULT '{}',
  ai_fallback_seconds INT NOT NULL DEFAULT 0 CHECK (ai_fallback_seconds >= 0),
  ai_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  requested_quantity INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status_created ON waitlist(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_beta_expiry ON users(beta_expires_at)
  WHERE access_source = 'beta' AND beta_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events(visitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL CHECK (char_length(username) BETWEEN 2 AND 80),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 3 AND 3000),
  source TEXT NOT NULL DEFAULT 'docs',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_messages_created
  ON feedback_messages(status, created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE analytics_events, billing_webhook_events, transcripts, waitlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE analytics_events, billing_webhook_events, transcripts, waitlist TO service_role;
REVOKE ALL ON TABLE feedback_messages FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS rate_limit_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  route TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_incidents_recent_idx ON rate_limit_incidents(occurred_at DESC);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_settings, admin_audit_log, rate_limit_incidents FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public_transcript_metrics (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  transcript_count BIGINT NOT NULL DEFAULT 0 CHECK (transcript_count >= 0),
  total_response_ms BIGINT NOT NULL DEFAULT 0 CHECK (total_response_ms >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_transcript_metric_receipts (
  completion_id UUID PRIMARY KEY,
  response_ms INTEGER NOT NULL CHECK (response_ms > 0 AND response_ms <= 3600000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public_transcript_metrics (id, transcript_count, total_response_ms)
VALUES (true, 0, 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION record_public_transcript_metric(
  p_completion_id UUID,
  p_response_ms INTEGER
)
RETURNS TABLE(transcript_count BIGINT, average_response_ms BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF p_response_ms <= 0 OR p_response_ms > 3600000 THEN
    RAISE EXCEPTION 'invalid_response_ms';
  END IF;
  INSERT INTO public_transcript_metric_receipts (completion_id, response_ms)
  VALUES (p_completion_id, p_response_ms)
  ON CONFLICT (completion_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN
    UPDATE public_transcript_metrics AS metrics
    SET transcript_count = metrics.transcript_count + 1,
        total_response_ms = metrics.total_response_ms + p_response_ms,
        updated_at = now()
    WHERE id = true;
  END IF;
  RETURN QUERY
  SELECT metrics.transcript_count,
    CASE WHEN metrics.transcript_count = 0 THEN NULL::BIGINT
      ELSE round(metrics.total_response_ms::NUMERIC / metrics.transcript_count)::BIGINT END
  FROM public_transcript_metrics AS metrics
  WHERE id = true;
END;
$$;

ALTER TABLE public_transcript_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_transcript_metric_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public_transcript_metrics, public_transcript_metric_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public_transcript_metrics, public_transcript_metric_receipts TO service_role;
REVOKE ALL ON FUNCTION record_public_transcript_metric(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_public_transcript_metric(UUID, INTEGER) TO service_role;
