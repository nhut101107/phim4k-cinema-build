import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';

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
  const env = { DB, ALLOW_LEGACY_TEST_AUTH: '1' };
  let sequence = 0;
  const request = (path, { method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request(`https://test.example${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++sequence}`, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const activate = async (key, deviceId) => {
    sqlite.prepare('INSERT INTO license_keys (license_key,created_at,updated_at) VALUES (?,?,?)').run(key, '2026-01-01', '2026-01-01');
    assert.equal((await request('/api/auth/activate', { method: 'POST', body: { key, deviceId } })).status, 200);
    return { 'x-license-key': key, 'x-device-id': deviceId };
  };
  return { sqlite, request, activate };
}

test('account overview aggregates real watch time and isolates each license', async () => {
  const f = fixture();
  try {
    const owner = await f.activate('P4K-ACCOUNT-ONE', 'phone-one');
    const other = await f.activate('P4K-ACCOUNT-TWO', 'phone-two');
    const event = { action: 'playback_watch', context: { movie: 'Phim thử nghiệm', movieSlug: 'phim-thu-nghiem', watched: 420 } };
    assert.equal((await f.request('/api/telemetry', { method: 'POST', headers: owner, body: { events: [event, { ...event, context: { ...event.context, watched: 180 } }] } })).status, 202);

    const overview = await (await f.request('/api/account/overview', { headers: owner })).json();
    assert.equal(overview.stats.watchedSeconds, 600);
    assert.equal(overview.stats.movieCount, 1);
    assert.equal(overview.stats.byDay.length, 1);
    assert.equal(overview.recentMovies[0].slug, 'phim-thu-nghiem');
    assert.equal(overview.recentMovies[0].watchedSeconds, 600);

    const isolated = await (await f.request('/api/account/overview', { headers: other })).json();
    assert.equal(isolated.stats.watchedSeconds, 0);
    assert.equal(isolated.stats.movieCount, 0);
    assert.deepEqual(isolated.library, []);
  } finally { f.sqlite.close(); }
});

test('account library saves and removes watchlist and favorite entries', async () => {
  const f = fixture();
  try {
    const headers = await f.activate('P4K-LIBRARY-ONE', 'tablet-one');
    const movie = { slug: 'mot-bo-phim-hay', name: 'Một Bộ Phim Hay' };
    assert.equal((await f.request('/api/account/library', { method: 'POST', headers, body: { ...movie, list: 'watchlist' } })).status, 201);
    assert.equal((await f.request('/api/account/library', { method: 'POST', headers, body: { ...movie, list: 'favorites' } })).status, 201);

    let overview = await (await f.request('/api/account/overview', { headers })).json();
    assert.deepEqual(overview.library.map((item) => item.list).sort(), ['favorites', 'watchlist']);

    assert.equal((await f.request('/api/account/library', { method: 'DELETE', headers, body: { slug: movie.slug, list: 'watchlist' } })).status, 200);
    overview = await (await f.request('/api/account/overview', { headers })).json();
    assert.deepEqual(overview.library.map((item) => item.list), ['favorites']);

    const invalid = await f.request('/api/account/library', { method: 'POST', headers, body: { ...movie, list: '../../admin' } });
    assert.equal(invalid.status, 400);
  } finally { f.sqlite.close(); }
});

