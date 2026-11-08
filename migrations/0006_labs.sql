-- Longevity wave: blood-lab results for the Levine-2018 PhenoAge clock
-- (PLSI port). Values are stored in CANONICAL units only (see
-- src/phenoage.ts MARKERS); entry-unit conversion happens at the API
-- boundary. One row per marker per draw date — a PhenoAge draw needs
-- all 9 markers from the SAME drawn_on date.
CREATE TABLE IF NOT EXISTS lab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  marker TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  drawn_on TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner, marker, drawn_on)
);
CREATE INDEX IF NOT EXISTS idx_lab_results_draw ON lab_results (owner, drawn_on);
