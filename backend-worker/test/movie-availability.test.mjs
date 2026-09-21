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

test('a movie stays visible even when all equivalent sources are definitively gone', async () => {
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
    assert.deepEqual((await catalog.json()).items.map((movie) => movie.slug), ['dead-movie', 'live-movie']);

    const detail = await worker.fetch(viewerRequest('/api/movies/detail/dead-movie'), f.env);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).movie.slug, 'dead-movie');
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('playback automatically selects a surviving equivalent server', async () => {
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
    assert.equal(playback.status, 200);
    assert.equal((await playback.json()).selectedServer, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM movie_availability WHERE movie_slug = 'fallback-movie'").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('a direct HLS backup provider is merged without exposing an ad embed page', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const primary = {
    movie: { slug: 'backup-movie', name: 'Backup movie' },
    episodes: [{ server_name: 'Primary', server_data: [{ name: 'Full', slug: 'full', link_m3u8: 'https://video.example/dead.m3u8' }] }],
  };
  const backup = {
    movie: {
      slug: 'backup-movie',
      episodes: [{ server_name: 'Backup', items: [
        { name: 'Full', slug: 'full', m3u8: 'https://backup-video.example/live.m3u8' },
        { name: 'Ads', slug: 'ads', embed: 'https://ads.example/embed.php?id=1' },
      ] }],
    },
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.origin === 'https://catalog.example') return new Response(JSON.stringify(primary), { headers: { 'content-type': 'application/json' } });
    if (url.origin === 'https://phim.nguonc.com') return new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://video.example/dead.m3u8') return new Response('gone', { status: 410 });
    if (url.href === 'https://backup-video.example/live.m3u8') return new Response('#EXTM3U\n#EXT-X-ENDLIST', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    throw new Error(`unexpected upstream: ${url.href}`);
  };
  try {
    const detail = await worker.fetch(viewerRequest('/api/movies/detail/backup-movie'), f.env);
    assert.equal(detail.status, 200);
    const detailJson = await detail.json();
    assert.equal(detailJson.episodes.length, 2);
    assert.equal(detailJson.episodes[1].server_data.length, 1);

    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'backup-movie', server: 0, episode: 0 }),
    }), f.env);
    assert.equal(playback.status, 200);
    assert.equal((await playback.json()).selectedServer, 1);
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('backup discovery matches renamed provider slugs by title and season', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const primary = {
    movie: {
      slug: 'phat-sung-cuoi-cung-phan-4',
      name: 'Phát Súng Cuối Cùng (Phần 4)',
      origin_name: 'Reacher',
      tmdb: { season: 4 },
    },
    episodes: [{ server_name: 'Vietsub', server_data: [{ name: 'Tập 01', slug: 'tap-01', link_m3u8: 'https://video.example/dead.m3u8' }] }],
  };
  const search = { items: [
    { slug: 'reacher-phat-sung-cuoi-cung-phan-3', name: 'Reacher: Phát Súng Cuối Cùng (Phần 3)', original_name: 'Reacher (Season 3)' },
    { slug: 'reacher-phat-sung-cuoi-cung-phan-4', name: 'Reacher: Phát Súng Cuối Cùng (Phần 4)', original_name: 'Reacher (Season 4)' },
  ] };
  const backup = { movie: { slug: 'reacher-phat-sung-cuoi-cung-phan-4', episodes: [
    { server_name: 'Vietsub #1', items: [{ name: '1', slug: 'tap-1', link_m3u8: 'https://video.example/live.m3u8' }] },
  ] } };
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url.href);
    if (url.origin === 'https://catalog.example') return new Response(JSON.stringify(primary), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/film/phat-sung-cuoi-cung-phan-4') return new Response('missing', { status: 404 });
    if (url.pathname === '/api/films/search') return new Response(JSON.stringify(search), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/film/reacher-phat-sung-cuoi-cung-phan-4') return new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://video.example/dead.m3u8') return new Response('gone', { status: 404 });
    if (url.href === 'https://video.example/live.m3u8') return new Response('#EXTM3U\n#EXT-X-ENDLIST', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    throw new Error(`unexpected upstream: ${url.href}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phat-sung-cuoi-cung-phan-4', server: 0, episode: 0 }),
    }), f.env);
    assert.equal(playback.status, 200);
    assert.equal((await playback.json()).selectedServer, 1);
    assert.ok(requests.some((url) => url.includes('/api/films/search?keyword=Reacher')));
    assert.ok(requests.some((url) => url.includes('/api/film/reacher-phat-sung-cuoi-cung-phan-4')));
    assert.ok(!requests.some((url) => url.includes('/api/film/reacher-phat-sung-cuoi-cung-phan-3')));
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('a StreamC backup is resolved server-side and disguised segments are relayed as video', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const embed = 'https://embed.streamc.xyz/embed.php?hash=5db2c52df547af3cf743de9c119ecd25';
  const playlist = 'https://embed.streamc.xyz/signed_playlist_token_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcdefghijklmnopqrstuvwxyz';
  const segment = 'https://seouls11.amass11.top/5db2c52df547af3cf743de9c119ecd25/streamaaa0000.png';
  const primary = {
    movie: { slug: 'streamc-movie', name: 'StreamC movie' },
    episodes: [{ server_name: 'Dead', server_data: [{ name: 'Full', slug: 'full', link_m3u8: 'https://video.example/dead.m3u8' }] }],
  };
  const backup = { movie: { slug: 'streamc-movie', episodes: [
    { server_name: 'Vietsub #1', items: [{ name: 'Full', slug: 'full', embed }] },
  ] } };
  let bootstrapPosts = 0;
  let embedWarmups = 0;
  let deadPrimaryProbes = 0;
  let playlistFetches = 0;
  const timeoutValues = [];
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    timeoutValues.push(milliseconds);
    return originalTimeout.call(AbortSignal, milliseconds);
  };
  let segmentReferer = '';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.origin === 'https://catalog.example') return new Response(JSON.stringify(primary), { headers: { 'content-type': 'application/json' } });
    if (url.origin === 'https://phim.nguonc.com') return new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://video.example/dead.m3u8') {
      deadPrimaryProbes += 1;
      return new Response('gone', { status: 404 });
    }
    if (url.href === embed && init.method === 'POST') {
      bootstrapPosts += 1;
      assert.equal(new Headers(init.headers).get('origin'), 'https://embed.streamc.xyz');
      const issuedAt = Math.floor(Date.now() / 1000);
      return new Response(JSON.stringify({ preissued: { playlist, playlistFormat: 'hls', issuedAt, expiresAt: issuedAt + 14400 } }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.href === embed) {
      embedWarmups += 1;
      return new Response('<html>player</html>', { headers: { 'content-type': 'text/html' } });
    }
    if (url.href === playlist) {
      playlistFetches += 1;
      return new Response(`#EXTM3U\n#EXTINF:10,\n${segment}\n#EXT-X-ENDLIST`, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    if (url.href === segment) {
      segmentReferer = new Headers(init.headers).get('referer') || '';
      return new Response(new Uint8Array([0x47, 0x40, 0x11, 0x10]), { headers: { 'content-type': 'image/png' } });
    }
    throw new Error(`unexpected upstream: ${url.href}`);
  };
  try {
    const playbackRequest = () => worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'streamc-movie', server: 0, episode: 0 }),
    }), f.env);
    const [playback, simultaneousPlayback] = await Promise.all([playbackRequest(), playbackRequest()]);
    assert.equal(playback.status, 200);
    assert.equal(simultaneousPlayback.status, 200);
    const playbackJson = await playback.json();
    assert.equal(playbackJson.selectedServer, 1);
    assert.equal(bootstrapPosts, 1);
    assert.equal(embedWarmups, 0);
    assert.equal(deadPrimaryProbes, 2);
    assert.equal(playlistFetches, 0);
    assert.ok(timeoutValues.includes(12000), `missing backup-detail timeout: ${timeoutValues.join(',')}`);
    assert.ok(timeoutValues.includes(25000), `missing StreamC bootstrap timeout: ${timeoutValues.join(',')}`);

    const manifestResponse = await worker.fetch(new Request(playbackJson.streamUrl), f.env);
    assert.equal(manifestResponse.status, 200);
    assert.equal(playlistFetches, 1);
    const protectedSegment = (await manifestResponse.text()).split('\n').find((line) => line.startsWith('https://example.workers.dev/api/media/stream'));
    assert.ok(protectedSegment);
    const segmentResponse = await worker.fetch(new Request(protectedSegment), f.env);
    assert.equal(segmentResponse.status, 200);
    assert.equal(segmentResponse.headers.get('content-type'), 'video/mp2t');
    assert.equal(segmentReferer, 'https://embed.streamc.xyz/');
    assert.deepEqual([...new Uint8Array(await segmentResponse.arrayBuffer())], [0x47, 0x40, 0x11, 0x10]);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});

