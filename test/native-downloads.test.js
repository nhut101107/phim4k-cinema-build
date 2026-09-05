const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('TV downloader shows completion and requires explicit installation click', async () => {
  let installs = 0;
  const plugin = { start: async () => ({ status: 'complete' }), install: async () => { installs++; return { needsPermission: true }; } };
  const window = { Capacitor: { getPlatform: () => 'android', registerPlugin: () => plugin } };
  const context = { window, navigator: { userAgent: 'Android Phim4KTV' }, setTimeout };
  vm.runInNewContext(fs.readFileSync('public/js/native-downloads.js', 'utf8'), context);
  const button = { removeAttribute() {}, textContent: '' };
  await window.Phim4KNativeDownloads.open(button, 'https://example.com/a.apk');
  assert.equal(installs, 0);
  assert.match(button.textContent, /Bấm kiểm tra/);
  button.onclick({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(installs, 1);
  assert.match(button.textContent, /Cho phép cài đặt/);
});
test('TV downloader makes failure visible and allows a retry', async () => {
  const window = { Capacitor: { getPlatform: () => 'android', registerPlugin: () => ({ start: async () => { throw new Error('Không có mạng'); } }) } };
  vm.runInNewContext(fs.readFileSync('public/js/native-downloads.js', 'utf8'), { window, navigator: { userAgent: 'Phim4KTV' }, setTimeout });
  const button = { removeAttribute() {}, textContent: '' };
  await window.Phim4KNativeDownloads.open(button, 'https://example.com/a.apk');
  assert.equal(button.textContent, 'Không có mạng');
  await window.Phim4KNativeDownloads.open(button, 'https://example.com/a.apk');
  assert.equal(button.textContent, 'Không có mạng');
});
