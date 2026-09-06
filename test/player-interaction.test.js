const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const classes = new Set();
  const storage = new Map();
  const wrapper = { classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) } };
  const ctx = { document: { readyState: 'loading', addEventListener() {}, getElementById: () => null }, window: { matchMedia: () => ({ matches: true }), setTimeout: () => 1 }, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) }, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync('public/js/player.js','utf8') + '\nglobalThis.subject=Player;',ctx);
  const p = ctx.subject; p.wrapper = wrapper; p.modal = { classList: { contains: () => false } }; p.video = { paused: false, pause() { this.paused = true; } };
  return p;
}
test('video surface toggles controls without changing playback', () => {
  const p = fixture(); p.toggleControls(); assert.equal(p.wrapper.classList.contains('inactive'),true); assert.equal(p.video.paused,false);
  p.toggleControls(); assert.equal(p.wrapper.classList.contains('inactive'),false); assert.equal(p.video.paused,false);
  assert.match(fs.readFileSync('public/js/player.js','utf8'), /onVideo\('click', event => this\.onSurfaceTap\(event\)\)/);
});

test('double taps seek only on the same side within the gesture window', () => {
  const { doubleTapSeek } = require('../public/js/player-core');
  assert.equal(doubleTapSeek({x:.8,time:100},{x:.81,time:250}),10);
  assert.equal(doubleTapSeek({x:.1,time:100},{x:.12,time:400}),-10);
  assert.equal(doubleTapSeek({x:.1,time:100},{x:.8,time:250}),0);
  assert.equal(doubleTapSeek({x:.5,time:100},{x:.5,time:250}),0);
  assert.equal(doubleTapSeek({x:.8,time:100},{x:.8,time:421}),0);
  assert.equal(doubleTapSeek(null,{x:.8,time:250}),0);
});
test('fullscreen preserves subtitles by default; cropping requires explicit choice', () => {
  const p = fixture(); p.showAlert = () => {}; p.applyPreferredAspect(); assert.equal(p.aspectMode,'contain');
  p.isCinemaFullscreen=true; p.applyPreferredAspect(); assert.equal(p.aspectMode,'contain');
  p.toggleAspectRatio(); p.applyPreferredAspect(); assert.equal(p.aspectMode,'cover');
  p.toggleAspectRatio(); p.applyPreferredAspect(); assert.equal(p.aspectMode,'contain');
});
test('center and bottom controls explicitly toggle playback', () => {
  const html = fs.readFileSync('public/index.html','utf8');
  for(const id of ['btnCenterPlayPause','btnPlayPause']) assert.match(html,new RegExp('id="'+id+'"[^>]*onclick="togglePlayPause\\(\\)"'));
  const p = fixture(); p.togglePlayPause(); assert.equal(p.video.paused,true);
});

test('paused playback is still persisted when pause or close explicitly flushes', () => {
  const source = fs.readFileSync('public/js/player.js','utf8');
  assert.match(source, /this\.saveProgressNow\(\{ flush: true \}\)/);
  assert.match(source, /this\.video\.paused && !flush/);
  assert.doesNotMatch(source, /!this\.video \|\| this\.video\.paused \|\| this\.video\.currentTime <= 3/);
});
