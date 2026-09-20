import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  sqlite.prepare("INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('free_access', 'true', ?)").run(new Date().toISOString());
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
      };
    },
  };
  return {
    sqlite,
    env: {
      DB,
      ALLOW_LEGACY_TEST_AUTH: '1',
      MOVIE_CATALOG_ORIGIN: 'https://catalog.example',
      MOVIE_IMAGE_HOSTS: 'images.example',
      MEDIA_TICKET_SECRET: 'fixture-media-ticket-secret-at-least-32-characters',
    },
  };
}

function viewerRequest(path, init = {}) {
  return new Request(`https://example.workers.dev${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-device-id': 'availability-fixture', ...(init.headers || {}) },
  });
}

test('a movie is hidden everywhere after all equivalent sources are definitively gone', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const deadMovie = {
    movie: { slug: 'dead-movie', name: 'Dead movie' },
    episodes: [{ server_name: 'Server A', server_data: [{ name: 'Full', slug: 'full', link_m3u8: 'https://video.example/dead.m3u8' }] }],
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.origin === 'https://video.example') return new Response('gone', { status: 404 });
    if (url.pathname === '/phim/dead-movie') return new Response(JSON.stringify(deadMovie), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/v1/api/danh-sach/phim-moi-cap-nhat') {
      return new Response(JSON.stringify({ data: { items: [
        { slug: 'dead-movie', name: 'Dead movie' },
        { slug: 'live-movie', name: 'Live movie' },
      ] } }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected upstream: ${url.href}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'dead-movie', server: 0, episode: 0 }),
    }), f.env);
    assert.equal(playback.status, 404);
    assert.equal((await playback.json()).code, 'STREAM_SOURCE_OFFLINE');
    assert.equal(f.sqlite.prepare("SELECT status FROM movie_availability WHERE movie_slug = 'dead-movie'").get().status, 'offline');

    const catalog = await worker.fetch(viewerRequest('/api/movies/catalog?page=1'), f.env);
    assert.equal(catalog.status, 200);
    assert.deepEqual((await catalog.json()).items.map((movie) => movie.slug), ['live-movie']);

    const detail = await worker.fetch(viewerRequest('/api/movies/detail/dead-movie'), f.env);
    assert.equal(detail.status, 404);
    assert.equal((await detail.json()).code, 'MOVIE_SOURCES_OFFLINE');
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('one surviving equivalent server prevents the movie from being hidden', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const payload = {
    movie: { slug: 'fallback-movie', name: 'Fallback movie' },
    episodes: [
      { server_name: 'Dead', server_data: [{ name: 'Tập 1', slug: 'tap-1', link_m3u8: 'https://video.example/dead.m3u8' }] },
      { server_name: 'Live', server_data: [{ name: 'Tập 1', slug: 'tap-1', link_m3u8: 'https://video.example/live.m3u8' }] },
    ],
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/phim/fallback-movie') return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://video.example/dead.m3u8') return new Response('gone', { status: 404 });
    if (url.href === 'https://video.example/live.m3u8') return new Response('#EXTM3U\n#EXT-X-ENDLIST', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    throw new Error(`unexpected upstream: ${url.href}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'fallback-movie', server: 0, episode: 0 }),
    }), f.env);
    assert.equal(playback.status, 404);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM movie_availability WHERE movie_slug = 'fallback-movie'").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});
