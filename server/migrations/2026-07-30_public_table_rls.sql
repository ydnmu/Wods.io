-- The API accesses these tables with the service role. Browser roles must not
-- be able to read or mutate customer transcripts, billing events, analytics,
-- or access requests directly.

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  analytics_events,
  billing_webhook_events,
  transcripts,
  waitlist
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  analytics_events,
  billing_webhook_events,
  transcripts,
  waitlist
TO service_role;
