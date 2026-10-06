-- Polar customer and subscription identifiers.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS polar_customer_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS polar_subscription_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS polar_product_id TEXT,
  ADD COLUMN IF NOT EXISTS polar_quantity INT NOT NULL DEFAULT 1;
