-- Targeted repair for the feedback table absent from the production REST schema.
-- Preserves the 2026-07-26 feedback schema; no existing rows are changed.
-- Apply this file alone in a transaction. Repeated execution is safe.
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

ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE feedback_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE feedback_messages TO service_role;

NOTIFY pgrst, 'reload schema';
