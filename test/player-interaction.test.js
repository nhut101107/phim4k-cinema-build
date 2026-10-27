const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const classes = new Set();
  const storage = new Map();
  const wrapper = { classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) } };
  const ctx = { API: { trackUsage() {} }, PlayerCore: require('../public/js/player-core'), document: { readyState: 'loading', addEventListener() {}, getElementById: () => null }, window: { matchMedia: () => ({ matches: true }), setTimeout: () => 1, requestAnimationFrame: () => 1, cancelAnimationFrame() {} }, performance: { now: () => 0 }, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync('public/js/player.js','utf8') + '\nglobalThis.subject=Player;',ctx);
  const p = ctx.subject; p.wrapper = wrapper; p.modal = { classList: { contains: () => false } }; p.video = { paused: false, pause() { this.paused = true; } };
  return p;
}
test('video surface toggles controls without changing playback', () => {
  const p = fixture(); p.toggleControls(); assert.equal(p.wrapper.classList.contains('inactive'),true); assert.equal(p.video.paused,false);
  p.toggleControls(); assert.equal(p.wrapper.classList.contains('inactive'),false); assert.equal(p.video.paused,false);
  assert.match(fs.readFileSync('public/js/player.js','utf8'), /onVideo\('click', event => this\.onSurfaceTap\(event\)\)/);
  assert.doesNotMatch(fs.readFileSync('public/js/player.js','utf8'), /player-ambient-backdrop/);
});

test('double taps seek only on the same side within the gesture window', () => {
  const { doubleTapSeek } = require('../public/js/player-core');
  assert.equal(doubleTapSeek({x:.8,time:100},{x:.81,time:250}),10);
  assert.equal(doubleTapSeek({x:.1,time:100},{x:.12,time:500}),-10);
  assert.equal(doubleTapSeek({x:.1,time:100},{x:.8,time:250}),0);
  assert.equal(doubleTapSeek({x:.5,time:100},{x:.5,time:250}),0);
  assert.equal(doubleTapSeek({x:.8,time:100},{x:.8,time:620}),10);
  assert.equal(doubleTapSeek({x:.8,time:100},{x:.8,time:621}),0);
  assert.equal(doubleTapSeek(null,{x:.8,time:250}),0);
});
test('aspect choice persists and defaults to subtitle-safe contain', () => {
  const p = fixture(); p.showAlert = () => {};
  p.applyPreferredAspect(); assert.equal(p.aspectMode,'contain');
  p.toggleAspectRatio(); assert.equal(p.aspectMode,'cover');
  p.applyPreferredAspect(); assert.equal(p.aspectMode,'cover');
  p.toggleAspectRatio(); assert.equal(p.aspectMode,'contain');
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

test('skipIntro advances video currentTime and notifies user', () => {
  const p = fixture();
  let alertMsg = '';
  p.showAlert = (msg) => { alertMsg = msg; };
  p.video.currentTime = 20;
  p.video.duration = 1800;
  p.skipIntro();
  assert.equal(p.video.currentTime, 85);
  assert.equal(alertMsg, 'Đã bỏ qua đoạn mở đầu (Intro)');
});

test('dismissNextEpisodePopup sets dismissed state and hides popup', () => {
  const p = fixture();
  p.nextEpPopupDismissed = false;
  p.dismissNextEpisodePopup();
  assert.equal(p.nextEpPopupDismissed, true);
});

test('smooth failover preserves resume position across server switch', () => {
  const p = fixture();
  p.video.currentTime = 320;
  p.allServers = [
    { server_name: 'Server 1', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server 2', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] }
  ];
  p.currentServerIndex = 0;
  p.currentEpisode = { slug: 'tap-1', name: 'Tập 1' };
  p.currentEpIndex = 0;
  p.episodesList = p.allServers[0].server_data;
  let loadedResumeTime = null;
  p.loadEpisode = (_ep, opts) => { loadedResumeTime = opts.resumeTime; };
  p.saveProgressNow = () => {};
  p.showAlert = () => {};
  p.switchServer(1, { automatic: true });
  assert.equal(p.currentServerIndex, 1);
  assert.equal(loadedResumeTime, 320);
});
