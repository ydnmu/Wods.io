CREATE TABLE IF NOT EXISTS dashboard_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL CHECK (char_length(username) BETWEEN 2 AND 48),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teammate' CHECK (role IN ('admin', 'teammate')),
  access_key_hash TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES dashboard_members(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_user_id, email),
  UNIQUE(workspace_user_id, username)
);

CREATE TABLE IF NOT EXISTS dashboard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES dashboard_members(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_members_workspace
  ON dashboard_members(workspace_user_id, active);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_token
  ON dashboard_sessions(token_hash) WHERE revoked = false;

ALTER TABLE dashboard_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dashboard_members, dashboard_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE dashboard_members, dashboard_sessions TO service_role;
