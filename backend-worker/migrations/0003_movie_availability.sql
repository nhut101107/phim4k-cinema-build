CREATE TABLE IF NOT EXISTS movie_availability (
  movie_slug TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT NOT NULL,
  next_check_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movie_availability_recheck
  ON movie_availability(status, next_check_at);
