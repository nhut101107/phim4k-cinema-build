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
  updated_at TEXT NOT NULL
);

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
