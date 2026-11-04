-- OpenHRV initial schema (D1 / SQLite). Single-user instance: rows are keyed
-- to the owner identity from Cloudflare Access.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  owner TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (owner, key)
);
CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  duration_s INTEGER NOT NULL DEFAULT 0,
  mean_hr_bpm REAL NOT NULL,
  mean_rr_ms REAL NOT NULL,
  sdnn_ms REAL NOT NULL,
  rmssd_ms REAL NOT NULL,
  pnn50_pct REAL NOT NULL,
  lf_ms2 REAL NOT NULL DEFAULT 0,
  hf_ms2 REAL NOT NULL DEFAULT 0,
  lf_hf_ratio REAL NOT NULL DEFAULT 0,
  baevsky_si REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_measurements_owner_time ON measurements (owner, taken_at DESC);
CREATE TABLE IF NOT EXISTS rr_series (
  measurement_id INTEGER PRIMARY KEY REFERENCES measurements (id),
  rr_ms_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sleep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'import',
  stages_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL,
  body TEXT NOT NULL,
  mood INTEGER NOT NULL DEFAULT 5,
  tags_json TEXT NOT NULL DEFAULT '[]',
  voice_note_id TEXT
);
CREATE TABLE IF NOT EXISTS breathing_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  pattern TEXT NOT NULL DEFAULT 'box-4-4-4-4',
  duration_s INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS self_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  test_type TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notification_prefs (
  owner TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner, type)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
