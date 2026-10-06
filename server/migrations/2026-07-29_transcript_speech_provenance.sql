ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS speech_providers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_fallback_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE transcripts
  DROP CONSTRAINT IF EXISTS transcripts_ai_fallback_seconds_nonnegative;

ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_ai_fallback_seconds_nonnegative
  CHECK (ai_fallback_seconds >= 0);

CREATE INDEX IF NOT EXISTS transcripts_ai_fallback_seconds_idx
  ON transcripts (user_id, created_at DESC)
  WHERE ai_fallback_seconds > 0;
