const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/player-core.js');

test('keeps the same episode when a server has a different episode order', () => {
  const current = { slug: 'tap-03', name: 'Tập 3' };
  const target = Core.findEquivalentEpisode([
    { slug: 'tap-04', name: 'Tập 4' },
    { slug: 'tap-03', name: 'Tập 3' },
    { slug: 'tap-02', name: 'Tập 2' }
  ], current, 2);
  assert.equal(target.index, 1);
  assert.equal(target.episode.slug, 'tap-03');
});

test('matches the same episode number when providers label episodes differently', () => {
  const target = Core.findEquivalentEpisode([
    { slug: 'episode-4', name: 'Episode 4' },
    { slug: 'episode-3', name: 'EP03' },
    { slug: 'episode-2', name: 'Episode 2' }
  ], { slug: 'tap-03', name: 'Tập 03' }, 0);
  assert.equal(target.index, 1);
  assert.equal(target.episode.slug, 'episode-3');
  assert.equal(Core.episodeOrdinal({ filename: 'Episode 0007' }), 7);
});

test('falls back to the matching position only when no episode identity exists', () => {
  const target = Core.findEquivalentEpisode([{ name: 'Một' }, { name: 'Hai' }], { name: '' }, 1);
  assert.equal(target.index, 1);
  assert.equal(target.episode.name, 'Hai');
});

test('shows each real HLS rendition once and keeps its original level index', () => {
  const options = Core.uniqueQualityOptions([
    { width: 1280, height: 720, bitrate: 1800000 },
    { width: 3840, height: 2160, bitrate: 12000000 },
    { width: 1920, height: 1080, bitrate: 4500000 },
    { width: 1920, height: 1080, bitrate: 4500000 }
  ]);
  assert.deepEqual(options.map(({ levelIndex, label }) => ({ levelIndex, label })), [
    { levelIndex: 1, label: '2160p' },
    { levelIndex: 2, label: '1080p' },
    { levelIndex: 0, label: '720p' }
  ]);
});

test('never resumes beyond the playable duration', () => {
  assert.equal(Core.clampResumeTime(99, 40), 39.5);
  assert.equal(Core.clampResumeTime(-1, 40), 0);
  assert.equal(Core.clampResumeTime(12, Number.NaN), 12);
});

test('skips the embedded iOS ad window at each 15 minute marker', () => {
  assert.deepEqual(Core.autoAdSkipTarget(902, 7000), { marker: 900, target: 935 });
  assert.deepEqual(Core.autoAdSkipTarget(1800, 7000), { marker: 1800, target: 1835 });
  assert.equal(Core.autoAdSkipTarget(899.9, 7000), null);
  assert.equal(Core.autoAdSkipTarget(935, 7000), null);
});

test('does not repeat a skipped ad or seek beyond the playable end', () => {
  assert.equal(Core.autoAdSkipTarget(905, 7000, new Set([900])), null);
  assert.deepEqual(Core.autoAdSkipTarget(900, 920), { marker: 900, target: 919.5 });
  assert.equal(Core.autoAdSkipTarget(Number.NaN, 7000), null);
});

test('stripHlsAds removes spliced foreign ad segments and splice-only discontinuities', () => {
  const movieSegments = Array.from({ length: 40 }, (_, i) =>
    `#EXTINF:6.000,\nseg_${String(i).padStart(4, '0')}.ts`
  );
  const raw = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    ...movieSegments.slice(0, 20),
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:3.000,',
    '/v8/ad_clip_01/segment_000.ts',
    '#EXTINF:3.000,',
    '/v8/ad_clip_01/segment_001.ts',
    '#EXT-X-DISCONTINUITY',
    ...movieSegments.slice(20),
    '#EXT-X-ENDLIST',
  ].join('\n');
  const res = Core.stripHlsAds(raw, 'https://cdn.example.test/20260903/movie/index.m3u8');
  assert.equal(res.isMaster, false);
  assert.equal(res.removedSegments, 2);
  assert.equal(res.removedSeconds, 6);
  assert.doesNotMatch(res.playlist, /ad_clip_01/);
  assert.doesNotMatch(res.playlist, /#EXT-X-DISCONTINUITY/);
  assert.match(res.playlist, /https:\/\/cdn\.example\.test\/20260903\/movie\/seg_0000\.ts/);
  assert.match(res.playlist, /https:\/\/cdn\.example\.test\/20260903\/movie\/seg_0039\.ts/);
});

