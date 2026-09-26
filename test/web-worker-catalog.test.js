const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '../public/_worker.js'), 'utf8');

test('home catalog merges continuously updated PhimAPI and VSMOV pages', () => {
  assert.match(worker, /const VSMOV_ORIGIN = 'https:\/\/vsmov\.com'/);
  assert.match(worker, /\[1, 2, 3, 4, 5, 6\].*phim-moi-cap-nhat/s);
  assert.match(worker, /Phim Mới & Hot Cập Nhật Liên Tục/);
  assert.match(worker, /latestFirst\(/);
  assert.match(worker, /hotNewMovies\(/);
});

test('home sections have intentionally different large limits', () => {
  for (const count of [174, 54, 186, 162, 64, 42]) {
    assert.match(worker, new RegExp(`slice\\(0, ${count}\\)`));
  }
});

test('worker applies path-aware rate limits and normalized edge caching', () => {
  assert.match(worker, /function rateLimitRule\(path\)/);
  assert.match(worker, /function invalidRequestReason\(request, url\)/);
  assert.match(worker, /function publicMovieCacheRequest\(url\)/);
  assert.match(worker, /globalThis\.caches\?\.default/);
  assert.match(worker, /retry-after/);
});
