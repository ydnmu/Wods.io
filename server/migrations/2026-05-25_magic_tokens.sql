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
