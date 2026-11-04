-- Phase B: calendar lane for the Today coach panel. Only title + start/end
-- + calendar name are stored (no location, no attendees, no notes).
-- Retention is enforced by the import endpoint: rows older than 14 days
-- are pruned on every POST.
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  calendar_name TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, external_id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events (owner, start_at);
