-- Durable batch item leases for serverless workers.
ALTER TABLE batch_items
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE batch_jobs
  ADD COLUMN IF NOT EXISTS completion_notified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_batch_items_worker
  ON batch_items(status, updated_at, created_at);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_worker
  ON webhook_deliveries(status, next_retry_at, updated_at);

CREATE OR REPLACE FUNCTION claim_next_batch_item()
RETURNS TABLE(
  item_id UUID,
  job_id UUID,
  user_id UUID,
  item_url TEXT,
  user_plan TEXT,
  worker_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item batch_items%ROWTYPE;
  v_job batch_jobs%ROWTYPE;
  v_plan TEXT;
  v_token UUID := gen_random_uuid();
BEGIN
  SELECT item.* INTO v_item
  FROM batch_items item
  JOIN batch_jobs job ON job.id = item.batch_job_id
  JOIN users workspace_user ON workspace_user.id = job.user_id
  WHERE job.status = 'processing'
    AND (
      item.status = 'pending'
      OR (item.status = 'processing' AND item.updated_at < now() - interval '30 minutes')
    )
    AND lower(workspace_user.plan) IN ('business', 'custom')
    AND NOT (
      workspace_user.access_source = 'beta'
      AND workspace_user.beta_expires_at IS NOT NULL
      AND workspace_user.beta_expires_at <= now()
    )
  ORDER BY item.created_at
  FOR UPDATE OF item SKIP LOCKED
  LIMIT 1;

  IF v_item.id IS NULL THEN RETURN; END IF;

  UPDATE batch_items
  SET status = 'processing', attempts = attempts + 1, claim_token = v_token, updated_at = now(), error = NULL
  WHERE id = v_item.id;

  SELECT * INTO v_job FROM batch_jobs WHERE id = v_item.batch_job_id;
  SELECT plan INTO v_plan FROM users WHERE id = v_job.user_id;
  RETURN QUERY SELECT v_item.id, v_job.id, v_job.user_id, v_item.url, v_plan, v_token;
END;
$$;

CREATE OR REPLACE FUNCTION complete_batch_item(
  p_item_id UUID,
  p_worker_token UUID,
  p_transcript_id TEXT,
  p_usage_log_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE batch_items
  SET status = 'completed', transcript_id = p_transcript_id, claim_token = NULL, updated_at = now()
  WHERE id = p_item_id AND status = 'processing' AND claim_token = p_worker_token
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'stale_batch_claim'; END IF;
  PERFORM finalize_transcript_usage(p_usage_log_id, 'success');
END;
$$;

CREATE OR REPLACE FUNCTION fail_batch_item(
  p_item_id UUID,
  p_worker_token UUID,
  p_usage_log_id UUID,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_usage_log_id IS NOT NULL THEN
    PERFORM finalize_transcript_usage(p_usage_log_id, 'error');
  END IF;
  UPDATE batch_items
  SET status = 'failed', error = left(p_error, 500), claim_token = NULL, updated_at = now()
  WHERE id = p_item_id AND status = 'processing' AND claim_token = p_worker_token;
END;
$$;

REVOKE ALL ON FUNCTION claim_next_batch_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_batch_item(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_batch_item(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_next_batch_item() TO service_role;
GRANT EXECUTE ON FUNCTION complete_batch_item(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fail_batch_item(UUID, UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION create_webhook_subscription(
  p_user_id UUID,
  p_url TEXT,
  p_secret TEXT,
  p_events TEXT[]
)
RETURNS TABLE(
  webhook_id UUID,
  webhook_url TEXT,
  webhook_events TEXT[],
  webhook_active BOOLEAN,
  webhook_created_at TIMESTAMPTZ,
  limit_reached BOOLEAN,
  max_webhooks INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_access_source TEXT;
  v_beta_expires_at TIMESTAMPTZ;
  v_max INT;
  v_count BIGINT;
  v_webhook webhooks%ROWTYPE;
BEGIN
  SELECT lower(plan), access_source, beta_expires_at
  INTO v_plan, v_access_source, v_beta_expires_at
  FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;

  IF v_access_source = 'beta' AND v_beta_expires_at IS NOT NULL AND v_beta_expires_at <= now() THEN
    v_plan := 'free';
  END IF;
  v_max := CASE WHEN v_plan IN ('api', 'pro') THEN 3 WHEN v_plan = 'business' THEN 20 WHEN v_plan = 'custom' THEN -1 ELSE 0 END;
  SELECT count(*) INTO v_count FROM webhooks WHERE user_id = p_user_id AND active = true;
  IF v_max >= 0 AND v_count >= v_max THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT[], NULL::BOOLEAN, NULL::TIMESTAMPTZ, true, v_max;
    RETURN;
  END IF;

  INSERT INTO webhooks(user_id, url, secret, events)
  VALUES (p_user_id, p_url, p_secret, p_events)
  RETURNING * INTO v_webhook;
  RETURN QUERY SELECT v_webhook.id, v_webhook.url, v_webhook.events, v_webhook.active, v_webhook.created_at, false, v_max;
END;
$$;

REVOKE ALL ON FUNCTION create_webhook_subscription(UUID, TEXT, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_webhook_subscription(UUID, TEXT, TEXT, TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION claim_next_webhook_delivery()
RETURNS TABLE(
  delivery_id UUID,
  webhook_id UUID,
  event_name TEXT,
  event_payload JSONB,
  delivery_attempts INT,
  webhook_url TEXT,
  webhook_secret TEXT,
  worker_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery webhook_deliveries%ROWTYPE;
  v_webhook webhooks%ROWTYPE;
  v_token UUID := gen_random_uuid();
BEGIN
  SELECT delivery.* INTO v_delivery
  FROM webhook_deliveries delivery
  JOIN webhooks hook ON hook.id = delivery.webhook_id
  WHERE hook.active = true
    AND delivery.attempts < 5
    AND (
      (delivery.status = 'pending' AND delivery.next_retry_at <= now())
      OR (delivery.status = 'delivering' AND delivery.updated_at < now() - interval '2 minutes')
    )
  ORDER BY delivery.next_retry_at
  FOR UPDATE OF delivery SKIP LOCKED
  LIMIT 1;

  IF v_delivery.id IS NULL THEN RETURN; END IF;
  UPDATE webhook_deliveries
  SET status = 'delivering', claim_token = v_token, updated_at = now()
  WHERE id = v_delivery.id;
  SELECT * INTO v_webhook FROM webhooks WHERE id = v_delivery.webhook_id;
  RETURN QUERY SELECT v_delivery.id, v_delivery.webhook_id, v_delivery.event, v_delivery.payload,
    v_delivery.attempts, v_webhook.url, v_webhook.secret, v_token;
END;
$$;

CREATE OR REPLACE FUNCTION complete_webhook_delivery(
  p_delivery_id UUID,
  p_worker_token UUID,
  p_success BOOLEAN,
  p_next_retry_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INT;
BEGIN
  SELECT attempts + 1 INTO v_attempts
  FROM webhook_deliveries
  WHERE id = p_delivery_id AND status = 'delivering' AND claim_token = p_worker_token
  FOR UPDATE;
  IF v_attempts IS NULL THEN RAISE EXCEPTION 'stale_webhook_claim'; END IF;

  UPDATE webhook_deliveries
  SET attempts = v_attempts,
      status = CASE WHEN p_success THEN 'delivered' WHEN v_attempts >= 5 THEN 'failed' ELSE 'pending' END,
      next_retry_at = CASE WHEN p_success OR v_attempts >= 5 THEN NULL ELSE p_next_retry_at END,
      claim_token = NULL,
      updated_at = now()
  WHERE id = p_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_next_webhook_delivery() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_webhook_delivery(UUID, UUID, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_next_webhook_delivery() TO service_role;
GRANT EXECUTE ON FUNCTION complete_webhook_delivery(UUID, UUID, BOOLEAN, TIMESTAMPTZ) TO service_role;
