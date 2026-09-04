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