test('a native app resolves StreamC on-device when Cloudflare is blocked', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  const embed = 'https://embed12.streamc.xyz/embed.php?hash=d2ba6338e8354a4f95576076958e934d';
  const primary = {
    movie: { slug: 'native-backup', name: 'Native backup' },
    episodes: [{ server_name: 'Primary', server_data: [{ name: 'Full', slug: 'full', link_m3u8: 'https://video.example/dead.m3u8' }] }],
  };
  const backup = { movie: { slug: 'native-backup', episodes: [
    { server_name: 'Vietsub #1', items: [{ name: 'Full', slug: 'full', embed }] },
  ] } };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.origin === 'https://catalog.example') return new Response(JSON.stringify(primary), { headers: { 'content-type': 'application/json' } });
    if (url.origin === 'https://phim.nguonc.com') return new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://video.example/dead.m3u8') return new Response('gone', { status: 404 });
    if (url.href === embed && init.method === 'POST') return new Response('blocked', { status: 403 });
    throw new Error(`unexpected upstream: ${url.href}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST', body: JSON.stringify({ movie: 'native-backup', server: 0, episode: 0 }),
    }), f.env);
    assert.equal(playback.status, 200);
    const payload = await playback.json();
    assert.equal(payload.selectedServer, 1);
    assert.equal(payload.nativeBootstrap.url, embed);
    assert.equal(payload.streamUrl, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    f.sqlite.close();
  }
});
