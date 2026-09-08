import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { openMediaTicket } from '../src/worker.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async run() { return sqlite.prepare(sql).run(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { return sqlite.prepare(sql).run(); },
      };
    },
  };
  const env = { DB, ADMIN_LICENSE_KEY: 'TEST-ADMIN-SECRET', ADMIN_TELEGRAM_ID: '1000000001', ALLOW_LEGACY_TEST_AUTH: '1' };
  let sequence = 0;
  const request = (path, { method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request(`https://test.example${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `198.51.100.${++sequence}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const seed = (key) => sqlite.prepare('INSERT INTO license_keys (license_key,created_at,updated_at) VALUES (?,?,?)').run(key, '2026-01-01', '2026-01-01');
  return { sqlite, request, seed, env };
}

const progress = {
  slug: 'tuyet-the-chien-hon',
  episodeId: 'tap-12',
  name: 'Tuyệt Thế Chiến Hồn',
  epName: 'Tập 12',
  thumb: 'https://test.example/api/media/image?t=abcdefghijklmnopqrstuvwxyz_0123456789',
  currentTime: 615.4,
  duration: 1440,
};

test('watch progress follows an authenticated license after an approved device reset', async () => {
  const f = fixture();
  f.seed('P4K-WATCH-ONE');
  f.seed('P4K-WATCH-TWO');
  try {
    await f.request('/api/auth/activate', { method: 'POST', body: { key: 'P4K-WATCH-ONE', deviceId: 'old-phone' } });
    const ownerHeaders = { 'x-license-key': 'P4K-WATCH-ONE', 'x-device-id': 'old-phone', 'x-app-version': '3.4.24' };
    const saved = await f.request('/api/watch-progress', { method: 'POST', headers: ownerHeaders, body: { items: [progress] } });
    assert.equal(saved.status, 202);

    const firstRead = await (await f.request('/api/watch-progress', { headers: ownerHeaders })).json();
    assert.equal(firstRead.items.length, 1);
    assert.equal(firstRead.items[0].slug, progress.slug);
    assert.equal(firstRead.items[0].currentTime, progress.currentTime);
    assert.equal(firstRead.items[0].progressPercent, 43);

    await f.request('/api/auth/activate', { method: 'POST', body: { key: 'P4K-WATCH-TWO', deviceId: 'other-phone' } });
    const otherRead = await (await f.request('/api/watch-progress', { headers: { 'x-license-key': 'P4K-WATCH-TWO', 'x-device-id': 'other-phone' } })).json();
    assert.deepEqual(otherRead.items, []);

    f.sqlite.prepare('UPDATE license_keys SET device_id=? WHERE license_key=?').run('new-phone', 'P4K-WATCH-ONE');
    const restored = await (await f.request('/api/watch-progress', { headers: { 'x-license-key': 'P4K-WATCH-ONE', 'x-device-id': 'new-phone' } })).json();
    assert.equal(restored.items[0].epName, 'Tập 12');
    assert.equal(restored.items[0].currentTime, progress.currentTime);

    const staleDevice = await f.request('/api/watch-progress', { headers: ownerHeaders });
    assert.equal(staleDevice.status, 403);
  } finally { f.sqlite.close(); }
});

test('watch progress validates input, removes completed items and supports server clear', async () => {
  const f = fixture();
  f.seed('P4K-WATCH-CLEAR');
  try {
    await f.request('/api/auth/activate', { method: 'POST', body: { key: 'P4K-WATCH-CLEAR', deviceId: 'phone-a' } });
    const headers = { 'x-license-key': 'P4K-WATCH-CLEAR', 'x-device-id': 'phone-a' };
    const invalid = await f.request('/api/watch-progress', { method: 'POST', headers, body: { item: { ...progress, slug: '../bad' } } });
    assert.equal(invalid.status, 400);

    await f.request('/api/watch-progress', { method: 'POST', headers, body: { item: progress } });
    await f.request('/api/watch-progress', { method: 'POST', headers, body: { item: { ...progress, currentTime: 1430 } } });
    assert.deepEqual((await (await f.request('/api/watch-progress', { headers })).json()).items, []);

    await f.request('/api/watch-progress', { method: 'POST', headers, body: { item: progress } });
    assert.equal((await f.request('/api/watch-progress', { method: 'DELETE', headers })).status, 200);
    assert.deepEqual((await (await f.request('/api/watch-progress', { headers })).json()).items, []);
  } finally { f.sqlite.close(); }
});

test('watch progress replaces a mismatched legacy poster with the image for its exact movie slug', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  let catalogReads = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://catalog.example/phim/tuyet-the-chien-hon');
    catalogReads += 1;
    return new Response(JSON.stringify({
      movie: { thumb_url: 'https://images.example/uploads/correct-tuyet-the-chien-hon.webp' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  Object.assign(f.env, {
    MOVIE_CATALOG_ORIGIN: 'https://catalog.example',
    MOVIE_IMAGE_HOSTS: 'images.example',
    MEDIA_TICKET_SECRET: 'fixture-media-ticket-secret-at-least-32-characters',
  });
  f.seed('P4K-WATCH-IMAGE');
  try {
    await f.request('/api/auth/activate', { method: 'POST', body: { key: 'P4K-WATCH-IMAGE', deviceId: 'image-phone' } });
    const headers = { 'x-license-key': 'P4K-WATCH-IMAGE', 'x-device-id': 'image-phone' };
    await f.request('/api/watch-progress', { method: 'POST', headers, body: { item: { ...progress, thumb: '' } } });
    f.sqlite.prepare('UPDATE watch_progress SET thumb_url=?').run('https://images.example/uploads/wrong-spider-man.webp');

    const restored = await (await f.request('/api/watch-progress', { headers })).json();
    assert.equal(restored.items.length, 1);
    assert.match(restored.items[0].thumb, /^https:\/\/test\.example\/api\/media\/image\?t=/);
    assert.doesNotMatch(restored.items[0].thumb, /images\.example/);
    const persisted = f.sqlite.prepare('SELECT thumb_url, updated_at FROM watch_progress').get();
    assert.equal(persisted.thumb_url, restored.items[0].thumb);
    assert.equal(persisted.updated_at, restored.items[0].updatedAt);
    const token = new URL(restored.items[0].thumb).searchParams.get('t');
    const ticket = await openMediaTicket(token, f.env, 'image');
    assert.equal(ticket.url, 'https://images.example/uploads/correct-tuyet-the-chien-hon.webp');
    assert.equal(ticket.movieSlug, progress.slug);
    assert.equal(catalogReads, 1);

    const secondRead = await (await f.request('/api/watch-progress', { headers })).json();
    assert.equal(secondRead.items[0].thumb, restored.items[0].thumb);
    assert.equal(secondRead.items[0].updatedAt, restored.items[0].updatedAt);
    assert.equal(catalogReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('admin progress is private but survives a new device identifier', async () => {
  const f = fixture();
  try {
    const adminHeaders = {
      'x-license-key': f.env.ADMIN_LICENSE_KEY,
      'x-telegram-id': f.env.ADMIN_TELEGRAM_ID,
      'x-device-id': 'admin-phone-a',
    };
    assert.equal((await f.request('/api/watch-progress', { method: 'POST', headers: adminHeaders, body: { item: progress } })).status, 202);
    const restored = await (await f.request('/api/watch-progress', { headers: { ...adminHeaders, 'x-device-id': 'admin-phone-b' } })).json();
    assert.equal(restored.items.length, 1);
    assert.equal(restored.items[0].slug, progress.slug);

    const denied = await f.request('/api/watch-progress', { headers: { ...adminHeaders, 'x-telegram-id': '1111111111' } });
    assert.equal(denied.status, 403);
  } finally { f.sqlite.close(); }
});
