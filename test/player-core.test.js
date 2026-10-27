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
