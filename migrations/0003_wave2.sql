-- OpenHRV wave 2 (D5/D6): voice-note metadata (audio lives in R2) and the
-- notification delivery log. Every send attempt — cron or manual test — is
-- recorded here; the scheduler reads it back for same-day dedup.
CREATE TABLE IF NOT EXISTS voice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'audio/webm',
  duration_s INTEGER NOT NULL DEFAULT 0,
  transcript TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_voice_owner_time ON voice_notes (owner, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  endpoint_host TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  http_status INTEGER,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_notif_owner_time ON notification_log (owner, at DESC);
