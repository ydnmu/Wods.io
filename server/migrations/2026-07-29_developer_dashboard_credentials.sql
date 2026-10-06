ALTER TABLE dashboard_members
  ALTER COLUMN username DROP NOT NULL,
  ALTER COLUMN access_key_hash DROP NOT NULL;

ALTER TABLE dashboard_members
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_key_used_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_members_login_username
  ON dashboard_members (lower(username))
  WHERE password_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_members_bootstrap_access
  ON dashboard_members (email, access_key_hash)
  WHERE access_key_hash IS NOT NULL AND active = true;
