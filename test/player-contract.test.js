const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'public/js/player.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('uses one native fullscreen path and never rotates the web player with CSS', () => {
  assert.match(player, /ScreenOrientation/);
  assert.match(player, /StatusBar/);
  assert.match(player, /orientation:\s*'landscape'/);
  assert.doesNotMatch(player, /webkitEnterFullscreen|landscape-forced|toggleLandscapeFullscreen/);
});

test('loads player rules before the shared player and exposes a single fullscreen control', () => {
  assert.ok(index.indexOf('/js/player-core.js') < index.indexOf('/js/player.js'));
  assert.match(index, /id="btnCinemaFullscreen"/);
  assert.doesNotMatch(index, /btnLandscapeFullscreen/);
});

test('does not claim an unsupported manual HLS quality list on native iPhone playback', () => {
  assert.match(player, /iPhone tự chọn chất lượng HLS/);
  assert.match(player, /uniqueQualityOptions/);
});
