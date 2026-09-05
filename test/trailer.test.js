const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTrailer } = require('../public/js/trailer');
test('trailers use an exact YouTube ID and discard untrusted query parameters', () => {
  const a = resolveTrailer('https://youtu.be/abcdefghijk?redirect=https://evil.test');
  assert.equal(a.kind,'youtube');
  assert.match(a.url,/^https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk\?/);
  assert.doesNotMatch(a.url,/evil/);
  assert.equal(resolveTrailer('https://www.youtube.com/watch?v=abcdefghijk').external,'https://www.youtube.com/watch?v=abcdefghijk');
});
test('missing and unsafe trailers never embed arbitrary pages', () => {
  for (const raw of ['', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://admin:secret@youtube.com/watch?v=abcdefghijk', 'https://localhost.evil/film.mp4']) assert.equal(resolveTrailer(raw),null);
  assert.equal(resolveTrailer('/media/qa-original.mp4').kind,'video');
});
