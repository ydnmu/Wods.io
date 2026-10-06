-- Persist checkout selections and make billing webhook delivery idempotent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS pending_checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS pending_plan TEXT,
  ADD COLUMN IF NOT EXISTS pending_quantity INT;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_processed
  ON billing_webhook_events(processed_at DESC);
