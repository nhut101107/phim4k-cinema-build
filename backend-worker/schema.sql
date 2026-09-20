-- Persistent data for the Phim4K licensing backend.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS license_keys (
  license_key TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'STANDARD',
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  assigned_telegram_id TEXT,
  activated_telegram_id TEXT,
  device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_telegram ON license_keys(activated_telegram_id);
CREATE INDEX IF NOT EXISTS idx_license_device ON license_keys(device_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'admin', 'guest')),
  license_key TEXT,
  telegram_id TEXT,
  device_id TEXT NOT NULL,
  device_public_jwk TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'STANDARD',
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at TEXT NOT NULL,
  refresh_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON auth_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_license ON auth_sessions(license_key, revoked_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_device ON auth_sessions(device_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_active_user
  ON auth_sessions(license_key) WHERE role = 'user' AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_active_role_device
  ON auth_sessions(role, device_id) WHERE role IN ('admin', 'guest') AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS consumed_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consumed_refresh_expiry ON consumed_refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS request_nonces (
  session_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (session_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_request_nonce_expiry ON request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS device_access_requests (
  license_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  PRIMARY KEY (license_key, device_id),
  FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_access_status ON device_access_requests(status, requested_at);

CREATE TABLE IF NOT EXISTS bans (
  telegram_id TEXT PRIMARY KEY,
  scopes_json TEXT NOT NULL DEFAULT '["telegram"]',
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  platform TEXT PRIMARY KEY,
  url TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  signer TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_progress (
  owner_id TEXT NOT NULL,
  movie_slug TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  movie_name TEXT NOT NULL,
  episode_name TEXT NOT NULL,
  thumb_url TEXT NOT NULL DEFAULT '',
  current_seconds REAL NOT NULL,
  duration_seconds REAL NOT NULL,
  progress_percent INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, movie_slug, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_progress_owner_updated
  ON watch_progress(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_telegram_id TEXT,
  target_key TEXT,
  target_telegram_id TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_telegram_id, id DESC);
