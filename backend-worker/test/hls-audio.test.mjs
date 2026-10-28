import test from "node:test";
import assert from "node:assert/strict";
import worker, { stripHlsAds } from "../src/worker.mjs";

const env = {
  ALLOW_LEGACY_TEST_AUTH: "1",
};

const MASTER_PLAYLIST_WITH_AUDIO = [
  "#EXTM3U",
  "#EXT-X-VERSION:4",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="Lồng tiếng",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="vi",URI="audio/vi.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="Thuyết minh",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="vi",URI="audio/tm.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-main",NAME="Gốc",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="en",URI="audio/en.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1800000,AVERAGE-BANDWIDTH=1600000,RESOLUTION=1280x720,FRAME-RATE=24.000,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio-main"',
  "720p/index.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=4200000,AVERAGE-BANDWIDTH=3800000,RESOLUTION=1920x1080,FRAME-RATE=24.000,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-main"',
  "1080p/index.m3u8",
  '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=190000,CODECS="avc1.64001f",URI="720p/iframe.m3u8"',
].join("\n");

const AUDIO_PLAYLIST_WITH_ADS = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:6",
  ...Array.from({ length: 15 }, (_, i) => `#EXTINF:6.000,\naudio_seg_${String(i).padStart(4, "0")}.aac`),
  "#EXT-X-DISCONTINUITY",
  "#EXTINF:3.000,",
  "/ads/betting_audio_clip_01.aac",
  "#EXTINF:3.000,",
  "/ads/betting_audio_clip_02.aac",
  "#EXT-X-DISCONTINUITY",
  ...Array.from({ length: 15 }, (_, i) => `#EXTINF:6.000,\naudio_seg_${String(i + 15).padStart(4, "0")}.aac`),
  "#EXT-X-ENDLIST",
].join("\n");

test("stripHlsAds preserves audio renditions, rewrites audio URIs via cleanUrlFor, and keeps codecs intact", () => {
  const cleanUrlFor = (u) => `https://example.workers.dev/hls/clean.m3u8?src=${encodeURIComponent(u)}&_=/%`;
  const result = stripHlsAds(MASTER_PLAYLIST_WITH_AUDIO, "https://cdn.upstream.example/live/master.m3u8", { cleanUrlFor });

  assert.equal(result.isMaster, true);
  assert.equal(result.removedSegments, 0);
  assert.equal(result.removedSeconds, 0);
  assert.deepEqual(result.variants, [
    "https://cdn.upstream.example/live/720p/index.m3u8",
    "https://cdn.upstream.example/live/1080p/index.m3u8",
  ]);

  // Audio track URIs must be routed through cleanUrlFor proxy
  assert.match(
    result.playlist,
    /#EXT-X-MEDIA:TYPE=AUDIO.*NAME="Lồng tiếng".*URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Flive%2Faudio%2Fvi\.m3u8&_=\/%"/
  );
  assert.match(
    result.playlist,
    /#EXT-X-MEDIA:TYPE=AUDIO.*NAME="Thuyết minh".*URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Flive%2Faudio%2Ftm\.m3u8&_=\/%"/
  );
  assert.match(
    result.playlist,
    /#EXT-X-MEDIA:TYPE=AUDIO.*NAME="Gốc".*URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Flive%2Faudio%2Fen\.m3u8&_=\/%"/
  );

  // Video variants must be routed through cleanUrlFor proxy
  assert.match(
    result.playlist,
    /https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Flive%2F720p%2Findex\.m3u8&_=\/%/
  );
  assert.match(
    result.playlist,
    /https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Flive%2F1080p%2Findex\.m3u8&_=\/%/
  );

  // I-Frame stream URI must be routed through cleanUrlFor proxy
  assert.match(
    result.playlist,
    /#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=190000,CODECS="avc1\.64001f",URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Flive%2F720p%2Fiframe\.m3u8&_=\/%"/
  );

  // Audio and video codecs must be fully preserved
  assert.match(result.playlist, /CODECS="avc1\.64001f,mp4a\.40\.2"/);
  assert.match(result.playlist, /CODECS="avc1\.640028,mp4a\.40\.2"/);
  assert.match(result.playlist, /AUDIO="audio-main"/);
});

