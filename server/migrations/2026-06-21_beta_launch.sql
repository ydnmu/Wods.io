-- Beta applications and time-bounded workspace access before billing opens.
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requested_quantity INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS access_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS beta_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_waitlist_status_created
  ON waitlist(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_beta_expiry
  ON users(beta_expires_at)
  WHERE access_source = 'beta' AND beta_expires_at IS NOT NULL;
