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

ALTER TABLE downloads ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE downloads ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE downloads ADD COLUMN signer TEXT NOT NULL DEFAULT '';
