-- OpenHRV normalized health-samples store + Strava connector tables (D4/D9).
CREATE TABLE IF NOT EXISTS health_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  type TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_samples_owner_type_time ON health_samples (owner, type, start_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_samples_dedupe ON health_samples (owner, source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS strava_tokens (
  owner TEXT PRIMARY KEY,
  athlete_id TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
