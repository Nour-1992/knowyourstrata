-- Know Your Strata — funnel counter schema (Cloudflare D1).
--
-- One row per (day, event, detail). That is the entire data model, and the
-- shape is the privacy guarantee: there is no column for a visitor id, a
-- session, an IP address, a user agent or a referrer, so none can be stored
-- later by accident. Two people doing the same thing on the same day are one
-- row with count = 2, and nothing distinguishes them.
--
-- Apply once, in the Cloudflare dashboard:
--   Storage & databases -> D1 -> knowyourstrata -> Console -> paste and run.
--
-- Then bind the database to the Pages project as DB:
--   Workers & Pages -> knowyourstrata -> Settings -> Bindings -> D1 database
--   Variable name: DB     Database: knowyourstrata
--
-- Bindings only take effect on the NEXT deployment.

CREATE TABLE IF NOT EXISTS events (
  day    TEXT    NOT NULL,               -- 'YYYY-MM-DD', UTC
  name   TEXT    NOT NULL,               -- tool_used | pack_view | pack_click | subscribed | purchased
  detail TEXT    NOT NULL DEFAULT '',    -- tool slug, or 'bc' / 'on', or '' — always from a closed list
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, detail)
);

-- The stats endpoint always filters on a date range, so this is the index that
-- matters as the table grows.
CREATE INDEX IF NOT EXISTS events_day_idx ON events (day);
