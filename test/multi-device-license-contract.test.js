const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'backend-worker/src/worker.mjs'), 'utf8');
const sessions = fs.readFileSync(path.join(root, 'backend-worker/src/session-security.mjs'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'backend-worker/schema.sql'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'public/js/auth.js'), 'utf8');

test('licenses support an Admin-controlled device capacity', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS license_limits/);
  assert.match(schema, /max_devices INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS license_devices/);
  assert.match(worker, /DEVICE_LIMIT_REACHED/);
  assert.match(worker, /set-max-devices/);
  assert.match(worker, /remove-device/);
  assert.match(worker, /maxDevices < state\.deviceCount/);
});

test('allowed devices keep independent active sessions', () => {
  assert.match(sessions, /license_key = \? AND device_id = \?/);
  assert.match(schema, /idx_auth_sessions_active_user_device/);
  assert.doesNotMatch(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_active_user\s+ON auth_sessions\(license_key\)/);
});

test('Admin UI can configure and inspect multiple devices per key', () => {
  assert.match(index, /id="newKeyMaxDevices"/);
  assert.match(admin, /promptSetMaxDevices/);
  assert.match(admin, /removeDevice/);
  assert.match(admin, /deviceCount/);
  assert.match(admin, /maxDevices/);
});

test('device is remembered through a secure session instead of persisting the raw key', () => {
  assert.match(auth, /SessionVault\.save\(res\)/);
  assert.match(auth, /localStorage\.removeItem\('phim4k_key'\)/);
  assert.match(auth, /syncFromServer/);
});
