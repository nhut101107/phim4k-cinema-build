ALTER TABLE license_devices ADD COLUMN last_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE license_devices ADD COLUMN device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE license_devices ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS security_bans (
  scope TEXT NOT NULL CHECK(scope IN ('device', 'ip')),
  value TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, value)
);

CREATE INDEX IF NOT EXISTS idx_security_bans_value ON security_bans(value);