test('nextEpisodeCountdown activates during the final 30 seconds of video playback', () => {
  assert.deepEqual(Core.nextEpisodeCountdown(1770, 1800, 30), { active: true, remaining: 30 });
  assert.deepEqual(Core.nextEpisodeCountdown(1785.4, 1800, 30), { active: true, remaining: 15 });
  assert.deepEqual(Core.nextEpisodeCountdown(1799.1, 1800, 30), { active: true, remaining: 1 });
  assert.equal(Core.nextEpisodeCountdown(1000, 1800, 30), null);
  assert.equal(Core.nextEpisodeCountdown(1800, 1800, 30), null);
  assert.equal(Core.nextEpisodeCountdown(50, 60, 30), null);
  assert.equal(Core.nextEpisodeCountdown(Number.NaN, 1800, 30), null);
});

test('isIntroInterval detects intro playback window and ignores after 85s or short videos', () => {
  assert.equal(Core.isIntroInterval(0, 1800, 85), true);
  assert.equal(Core.isIntroInterval(42.5, 1800, 85), true);
  assert.equal(Core.isIntroInterval(84.9, 1800, 85), true);
  assert.equal(Core.isIntroInterval(85, 1800, 85), false);
  assert.equal(Core.isIntroInterval(85.1, 1800, 85), false);
  assert.equal(Core.isIntroInterval(500, 1800, 85), false);
  assert.equal(Core.isIntroInterval(10, 120, 85), false);
  assert.equal(Core.isIntroInterval(10, 100, 85), false);
  assert.equal(Core.isIntroInterval(-5, 1800, 85), false);
  assert.equal(Core.isIntroInterval(Number.NaN, 1800, 85), false);
});

test('skipIntroTarget computes safe seek destination bounded by duration', () => {
  assert.equal(Core.skipIntroTarget(10, 1800, 85), 85);
  assert.equal(Core.skipIntroTarget(10, 100, 85), 85);
  assert.equal(Core.skipIntroTarget(10, 80, 85), 79);
  assert.equal(Core.skipIntroTarget(10, 0, 85), 85);
  assert.equal(Core.skipIntroTarget(10, Number.NaN, 85), 85);
});

