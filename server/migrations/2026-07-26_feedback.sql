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
