const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '../public/_worker.js'), 'utf8');

test('home catalog uses only the continuously updated PhimAPI catalogue', () => {
  assert.doesNotMatch(worker, /vsmov/i);
  assert.match(worker, /latestPageCount = 12/);
  assert.match(worker, /categoryPageCount = 4/);
  assert.match(worker, /Array\.from\(\{ length: latestPageCount \}/);
  assert.match(worker, /Phim Mới & Hot Cập Nhật Liên Tục/);
  assert.doesNotMatch(worker, /Kho Phim Mở Rộng|expanded-library/);
  assert.match(worker, /latestFirst\(/);
  assert.match(worker, /hotNewMovies\(/);
});

test('detail, search and category fallbacks never reintroduce VSMOV playback', () => {
  assert.doesNotMatch(worker, /vsmov/i);
  assert.match(worker, /PHIMAPI_ORIGIN.*\/phim\//s);
  assert.match(worker, /source: 'phimapi \+ ensmovie'/);
});

test('home sections have intentionally different large limits', () => {
  for (const count of [174, 120, 54, 186, 162, 64, 42]) {
    assert.match(worker, new RegExp(`slice\\(0, ${count}\\)`));
  }
});

test('home exposes a truthful high-quality section without inventing HD labels', () => {
  assert.match(worker, /Kho FHD & 4K Chất Lượng Cao/);
  assert.match(worker, /\(\?:4k\|uhd\|fhd\|1080\)/);
  assert.doesNotMatch(worker, /quality: movie\.quality \|\| 'HD'/);
});

test('worker applies path-aware rate limits and normalized edge caching', () => {
  assert.match(worker, /function rateLimitRule\(path\)/);
  assert.match(worker, /function invalidRequestReason\(request, url\)/);
  assert.match(worker, /function publicMovieCacheRequest\(url\)/);
  assert.match(worker, /globalThis\.caches\?\.default/);
  assert.match(worker, /retry-after/);
});
