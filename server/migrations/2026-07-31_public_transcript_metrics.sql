-- Public counters start at zero and only successful transcript completions are
-- recorded. Completion IDs make browser retries idempotent.
CREATE TABLE IF NOT EXISTS public_transcript_metrics (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  transcript_count BIGINT NOT NULL DEFAULT 0 CHECK (transcript_count >= 0),
  total_response_ms BIGINT NOT NULL DEFAULT 0 CHECK (total_response_ms >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_transcript_metric_receipts (
  completion_id UUID PRIMARY KEY,
  response_ms INTEGER NOT NULL CHECK (response_ms > 0 AND response_ms <= 3600000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public_transcript_metrics (id, transcript_count, total_response_ms)
VALUES (true, 0, 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION record_public_transcript_metric(
  p_completion_id UUID,
  p_response_ms INTEGER
)
RETURNS TABLE(transcript_count BIGINT, average_response_ms BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF p_response_ms <= 0 OR p_response_ms > 3600000 THEN
    RAISE EXCEPTION 'invalid_response_ms';
  END IF;

  INSERT INTO public_transcript_metric_receipts (completion_id, response_ms)
  VALUES (p_completion_id, p_response_ms)
  ON CONFLICT (completion_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    UPDATE public_transcript_metrics AS metrics
    SET transcript_count = metrics.transcript_count + 1,
        total_response_ms = metrics.total_response_ms + p_response_ms,
        updated_at = now()
    WHERE id = true;
  END IF;

  RETURN QUERY
  SELECT
    metrics.transcript_count,
    CASE
      WHEN metrics.transcript_count = 0 THEN NULL::BIGINT
      ELSE round(metrics.total_response_ms::NUMERIC / metrics.transcript_count)::BIGINT
    END
  FROM public_transcript_metrics AS metrics
  WHERE id = true;
END;
$$;

ALTER TABLE public_transcript_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_transcript_metric_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public_transcript_metrics, public_transcript_metric_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public_transcript_metrics, public_transcript_metric_receipts TO service_role;
REVOKE ALL ON FUNCTION record_public_transcript_metric(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_public_transcript_metric(UUID, INTEGER) TO service_role;
