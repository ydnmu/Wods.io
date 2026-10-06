ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS ai_fallback_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS speech_providers TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE usage_logs
  DROP CONSTRAINT IF EXISTS usage_logs_ai_fallback_seconds_nonnegative;

ALTER TABLE usage_logs
  ADD CONSTRAINT usage_logs_ai_fallback_seconds_nonnegative
  CHECK (ai_fallback_seconds >= 0);

CREATE INDEX IF NOT EXISTS usage_logs_user_audio_month_idx
  ON usage_logs (user_id, created_at DESC)
  WHERE status = 'success' AND ai_fallback_seconds > 0;
