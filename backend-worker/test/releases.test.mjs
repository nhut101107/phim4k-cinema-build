import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validDownloadUrl, normalizeTelemetryEvents } from '../src/worker.mjs';
function fixture() {
  const rows = new Map();
  let writes = 0;
  const db = { prepare(sql) {
    const statement = { sql, values: [], bind(...values) { this.values = values; return this; }, async first() { return null; }, async all() { return { results: [...rows.values()] }; }, async run() { return { success: true }; } };
    return statement;
  }, async batch(statements) {
    writes++;
    for (const item of statements) { const [platform, url, version] = item.values; rows.set(platform, { platform, url, version }); }
    return [];
  } };
  return { db, rows, writes: () => writes };
}
test('release URLs reject non-HTTPS and embedded credentials', () => {
  for (const bad of ['https://', 'http://example.com', 'javascript:alert(1)', 'https://u:p@example.com']) assert.equal(validDownloadUrl(bad), false);
  assert.equal(validDownloadUrl('https://github.com/org/repo/releases/download/v1/a.apk'), true);
});
test('downloads admin route is authorized, atomic and compatible with clients', async () => {
  const f = fixture();
  const env = { DB: f.db, ADMIN_LICENSE_KEY: 'MASTER-RELEASE-KEY', ADMIN_TELEGRAM_ID: '5992662564' };
  const send = (body, admin = true) => worker.fetch(new Request('https://example.test/api/admin/update-downloads', { method: 'POST', headers: { 'content-type': 'application/json', 'x-license-key': admin ? 'MASTER-RELEASE-KEY' : 'USER-KEY', 'x-telegram-id': '5992662564' }, body: JSON.stringify(body) }), env);
  assert.equal((await send({}, false)).status, 403);
  assert.equal((await send({ androidUrl: 'https://example.com/a.apk', windowsUrl: 'javascript:bad' })).status, 400);
  assert.equal(f.writes(), 0);
  assert.equal((await send({ windowsUrl: 'https://example.com/a.exe', windowsVersion: '3.4.14', android_tvUrl: 'https://example.com/tv.apk', android_tvVersion: '3.4.14' })).status, 200);
  assert.equal(f.writes(), 1);
  const response = await worker.fetch(new Request('https://example.test/api/app/downloads'), env);
  const data = await response.json();
  assert.equal(data.windows.url, data.windowsUrl);
  assert.equal(data.android_tv.version, '3.4.14');
});
test('streamed JSON body is bounded even without Content-Length', async () => {
  const f = fixture();
  const response = await worker.fetch(new Request('https://example.test/api/admin/update-downloads', { method: 'POST', headers: { 'x-license-key': 'MASTER-BODY-LIMIT', 'x-telegram-id': '5992662564' }, body: JSON.stringify({ androidUrl: 'a'.repeat(18000) }) }), { DB: f.db, ADMIN_LICENSE_KEY: 'MASTER-BODY-LIMIT', ADMIN_TELEGRAM_ID: '5992662564' });
  assert.equal(response.status, 413);
  assert.equal(f.writes(), 0);
});
test('new viewer diagnostics are bounded and omit sensitive fields', () => {
  const events = normalizeTelemetryEvents([{ action: 'heartbeat', context: { runtime: 'Android TV', viewport: '1920x1080', buffered: 8, password: 'do-not-log', cookie: 'secret', error: 'https://secret.example/token' } }]);
  assert.equal(events[0].context.buffered, 8);
  assert.doesNotMatch(JSON.stringify(events), /do-not-log|secret/);
});
