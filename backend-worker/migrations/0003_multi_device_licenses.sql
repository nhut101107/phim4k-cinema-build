-- Multi-device licenses: keep existing keys on one device by default while
-- allowing Admin to raise the device limit per key.
CREATE TABLE IF NOT EXISTS license_limits (
  license_key TEXT PRIMARY KEY,
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK(max_devices BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS license_devices (
  license_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  approved_by TEXT,
  PRIMARY KEY (license_key, device_id),
  UNIQUE (license_key, slot),
  FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_license_devices_device ON license_devices(device_id);

INSERT OR IGNORE INTO license_limits (license_key, max_devices, updated_at)
SELECT license_key, 1, updated_at FROM license_keys;

INSERT OR IGNORE INTO license_devices (license_key, device_id, slot, created_at, last_seen_at, approved_by)
SELECT license_key, device_id, 1, created_at, updated_at, 'legacy'
FROM license_keys
WHERE device_id IS NOT NULL AND TRIM(device_id) <> '';

DROP INDEX IF EXISTS idx_auth_sessions_active_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_active_user_device
  ON auth_sessions(license_key, device_id) WHERE role = 'user' AND revoked_at IS NULL;
