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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
