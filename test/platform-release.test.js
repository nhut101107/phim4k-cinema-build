const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const platform = require('../public/js/platform.js');
const { resolveAsset, allowedExternal } = require('../desktop/policy.cjs');
test('platform recommendations distinguish TV, Windows, Android and iOS', () => {
  assert.equal(platform.detect('Mozilla Android Phim4KTV'), 'android_tv');
  assert.equal(platform.detect('Windows NT 10.0'), 'windows');
  assert.equal(platform.detect('iPhone'), 'ios');
  assert.equal(platform.detect('Android Pixel'), 'android');
});
test('download resolver handles old/new schemas and never enables placeholder or unsafe links', () => {
  assert.equal(platform.release({ windowsUrl: 'https://example.com/app.exe', windowsVersion: '1' }, 'windows').version, '1');
  assert.equal(platform.release({ android_tv: { url: 'https://example.com/tv.apk' } }, 'android_tv').url, 'https://example.com/tv.apk');
  for (const url of ['/download/exe', 'javascript:alert(1)', 'file:///C:/key', 'http://example.com/a', 'https://user:pass@example.com/a']) assert.equal(platform.safeUrl(url), '');
  assert.equal(platform.release({}, 'ios').url, '');
});
test('desktop local protocol contains paths and rejects foreign hosts or credential files', () => {
  const root = path.resolve('public');
  assert.equal(resolveAsset(root, 'phim4k://app/index.html'), path.join(root, 'index.html'));
  for (const url of ['phim4k://evil/index.html', 'phim4k://app/%2e%2e%2f.env', 'phim4k://app/%5c..%5cauth.json', 'file:///C:/secret.json']) assert.equal(resolveAsset(root, url), null);
  assert.equal(allowedExternal('https://example.com/app.apk'), true);
  assert.equal(allowedExternal('powershell:run'), false);
});
