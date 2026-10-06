ALTER TABLE channel_subscriptions
  ADD COLUMN IF NOT EXISTS schedule_frequency TEXT NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS schedule_time TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS auto_summary BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_fallback BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS backfill_limit INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_run_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_run_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_run_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_run_error TEXT,
  ADD COLUMN IF NOT EXISTS last_run_processed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_run_failed INT NOT NULL DEFAULT 0;

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS ai_summary JSONB;

DO $$ BEGIN
  ALTER TABLE channel_subscriptions
    ADD CONSTRAINT channel_schedule_frequency_check
    CHECK (schedule_frequency IN ('every_15_minutes', 'hourly', 'daily'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE channel_subscriptions
    ADD CONSTRAINT channel_backfill_limit_check
    CHECK (backfill_limit BETWEEN 0 AND 1000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_due
  ON channel_subscriptions(next_run_at)
  WHERE active = true AND paused = false;

CREATE OR REPLACE FUNCTION claim_channel_sync(
  p_subscription_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_force BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed BOOLEAN;
BEGIN
  UPDATE channel_subscriptions
  SET last_run_status = 'running',
      last_run_started_at = now(),
      last_run_error = NULL
  WHERE id = p_subscription_id
    AND active = true
    AND (p_user_id IS NULL OR user_id = p_user_id)
    AND (p_force OR (paused = false AND next_run_at <= now()))
    AND (last_run_status <> 'running' OR last_run_started_at < now() - interval '30 minutes')
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION claim_channel_sync(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_channel_sync(UUID, UUID, BOOLEAN) TO service_role;