test("GET /hls/clean.m3u8 proxies upstream master playlist and preserves all audio tracks and codec metadata", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const target = String(input);
      if (target === "https://cdn.upstream.example/stream/master.m3u8") {
        assert.equal(init?.headers?.referer, "https://player.phimapi.com/");
        return new Response(MASTER_PLAYLIST_WITH_AUDIO, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl; charset=utf-8" },
        });
      }
      throw new Error(`Unexpected fetch call: ${target}`);
    };

    const req = new Request(
      "https://example.workers.dev/hls/clean.m3u8?src=https%3A%2F%2Fcdn.upstream.example%2Fstream%2Fmaster.m3u8"
    );
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/vnd.apple.mpegurl; charset=utf-8");
    assert.equal(res.headers.get("x-ads-removed"), "0");

    const body = await res.text();
    // Audio tracks must be present and proxied
    assert.match(body, /#EXT-X-MEDIA:TYPE=AUDIO.*URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Fstream%2Faudio%2Fvi\.m3u8/);
    assert.match(body, /#EXT-X-MEDIA:TYPE=AUDIO.*URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Fstream%2Faudio%2Ftm\.m3u8/);
    assert.match(body, /#EXT-X-MEDIA:TYPE=AUDIO.*URI="https:\/\/example\.workers\.dev\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.upstream\.example%2Fstream%2Faudio%2Fen\.m3u8/);

    // Audio codecs and groups must be preserved
    assert.match(body, /CODECS="avc1\.64001f,mp4a\.40\.2"/);
    assert.match(body, /AUDIO="audio-main"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /hls/clean.m3u8 strips spliced ad audio segments from upstream audio playlists", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const target = String(input);
      if (target === "https://cdn.upstream.example/audio/vi.m3u8") {
        return new Response(AUDIO_PLAYLIST_WITH_ADS, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl; charset=utf-8" },
        });
      }
      throw new Error(`Unexpected fetch call: ${target}`);
    };

    const req = new Request(
      "https://example.workers.dev/hls/clean.m3u8?src=https%3A%2F%2Fcdn.upstream.example%2Faudio%2Fvi.m3u8"
    );
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-ads-removed"), "2");
    assert.equal(res.headers.get("x-ads-removed-seconds"), "6.00");

    const body = await res.text();
    // Betting ad audio segments and discontinuities must be stripped
    assert.doesNotMatch(body, /betting_audio_clip/);
    assert.doesNotMatch(body, /#EXT-X-DISCONTINUITY/);

    // Regular movie audio segments must remain intact
    assert.match(body, /https:\/\/cdn\.upstream\.example\/audio\/audio_seg_0000\.aac/);
    assert.match(body, /https:\/\/cdn\.upstream\.example\/audio\/audio_seg_0029\.aac/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /hls/clean.m3u8 seeds master playlist and subsequent GET retrieves complete playlist with audio", async () => {
  const seedId = "c_seed_audio_preservation_test";
  const postReq = new Request(`https://example.workers.dev/hls/clean.m3u8?id=${seedId}`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: MASTER_PLAYLIST_WITH_AUDIO,
  });

  const postRes = await worker.fetch(postReq, env);
  assert.equal(postRes.status, 200);
  const postBody = await postRes.json();
  assert.deepEqual(postBody, { ok: true, id: seedId });

  // Now retrieve via GET using id
  const getReq = new Request(
    `https://example.workers.dev/hls/clean.m3u8?id=${seedId}&src=https%3A%2F%2Fcdn.example%2Fmaster.m3u8`
  );
  const getRes = await worker.fetch(getReq, env);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get("content-type"), "application/vnd.apple.mpegurl; charset=utf-8");

  const getBody = await getRes.text();
  assert.equal(getBody, MASTER_PLAYLIST_WITH_AUDIO);
  assert.match(getBody, /#EXT-X-MEDIA:TYPE=AUDIO.*NAME="Lồng tiếng"/);
  assert.match(getBody, /CODECS="avc1\.64001f,mp4a\.40\.2"/);
});
