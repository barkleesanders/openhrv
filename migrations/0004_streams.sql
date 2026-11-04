-- Granularity wave: per-workout heart-rate streams (Strava), downsampled
-- to <= 1 point / 5 s and stored as JSON [elapsed_s, bpm] pairs. One row
-- per activity; the workout summary itself stays in health_samples.
CREATE TABLE IF NOT EXISTS workout_streams (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  sample_id INTEGER NOT NULL,
  activity_external_id TEXT NOT NULL,
  points_json TEXT NOT NULL,
  point_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, activity_external_id)
);
CREATE INDEX IF NOT EXISTS idx_workout_streams_sample ON workout_streams (owner, sample_id);
