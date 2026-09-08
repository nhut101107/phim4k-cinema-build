import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker, { openMediaTicket } from '../src/worker.mjs';

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
    assert.deepEqual(detailJson.episodes[0].server_data[0].stream_ref, { movie: 'phim-kiem-thu', server: 0, episode: 0 });

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

test('playback rejects a stale catalog stream before issuing a ticket', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);
    if (target.startsWith('https://catalog.example/')) {
      return new Response(JSON.stringify(detailPayload), { headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://video.example/path/master.m3u8') return new Response('removed', { status: 404 });
    throw new Error(`unexpected upstream: ${target}`);
  };
  try {
    const playback = await worker.fetch(viewerRequest('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify({ movie: 'phim-kiem-thu', server: 0, episode: 0 }),
    }), env);
    assert.equal(playback.status, 404);
    assert.equal((await playback.json()).code, 'STREAM_SOURCE_OFFLINE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
