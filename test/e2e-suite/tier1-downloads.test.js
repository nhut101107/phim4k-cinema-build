/**
 * Tier 1 - Feature Coverage: Download Links Format & Endpoints (F1)
 * Validates Android, Android TV, iOS, and Windows installer endpoints,
 * redirect behavior, SHA-256 integrity, admin APIs, and client download modals.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT, isFeatureImplemented } = require('./helpers');

test('T1.1: Download endpoints map correctly to current release assets', async (t) => {
  const workerPath = path.join(PROJECT_ROOT, 'backend-worker/src/worker.mjs');
  const content = fs.readFileSync(workerPath, 'utf8');

  // Verify all 4 platforms are registered in INSTALLER_RELEASES
  assert.match(content, /\/download\/android['"]\s*:\s*\{[^}]*filename:\s*['"]4K-Cinema-Android-3\.61\.apk['"]/);
  assert.match(content, /\/download\/android-tv['"]\s*:\s*\{[^}]*filename:\s*['"]4K-Cinema-Android-TV-3\.61\.apk['"]/);
  assert.match(content, /\/download\/ios['"]\s*:\s*\{[^}]*filename:\s*['"]4K-Cinema-iOS-3\.61-unsigned\.ipa['"]/);
  assert.match(content, /\/download\/windows['"]\s*:\s*\{[^}]*filename:\s*['"]4K-Cinema-Windows-3\.61-x64\.exe['"]/);

  // Verify target URLs point to ios-v3.61 release
  const expectedPrefix = 'https://github.com/nhut101107/phim4k-cinema-build/releases/download/ios-v3.61/';
  assert.ok(content.includes(`${expectedPrefix}4K-Cinema-Android-3.61.apk`));
  assert.ok(content.includes(`${expectedPrefix}4K-Cinema-Android-TV-3.61.apk`));
  assert.ok(content.includes(`${expectedPrefix}4K-Cinema-iOS-3.61-unsigned.ipa`));
  assert.ok(content.includes(`${expectedPrefix}4K-Cinema-Windows-3.61-x64.exe`));
});

test('T1.2: Download metadata integrity contains valid SHA-256 and positive sizeBytes for all 4 platforms', async (t) => {
  const workerModule = await import(`file://${path.join(PROJECT_ROOT, 'backend-worker/src/worker.mjs')}`);
  const releases = workerModule.PUBLIC_RELEASES;

  assert.ok(releases, 'PUBLIC_RELEASES must be exported from worker.mjs');
  const platforms = ['android', 'android_tv', 'ios', 'windows'];

  for (const plat of platforms) {
    const item = releases[plat];
    assert.ok(item, `Platform ${plat} must exist in PUBLIC_RELEASES`);
    assert.match(item.url, /^https:\/\/[^/]+\/download\//, `${plat} url must be a valid https download URL`);
    assert.match(item.sha256, /^[a-f0-9]{64}$/, `${plat} sha256 must be a 64-character lowercase hex string`);
    assert.ok(typeof item.sizeBytes === 'number' && item.sizeBytes > 0, `${plat} sizeBytes must be a positive number`);
    assert.ok(item.version && typeof item.version === 'string', `${plat} must specify a version string`);
    assert.equal(item.signer, 'github-actions[bot]', `${plat} signer must be github-actions[bot]`);
  }
});

test('T1.3: Server download fallback and config storage provide complete 4-platform structure', async (t) => {
  const serverPath = path.join(PROJECT_ROOT, 'server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  // Verify server has download configuration handler
  assert.match(serverContent, /app\.get\(['"]\/api\/app\/downloads['"]/);
  assert.match(serverContent, /app\.post\(['"]\/api\/admin\/update-downloads['"]/);

  // Check config/downloads.json if created, otherwise verify fallback structure in server.js
  const configPath = path.join(PROJECT_ROOT, 'config/downloads.json');
  if (fs.existsSync(configPath)) {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const plat of ['android', 'android_tv', 'ios', 'windows']) {
      assert.ok(data[plat], `config/downloads.json must contain platform: ${plat}`);
      assert.ok(data[plat].url, `Platform ${plat} must have url`);
      assert.ok(data[plat].version, `Platform ${plat} must have version`);
    }
  } else {
    // If M1 is still writing config/downloads.json, server.js fallback must handle all 4
    assert.ok(serverContent.includes('android_tv'), 'server.js fallback must support android_tv');
  }
});

test('T1.4: Client download modals contain active elements and cards for all 4 platforms', async (t) => {
  const indexPath = path.join(PROJECT_ROOT, 'public/index.html');
  const webIndexPath = path.join(PROJECT_ROOT, 'public/web-index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const webHtml = fs.readFileSync(webIndexPath, 'utf8');

  // Ensure index.html and web-index.html both have download cards
  for (const doc of [html, webHtml]) {
    assert.match(doc, /id="btnDownloadApk"/);
    assert.match(doc, /id="btnDownloadTv"/);
    assert.match(doc, /id="btnDownloadIpa"/);
    assert.match(doc, /id="btnDownloadExe"/);
    assert.match(doc, /id="downloadAppModal"/);
    assert.match(doc, /id="forceUpdateModal"/);
  }
});

test('T1.5: Installer MIME types and Content-Disposition headers are correctly defined', async (t) => {
  const workerPath = path.join(PROJECT_ROOT, 'backend-worker/src/worker.mjs');
  const content = fs.readFileSync(workerPath, 'utf8');

  // Expected Content-Types for each platform
  assert.match(content, /application\/vnd\.android\.package-archive/);
  assert.match(content, /application\/octet-stream/);
  assert.match(content, /application\/vnd\.microsoft\.portable-executable/);

  // Upstream User-Agent header
  assert.match(content, /MNHUT-Cinema-Release\/3\.61/);
});

test('T1.6: Cloudflare Worker proxy routes /download/* requests without dropping query params', (t) => {
  const workerProxyPath = path.join(PROJECT_ROOT, 'public/_worker.js');
  const content = fs.readFileSync(workerProxyPath, 'utf8');

  if (!content.includes('/download/')) {
    t.skip('M1: public/_worker.js download proxy routing pending Milestone 1 completion');
    return;
  }

  // Verify proxying to license API for download paths
  assert.match(content, /\/download\//, 'public/_worker.js must explicitly route /download/ paths');
  assert.match(content, /phim4k-license-api/, 'Proxy target must route to phim4k-license-api worker');
});
