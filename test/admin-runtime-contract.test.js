const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('Pages delegates persistent auth and admin state to the D1 backend', () => {
  const worker = read('public/_worker.js');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/auth\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/admin\/'\)/);
  assert.match(worker, /return proxyTo\(request, LICENSE_ORIGIN/);
});

test('maintenance cannot be bypassed by a client-side free-access failsafe', () => {
  const auth = read('public/js/auth.js');
  assert.doesNotMatch(auth, /Failsafe triggered|ABSOLUTE FAILSAFE|force-unlocking/);
  assert.match(auth, /const adminRoute = window\.location\.pathname/);
  assert.match(auth, /không tự mở khi chưa kiểm tra bảo trì/i);
});

test('admin route always receives the current login runtime instead of Safari cache', () => {
  const worker = read('public/_worker.js');
  const auth = read('public/js/auth.js');
  const index = read('public/index.html');
  const webIndex = read('public/web-index.html');

  assert.ok(auth.includes("window.location.pathname.replace(/\\/+$/, '') === '/admin'"));
  assert.match(worker, /new URL\('\/web-index\.html', request\.url\)/);
  assert.match(worker, /headers\.set\('cache-control', 'no-store, max-age=0'\)/);
  assert.match(index, /\/js\/auth\.js\?v=3\.56\.15/);
  assert.match(webIndex, /\/js\/auth\.js\?v=3\.56\.15/);
  assert.doesNotMatch(`${index}\n${webIndex}`, /\/js\/auth\.js\?v=3\.56["']/);
});

test('viewer-facing access copy does not advertise the service as free', () => {
  const sources = [
    read('public/js/auth.js'),
    read('public/js/coverflow.js'),
    read('public/_worker.js'),
    read('backend-worker/src/worker.mjs'),
  ].join('\n');

  assert.doesNotMatch(sources, /MIỄN PHÍ TOÀN BỘ KHÁN GIẢ|MIỄN KEY|Miễn key/i);
  assert.match(sources, /MNHUT CINEMA 4K/);
});

test('admin receives movie reports and can close or reopen a movie', () => {
  const backend = read('backend-worker/src/worker.mjs');
  const admin = read('public/js/admin.js');
  const html = read('public/index.html');
  assert.match(backend, /CREATE TABLE IF NOT EXISTS movie_reports/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS closed_movies/);
  assert.match(backend, /\/api\/admin\/movie-availability/);
  assert.match(admin, /loadMovieReports\(\)/);
  assert.match(admin, /Đóng phim để sửa/);
  assert.match(admin, /Mở phim lại/);
  assert.match(html, /id="movieReportsList"/);
});

test('ENSMovie-only playback keeps history and exact language server labels', () => {
  const player = read('public/js/player.js');
  const loadEpisode = player.match(/async loadEpisode\(episode,[\s\S]*?\n  \},\n\n  playEmbedStream/)?.[0] || '';
  assert.match(loadEpisode, /this\.playEmbedStream\(providerEmbedUrl\)/);
  assert.doesNotMatch(loadEpisode, /getPlaybackTicket|link_m3u8|loadStream/);
  assert.match(player, /this\.setAspectRatio\('contain'/);
  assert.match(player, /void this\.enterCinemaFullscreen\(\)/);
  assert.match(player, /return 'Lồng tiếng'/);
  assert.match(player, /return 'Thuyết minh'/);
  assert.match(player, /return 'Vietsub'/);
  assert.doesNotMatch(player, /'Sài Gòn' : 'Đà Nẵng'/);
  assert.match(player, /PlayerCore\.doubleTapSeek/);
  assert.match(player, /ContinueWatching\.saveItem/);
});

test('feedback is persisted, replyable by Admin and visible to the submitting user', () => {
  const backend = read('backend-worker/src/worker.mjs');
  const admin = read('public/js/admin.js');
  const feedback = read('public/js/feedback.js');
  const html = read('public/index.html');
  assert.match(backend, /CREATE TABLE IF NOT EXISTS feedback_tickets/);
  assert.match(backend, /pathname === "\/api\/feedback"/);
  assert.match(backend, /pathname === "\/api\/admin\/feedback\/reply"/);
  assert.match(admin, /replyFeedback\(ticket\)/);
  assert.match(feedback, /admin_reply/);
  assert.match(html, /id="feedbackModal"/);
  assert.match(html, /id="feedbackInboxList"/);
});

test('admin logs use manual refresh and explicit Vietnam time', () => {
  const admin = read('public/js/admin.js');
  const html = read('public/index.html');
  assert.doesNotMatch(admin, /logRefreshTimer = window\.setInterval/);
  assert.doesNotMatch(admin, /userRefreshTimer = window\.setInterval/);
  assert.match(admin, /timeZone: 'Asia\/Ho_Chi_Minh'/);
  assert.match(html, /Admin\.refreshLogs\(\)/);
  assert.match(html, /chỉ cập nhật khi Admin yêu cầu/);
});
