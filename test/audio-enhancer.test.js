const test = require('node:test');
const assert = require('node:assert/strict');
const {safeSource} = require('../public/js/audio-enhancer');
test('audio processing never captures a remote native stream that would become silent', () => {
  assert.equal(safeSource('https://cdn.example/film.m3u8','https://localhost'),false);
  assert.equal(safeSource('blob:https://localhost/abc','https://localhost'),true);
  assert.equal(safeSource('blob:https://foreign/abc','https://localhost'),false);
  assert.equal(safeSource('https://localhost/media/qa-original.mp4','https://localhost'),true);
  assert.equal(safeSource('https://localhost/proxy/m3u8','https://localhost'),false);
});

test('unsupported remote audio is rejected before a capture node is created', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  let created = 0;
  const window = {location:{href:'https://localhost/'},AudioContext:class{constructor(){created++;}}};
  vm.runInNewContext(fs.readFileSync('public/js/audio-enhancer.js','utf8'),{window,URL});
  await assert.rejects(window.Phim4KAudio.toggle({currentSrc:'https://remote.example/movie.m3u8'}), /giữ âm gốc/);
  assert.equal(created,0);
});
