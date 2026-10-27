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
  for (const count of [480, 320, 180, 256, 256, 220, 160]) {
    assert.match(worker, new RegExp(`slice\\(0, ${count}\\)`));
  }
});

test('worker strips spliced HLS ads and issues opaque poster tickets', () => {
  assert.match(worker, /const HLS_CLEAN_PATH = '\/hls\/clean\.m3u8'/);
  assert.match(worker, /function stripHlsAds\(text, baseUrl/);
  assert.match(worker, /function adFreeDetailPayload\(payload, cleanOrigin\)/);
  assert.match(worker, /function encodeImageTicket\(imageUrl/);
  assert.match(worker, /function decodeImageTicket\(token\)/);
  assert.match(worker, /url\.pathname === '\/api\/media\/image'/);
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