test('stripHlsAds preserves master playlist with audio tracks and rewrites audio URIs via cleanUrlFor', () => {
  const masterRaw = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aac",NAME="Tiếng Việt",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="vi",URI="audio_vi.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aac",NAME="English",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="en",URI="audio_en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2176000,AVERAGE-BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio-aac"',
    'video_720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=4500000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-aac"',
    'video_1080.m3u8',
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=250000,CODECS="avc1.64001f",URI="iframe_720.m3u8"',
  ].join('\n');

  const cleanUrlFor = (u) => `https://proxy.example/hls/clean.m3u8?src=${encodeURIComponent(u)}&_=/`;
  const res = Core.stripHlsAds(masterRaw, 'https://cdn.example.test/stream/master.m3u8', { cleanUrlFor });

  assert.equal(res.isMaster, true);
  assert.equal(res.removedSegments, 0);
  assert.equal(res.removedSeconds, 0);
  assert.deepEqual(res.variants, [
    'https://cdn.example.test/stream/video_720.m3u8',
    'https://cdn.example.test/stream/video_1080.m3u8',
  ]);

  // Audio track URIs must be proxied through cleanUrlFor
  assert.match(res.playlist, /#EXT-X-MEDIA:TYPE=AUDIO.*URI="https:\/\/proxy\.example\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.example\.test%2Fstream%2Faudio_vi\.m3u8/);
  assert.match(res.playlist, /#EXT-X-MEDIA:TYPE=AUDIO.*URI="https:\/\/proxy\.example\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.example\.test%2Fstream%2Faudio_en\.m3u8/);

  // Video variants must be proxied through cleanUrlFor
  assert.match(res.playlist, /https:\/\/proxy\.example\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.example\.test%2Fstream%2Fvideo_720\.m3u8/);
  assert.match(res.playlist, /https:\/\/proxy\.example\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.example\.test%2Fstream%2Fvideo_1080\.m3u8/);

  // I-frame stream URI must be proxied through cleanUrlFor
  assert.match(res.playlist, /#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=250000,CODECS="avc1\.64001f",URI="https:\/\/proxy\.example\/hls\/clean\.m3u8\?src=https%3A%2F%2Fcdn\.example\.test%2Fstream%2Fiframe_720\.m3u8/);

  // Codecs and audio attributes must be preserved
  assert.match(res.playlist, /CODECS="avc1\.64001f,mp4a\.40\.2"/);
  assert.match(res.playlist, /AUDIO="audio-aac"/);
});

test('stripHlsAds preserves variant expectation when intervening comment lines appear', () => {
  const masterWithComments = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"',
    '# Generated by transcoder v2.4',
    '# Quality 720p',
    'variant_720.m3u8',
  ].join('\n');

  const cleanUrlFor = (u) => `https://proxy.example/clean?src=${encodeURIComponent(u)}`;
  const res = Core.stripHlsAds(masterWithComments, 'https://cdn.example.test/live/master.m3u8', { cleanUrlFor });

  assert.equal(res.isMaster, true);
  assert.deepEqual(res.variants, ['https://cdn.example.test/live/variant_720.m3u8']);
  assert.match(res.playlist, /# Generated by transcoder v2\.4/);
  assert.match(res.playlist, /https:\/\/proxy\.example\/clean\?src=https%3A%2F%2Fcdn\.example\.test%2Flive%2Fvariant_720\.m3u8/);
});

test('stripHlsAds tolerates whitespace and quotes in #EXT-X-MAP and #EXT-X-KEY for audio init segments', () => {
  const mediaRaw = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-KEY:METHOD=AES-128, URI = "keys/audio.key"',
    '#EXT-X-MAP: URI = \'init_audio.mp4\'',
    ...Array.from({ length: 10 }, (_, i) => `#EXTINF:6.000,\naudio_seg_${i}.m4s`),
    '#EXT-X-ENDLIST',
  ].join('\n');

  const res = Core.stripHlsAds(mediaRaw, 'https://cdn.example.test/fmp4/audio.m3u8');
  assert.equal(res.isMaster, false);
  assert.equal(res.removedSegments, 0);
  assert.match(res.playlist, /#EXT-X-KEY:METHOD=AES-128, URI="https:\/\/cdn\.example\.test\/fmp4\/keys\/audio\.key"/);
  assert.match(res.playlist, /#EXT-X-MAP: URI="https:\/\/cdn\.example\.test\/fmp4\/init_audio\.mp4"/);
  assert.match(res.playlist, /https:\/\/cdn\.example\.test\/fmp4\/audio_seg_0\.m4s/);
});

test('stripHlsAds removes foreign ad clips from audio-only media playlists', () => {
  const audioSegments = Array.from({ length: 30 }, (_, i) =>
    `#EXTINF:6.000,\naudio_main_${String(i).padStart(4, '0')}.aac`
  );
  const raw = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    ...audioSegments.slice(0, 15),
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:3.000,',
    '/promo/ad_audio/ad_clip_01.aac',
    '#EXTINF:3.000,',
    '/promo/ad_audio/ad_clip_02.aac',
    '#EXT-X-DISCONTINUITY',
    ...audioSegments.slice(15),
    '#EXT-X-ENDLIST',
  ].join('\n');

  const res = Core.stripHlsAds(raw, 'https://cdn.example.test/tracks/audio_viet.m3u8');
  assert.equal(res.isMaster, false);
  assert.equal(res.removedSegments, 2);
  assert.equal(res.removedSeconds, 6);
  assert.doesNotMatch(res.playlist, /promo\/ad_audio/);
  assert.doesNotMatch(res.playlist, /#EXT-X-DISCONTINUITY/);
  assert.match(res.playlist, /https:\/\/cdn\.example\.test\/tracks\/audio_main_0000\.aac/);
  assert.match(res.playlist, /https:\/\/cdn\.example\.test\/tracks\/audio_main_0029\.aac/);
});
