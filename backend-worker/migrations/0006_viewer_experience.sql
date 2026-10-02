CREATE TABLE IF NOT EXISTS viewer_watch_daily (
  owner_id TEXT NOT NULL,
  day TEXT NOT NULL,
  movie_slug TEXT NOT NULL,
  movie_name TEXT NOT NULL,
  watched_seconds REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, day, movie_slug)
);

CREATE INDEX IF NOT EXISTS idx_viewer_watch_daily_owner_day
  ON viewer_watch_daily(owner_id, day DESC);

CREATE TABLE IF NOT EXISTS viewer_library (
  owner_id TEXT NOT NULL,
  movie_slug TEXT NOT NULL,
  movie_name TEXT NOT NULL,
  list_name TEXT NOT NULL DEFAULT 'watchlist',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, movie_slug, list_name)
);

CREATE INDEX IF NOT EXISTS idx_viewer_library_owner_updated
  ON viewer_library(owner_id, updated_at DESC);
