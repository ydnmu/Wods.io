-- Full transcript text is retained only for Business and Custom workspaces.
-- Public web transcripts live only in the visitor's page memory, and API-plan
-- responses are delivered directly without server-side transcript retention.
DELETE FROM transcripts
WHERE user_id IN (
  SELECT id FROM users WHERE plan NOT IN ('business', 'custom')
);
