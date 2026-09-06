const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ remoteItems = [] } = {}) {
  const storage = new Map();
  const calls = { saved: [], cleared: 0 };
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  const API = {
    async getWatchProgress() { return { success: true, items: remoteItems }; },
    async saveWatchProgress(items) { calls.saved.push(items); return { success: true }; },
    async clearWatchProgress() { calls.cleared += 1; return { success: true }; },
    async getDetail() { return { movie: null }; },
    trackUsage() {},
  };
  const App = { homeCatalog: [], heroList: [] };
  const window = { setTimeout: () => 1, clearTimeout() {}, API, App };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  const context = { window, document, localStorage, API, App, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
  vm.runInNewContext(`${fs.readFileSync('public/js/coverflow.js', 'utf8')}\nglobalThis.subject = ContinueWatching;`, context);
  return { subject: context.subject, storage, calls };
}

test('legacy local viewing history is normalized, merged and uploaded on first cloud sync', async () => {
  const remote = {
    slug: 'phim-tu-may-chu', episodeId: 'tap-2', name: 'Phim Từ Máy Chủ', epName: 'Tập 2',
    currentTime: 420, duration: 1200, progressPercent: 35,
    thumb: 'https://phimimg.com/upload/vod/2026/server.jpg', updatedAt: '2026-09-06T10:00:00.000Z'
  };
  const f = fixture({ remoteItems: [remote] });
  f.storage.set('phim4k_continue_watching', JSON.stringify([{
    slug: 'phim-cu-tren-may', name: 'Phim Cũ Trên Máy', epName: 'Tập 1',
    timeText: '12:34 / 45:00', progressPercent: 28,
    thumb: 'https://phimimg.com/upload/vod/2025/local.jpg'
  }]));

  await f.subject.syncFromServer();
  const stored = JSON.parse(f.storage.get('phim4k_continue_watching'));
  assert.equal(stored.length, 2);
  assert.equal(stored.find(item => item.slug === 'phim-cu-tren-may').currentTime, 754);
  assert.equal(stored.find(item => item.slug === 'phim-cu-tren-may').duration, 2700);
  assert.equal(f.storage.get('watch_phim-tu-may-chu_tap-2'), '420.0');
  assert.equal(f.subject.getSavedTime('phim-tu-may-chu', 'TAP-2', 'Tập 2'), 420);
  assert.equal(f.calls.saved.length, 1);
  assert.equal(f.calls.saved[0][0].slug, 'phim-cu-tren-may');
});

test('new progress saves locally first and is then sent to the server', async () => {
  const f = fixture();
  f.subject.saveItem({ slug: 'phim-moi', name: 'Phim Mới', thumb_url: 'https://phimimg.com/upload/vod/2026/new.jpg' }, 'Tập 3', 301, 1200, 'tap-3');
  const local = JSON.parse(f.storage.get('phim4k_continue_watching'));
  assert.equal(local[0].currentTime, 301);
  assert.equal(local[0].episodeId, 'tap-3');
  await f.subject.flushSync({ keepalive: true });
  assert.equal(f.calls.saved.length, 1);
  assert.equal(f.calls.saved[0][0].slug, 'phim-moi');
});

test('clearing continue watching records a retryable tombstone and clears cloud data', async () => {
  const f = fixture();
  f.storage.set('phim4k_continue_watching', JSON.stringify([{
    slug: 'phim-can-xoa', name: 'Phim Cần Xóa', epName: 'Tập 1', episodeId: 'tap-1',
    currentTime: 100, duration: 1000, progressPercent: 10, updatedAt: Date.now()
  }]));
  f.storage.set('watch_phim-can-xoa_tap-1', '100.0');
  f.subject.clearAll();
  await f.subject.flushSync();
  assert.equal(f.calls.cleared, 1);
  assert.equal(f.storage.get('phim4k_continue_clear_pending'), undefined);
  assert.equal(f.storage.get('watch_phim-can-xoa_tap-1'), undefined);
  assert.deepEqual(JSON.parse(f.storage.get('phim4k_continue_watching')), []);
});

test('zero-percent history never renders as a fake thirty percent', () => {
  const source = fs.readFileSync('public/js/coverflow.js', 'utf8');
  assert.doesNotMatch(source, /item\.progressPercent \|\| 30/);
});

test('continue-watching prefers a fresh protected poster from the live catalogue', () => {
  const f = fixture();
  f.subject.posterRefreshes.clear();
  const protectedPoster = 'https://api.example.test/api/media/image?t=fresh-ticket';
  f.subject.findFreshMovie = () => ({ slug: 'phim-a', thumb_url: protectedPoster });
  assert.equal(f.subject.posterSource({ slug: 'phim-a', thumb: 'https://old-source.invalid/poster.jpg' }), protectedPoster);
});

test('native iOS release includes bundle, debugger and injected-library guards', () => {
  const source = fs.readFileSync('ios/App/App/RuntimeIntegrityGuard.swift', 'utf8');
  const delegate = fs.readFileSync('ios/App/App/AppDelegate.swift', 'utf8');
  assert.match(source, /expectedBundleIdentifier/);
  assert.match(source, /phim4k_ptrace\(31/);
  assert.match(source, /_dyld_image_count/);
  assert.match(source, /fridagadget/);
  assert.match(source, /MobileSubstrate/);
  assert.match(source, /Timer\(timeInterval: 4/);
  assert.match(source, /RuntimeIntegrityManifest\.verify\(\)/);
  assert.match(delegate, /RuntimeIntegrityGuard\.enforceAtLaunch\(\)/);
  assert.match(delegate, /RuntimeIntegrityGuard\.enforceWhenActive\(\)/);
});
