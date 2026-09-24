import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker, { openMediaTicket, sealMediaTicket } from '../src/worker.mjs';
import entryWorker from '../src/worker-entry.mjs';

const env = {
  ALLOW_LEGACY_TEST_AUTH: '1',
  DB: {
    prepare(sql) {
      return { bind() { return { async first() { return { setting_value: 'true' }; } }; } };
    },
  },
  MOVIE_CATALOG_ORIGIN: 'https://catalog.example',
  MOVIE_IMAGE_HOSTS: 'images.example',
  MEDIA_TICKET_SECRET: 'fixture-media-ticket-secret-at-least-32-characters',
};

const detailPayload = {
  movie: {
    name: 'Phim kiểm thử',
    slug: 'phim-kiem-thu',
    poster_url: 'https://images.example/uploads/poster.webp',
    thumb_url: 'https://images.example/uploads/thumb.webp',
  },
  episodes: [{
    server_name: 'Server A',
    server_data: [{
      name: 'Tập 1',
      slug: 'tap-1',
      filename: 'tap-1',
      link_m3u8: 'https://video.example/path/master.m3u8',
      link_embed: 'https://embed.example/watch/secret',
    }],
  }],
};

function viewerRequest(path, init = {}) {
  return new Request(`https://example.workers.dev${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-device-id': 'fixture-device', ...(init.headers || {}) },
  });
}

test('catalog detail strips raw media links and playback uses encrypted Worker capabilities', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://video.example/path/master.m3u8') {
      return new Response([
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000',
        'variant/index.m3u8',
      ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const unauthenticated = await worker.fetch(new Request('https://example.workers.dev/api/movies/detail/phim-kiem-thu'), env);
    assert.equal(unauthenticated.status, 401);

    const detail = await worker.fetch(viewerRequest('/api/movies/detail/phim-kiem-thu'), env);
    assert.equal(detail.status, 200);
    const detailJson = await detail.json();
    const serializedDetail = JSON.stringify(detailJson);
    assert.doesNotMatch(serializedDetail, /video\.example|embed\.example|link_m3u8|link_embed/i);
    assert.match(detailJson.movie.poster_url, /^https:\/\/example\.workers\.dev\/api\/media\/image\?t=/);
    assert.equal(detailJson.episodes[0].server_name, 'Server 1');
    assert.equal(detailJson.episodes[0].source_name, 'Server');
    assert.deepEqual(detailJson.episodes[0].server_data[0].stream_ref, {
      movie: 'phim-kiem-thu',
      server: 0,
      episode: 0,
      source: 'phimapi',
      sourceMovieSlug: 'phim-kiem-thu',
      serverName: 'Server A',
      episodeSlug: 'tap-1',
      episodeName: 'Tập 1',
      episodeNumber: 1,
    });

    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify(detailJson.episodes[0].server_data[0].stream_ref),
    }), env);
    assert.equal(playback.status, 200);
    const playbackJson = await playback.json();
    assert.match(playbackJson.streamUrl, /^https:\/\/example\.workers\.dev\/api\/media\/stream\?t=/);
    assert.doesNotMatch(JSON.stringify(playbackJson), /video\.example|master\.m3u8/);

    const stream = await worker.fetch(new Request(playbackJson.streamUrl), env);
    assert.equal(stream.status, 200);
    const manifest = await stream.text();
    assert.match(manifest, /^#EXTM3U/);
    assert.doesNotMatch(manifest, /video\.example|keys\/key\.bin|variant\/index\.m3u8/);
    const tokens = [...manifest.matchAll(/[?&]t=([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
    assert.equal(tokens.length, 2);
    const child = await openMediaTicket(tokens[0], env, 'stream');
    assert.equal(child.url, 'https://video.example/path/keys/key.bin');

    const tampered = await worker.fetch(new Request(`${playbackJson.streamUrl.slice(0, -1)}x`), env);
    assert.equal(tampered.status, 400);
    assert.equal((await tampered.json()).code, 'INVALID_STREAM_TICKET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streaming through the VPS relay uses a signed server-to-server request and never redirects the client', async () => {
const relayEnv = {
    ...env,
    VPS_RELAY_ORIGIN: 'https://relay.example',
    VPS_RELAY_ENABLED: '1',
    VPS_RELAY_SECRET: 'fixture-vps-relay-secret-at-least-32-characters',
    MEDIA_RELAY_FALLBACK: 'disabled',
  };
  const originalFetch = globalThis.fetch;
  let relayCalls = 0;
  globalThis.fetch = async (input, options = {}) => {
    const target = String(input);
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://relay.example/v1/media') {
      relayCalls += 1;
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'manual');
      const body = String(options.body);
      const timestamp = options.headers['x-phim4k-relay-timestamp'];
      const nonce = options.headers['x-phim4k-relay-nonce'];
      const expected = crypto.createHmac('sha256', relayEnv.VPS_RELAY_SECRET)
        .update(`phim4k-vps-relay-v1\n${timestamp}\n${nonce}\n${body}`)
        .digest('base64url');
      assert.equal(options.headers['x-phim4k-relay-signature'], expected);
      const relayPayload = JSON.parse(body);
      assert.equal(relayPayload.url, 'https://video.example/path/master.m3u8');
      assert.equal(relayPayload.format, 'hls');
      assert.equal(relayPayload.range, '', 'an AVPlayer probe range must not truncate an HLS manifest');
      return new Response('#EXTM3U\n#EXT-X-ENDLIST', {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'x-phim4k-relay-final': Buffer.from('https://video.example/path/master.m3u8').toString('base64url'),
        },
      });
    }
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), relayEnv);
    const playbackJson = await playback.json();
    const stream = await worker.fetch(new Request(playbackJson.streamUrl, {
      headers: { range: 'bytes=0-1' },
    }), relayEnv);
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('location'), null);
    assert.doesNotMatch(await stream.text(), /video\.example|master\.m3u8/);
    assert.equal(relayCalls, 2, 'playback preflight and the client stream request must both use the relay');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('relay and Cloudflare blocked HLS falls back to a short-lived authenticated client redirect', async () => {
  const relayEnv = {
    ...env,
    VPS_RELAY_ORIGIN: 'https://blocked-relay.example',
    VPS_RELAY_ENABLED: '1',
    VPS_RELAY_SECRET: 'fixture-vps-relay-secret-at-least-32-characters',
    MEDIA_RELAY_FALLBACK: 'disabled',
  };
  const originalFetch = globalThis.fetch;
  let relayCalls = 0;
  let directCalls = 0;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target === 'https://blocked-relay.example/healthz') return new Response('ok');
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://blocked-relay.example/v1/media') {
      relayCalls += 1;
      return new Response('not found', { status: 404 });
    }
    if (target === 'https://video.example/path/master.m3u8') {
      directCalls += 1;
      return new Response('edge denied', { status: 403 });
    }
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await entryWorker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), relayEnv);
    assert.equal(playback.status, 200);
    const playbackJson = await playback.json();
    const ticket = await openMediaTicket(new URL(playbackJson.streamUrl).searchParams.get('t'), relayEnv, 'stream');
    assert.equal(ticket.clientDirectFallback, true);
    assert.ok(ticket.exp <= Math.floor(Date.now() / 1000) + 15 * 60);

    const stream = await worker.fetch(new Request(playbackJson.streamUrl), relayEnv);
    assert.equal(stream.status, 307);
    assert.equal(stream.headers.get('location'), 'https://video.example/path/master.m3u8');
    assert.equal(relayCalls, 1);
    assert.equal(directCalls, 2, 'the dead relay path and entrypoint retry must both fall back through Cloudflare');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare-blocked or stale streams fall back to the authenticated viewer device', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://video.example/path/master.m3u8') return new Response('edge denied', { status: 403 });
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), env);
    assert.equal(playback.status, 200);
    const playbackJson = await playback.json();
    const ticket = await openMediaTicket(new URL(playbackJson.streamUrl).searchParams.get('t'), env, 'stream');
    assert.equal(ticket.clientDirectFallback, true);
    const stream = await worker.fetch(new Request(playbackJson.streamUrl), env);
    assert.equal(stream.status, 307);
    assert.equal(stream.headers.get('location'), 'https://video.example/path/master.m3u8');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('definitively removed streams fail fast instead of redirecting clients to a dead URL', async () => {
  const originalFetch = globalThis.fetch;
  let streamCalls = 0;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://video.example/path/master.m3u8') {
      streamCalls += 1;
      return new Response('removed', { status: 404 });
    }
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), env);
    assert.equal(playback.status, 404);
    assert.equal((await playback.json()).code, 'STREAM_SOURCE_OFFLINE');
    assert.equal(streamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare anti-bot HTML during preflight falls back for every catalog movie', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://video.example/path/master.m3u8') {
      return new Response('<html>provider challenge</html>', { headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), env);
    assert.equal(playback.status, 200);
    const playbackJson = await playback.json();
    const ticket = await openMediaTicket(new URL(playbackJson.streamUrl).searchParams.get('t'), env, 'stream');
    assert.equal(ticket.clientDirectFallback, true);
    const stream = await worker.fetch(new Request(playbackJson.streamUrl), env);
    assert.equal(stream.status, 307);
    assert.equal(stream.headers.get('location'), 'https://video.example/path/master.m3u8');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a variant or segment blocked after a successful master probe redirects to the viewer', async () => {
  const source = 'https://video.example/path/segment-001.ts';
  const token = await sealMediaTicket({
    kind: 'stream',
    url: source,
    format: 'media',
    sid: '',
    exp: Math.floor(Date.now() / 1000) + 300,
  }, env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), source);
    return new Response('edge blocked', { status: 403 });
  };
  try {
    const stream = await worker.fetch(new Request(`https://example.workers.dev/api/media/stream?t=${token}`), env);
    assert.equal(stream.status, 307);
    assert.equal(stream.headers.get('location'), source);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('entrypoint bypasses relay health checks for protected artwork', async () => {
  const relayEnv = {
    ...env,
    VPS_RELAY_ORIGIN: 'https://unused-relay.example',
    VPS_RELAY_ENABLED: '1',
    VPS_RELAY_SECRET: 'fixture-vps-relay-secret-at-least-32-characters',
  };
  const source = 'https://images.example/uploads/poster.webp';
  const token = await sealMediaTicket({ kind: 'image', url: source, exp: Math.floor(Date.now() / 1000) + 300 }, relayEnv);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    assert.equal(String(input), source);
    return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    });
  };
  try {
    const response = await entryWorker.fetch(new Request(`https://example.workers.dev/api/media/image?t=${token}`), relayEnv);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [source]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('entrypoint replays playback POST directly when a healthy relay rejects media', async () => {
  const relayEnv = {
    ...env,
    VPS_RELAY_ORIGIN: 'https://misconfigured-relay.example',
    VPS_RELAY_ENABLED: '1',
    VPS_RELAY_SECRET: 'fixture-vps-relay-secret-at-least-32-characters',
  };
  const originalFetch = globalThis.fetch;
  let relayCalls = 0;
  let directCalls = 0;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target === 'https://misconfigured-relay.example/healthz') return new Response('ok');
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://misconfigured-relay.example/v1/media') {
      relayCalls += 1;
      return new Response('bad signature', { status: 401 });
    }
    if (target === 'https://video.example/path/master.m3u8') {
      directCalls += 1;
      return new Response('#EXTM3U\n#EXT-X-ENDLIST', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await entryWorker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), relayEnv);
    assert.equal(playback.status, 200);
    assert.match((await playback.json()).streamUrl, /^https:\/\/example\.workers\.dev\/api\/media\/stream\?t=/);
    assert.equal(relayCalls, 1);
    assert.equal(directCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
