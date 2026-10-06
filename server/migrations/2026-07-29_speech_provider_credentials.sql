-- Provider credentials entered from the admin panel are encrypted by the API
-- before storage. The database never receives plaintext provider secrets.
CREATE TABLE IF NOT EXISTS speech_provider_credentials (
  provider TEXT PRIMARY KEY CHECK (provider IN ('groq', 'cloudflare', 'fireworks', 'deepgram', 'assemblyai', 'worker')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE speech_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE speech_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE speech_provider_credentials TO service_role;
