const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');

test('MNHUT activation gate keeps the authentication contract intact', () => {
  for (const id of [
    'activationGate', 'activationForm', 'keyInput', 'telegramInput',
    'btnActivate', 'activateSpinner', 'btnRequestDeviceAccess',
    'gateMessage', 'maintenanceNotice', 'maintenanceMessage',
    'maintenanceUntil', 'maintenanceRetryBtn', 'gateDownloadBtn'
  ]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
  assert.match(index, /onsubmit="handleActivation\(event\)"/);
  assert.match(index, /onclick="requestDeviceOnlyAccess\(\)"/);
  assert.match(index, /onclick="Auth\.retryAfterMaintenance\(\)"/);
});

test('activation gate uses restrained MNHUT branding and compact copy', () => {
  assert.match(index, /class="gate-card license-shell"/);
  assert.match(index, /class="mnhut-mark"/);
  assert.match(index, />MNHUT</);
  assert.match(index, />CINEMA</);
  assert.match(index, /Xác thực thiết bị/);
  assert.match(index, /<h2>Nhập key<\/h2>/);
  assert.match(index, /Nhập key một lần/);
  assert.match(css, /\.gate-card\.license-shell\s*\{/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /\.license-key-field/);
});
