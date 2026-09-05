import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('native runtime has an HTTPS API base and a bundled catalog fallback', () => {
  const config = read('../public/js/mobile-config.js');
  const index = read('../public/index.html');
  const fallback = read('../public/js/catalog-fallback.js');
  assert.match(config, /apiBaseUrl:\s*"https:\/\//);
  assert.ok(index.indexOf('/js/catalog-fallback.js') < index.indexOf('/js/api.js'));
  assert.match(fallback, /PHIM4K_CATALOG_FALLBACK/);
});

test('activation gate does not prefill a cached Telegram identity', () => {
  const auth = read('../public/js/auth.js');
  assert.match(auth, /if \(teleInput\) teleInput\.value = '';/);
  assert.doesNotMatch(auth, /teleInput\.value = savedTeleId;\s*\/\/ Pre-fill/);
});

test('admin controls start hidden and require server-confirmed admin data', () => {
  const index = read('../public/index.html');
  const account = read('../public/js/coverflow.js');
  assert.match(index, /id="accAdminBtn" class="btn-primary hidden"/);
  assert.match(account, /isAuthenticated && session\.isAdmin/);
  assert.doesNotMatch(account, /localStorage\.getItem\('phim4k_key'\)/);
});

test('account version and a verified session do not fall back to stale WebView state', () => {
  const api = read('../public/js/api.js');
  const account = read('../public/js/coverflow.js');
  const auth = read('../public/js/auth.js');
  assert.match(api, /window\.API = API/);
  assert.match(auth, /window\.Auth = Auth/);
  assert.match(account, /window\.API\?\.getVersion\?\.\(\) \|\| '3\.4\.10'/);
  assert.match(auth, /const verifiedSession = \{ \.\.\.res, key, telegramId \}/);
  assert.match(auth, /Auth\.unlockApp\(verifiedSession\)/);
});

test('movie modal is scrollable and sized for a phone viewport', () => {
  const styles = read('../public/css/modal.css');
  assert.match(styles, /max-height: calc\(100dvh - 32px\)/);
  assert.match(styles, /-webkit-overflow-scrolling: touch/);
  assert.match(styles, /\.movie-detail-dialog \{ width: 100%; max-height: calc\(100dvh - 20px\)/);
});

test('only the activation screen can lock document scrolling', () => {
  const index = read('../public/index.html');
  const styles = read('../public/css/style.css');
  const app = read('../public/js/app.js');
  const player = read('../public/js/player.js');
  const admin = read('../public/js/admin.js');

  assert.match(index, /<body class="activation-locked">/);
  assert.match(styles, /body\.activation-locked/);
  assert.doesNotMatch(styles, /body\.locked/);
  assert.doesNotMatch(app, /classList\.add\('locked'/);
  assert.doesNotMatch(player, /classList\.add\('locked'/);
  assert.doesNotMatch(admin, /classList\.add\('locked'/);
});

test('native catalog falls back immediately instead of leaving the UI loading', async () => {
  const sandbox = {
    AbortController,
    Response,
    console: { warn() {}, log() {} },
    localStorage: { getItem: () => '' },
    fetch: async () => new Response(JSON.stringify({ message: 'upstream unavailable' }), { status: 500 }),
    setTimeout,
    clearTimeout,
  };
  sandbox.window = {
    setTimeout,
    clearTimeout,
    Phim4KRuntime: { apiBaseUrl: 'https://example.invalid' },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('../public/js/catalog-fallback.js'), sandbox);
  vm.runInContext(`${read('../public/js/api.js')}\nglobalThis.__api = API;`, sandbox);
  assert.equal(sandbox.window.API.getVersion(), '3.4.10');
  const home = await sandbox.__api.getHomeFeed();
  const detail = await sandbox.__api.getDetail(home.hero[0].slug);
  assert.ok(home.hero.length > 0);
  assert.equal(detail.episodes.length, 0);
  assert.equal(detail.movie.slug, home.hero[0].slug);
});

test('home catalog has working genre and country filters with grouped rows', () => {
  const sandbox = { window: {}, console: { warn() {}, log() {} } };
  vm.createContext(sandbox);
  vm.runInContext(read('../public/js/catalog-fallback.js'), sandbox);
  const appSource = read('../public/js/app.js').split('// Global Helpers for HTML inline calls')[0];
  vm.runInContext(`${appSource}\nglobalThis.__app = App;`, sandbox);
  const app = sandbox.__app;
  app.homeCatalog = sandbox.window.PHIM4K_CATALOG_FALLBACK;
  assert.ok(app.filterMoviesByTag('category', 'Hành Động').length > 0);
  assert.ok(app.filterMoviesByTag('country', 'Trung Quốc').length > 0);
  app.activeHomeFilters = { genre: 'Hoạt Hình', country: 'Nhật Bản' };
  assert.ok(app.moviesMatching().length > 0);
  assert.ok(app.buildHomeSections([]).some((section) => section.id === 'country-china'));
});

test('home filters query the full server catalogue with pagination and a mobile grid', () => {
  const api = read('../public/js/api.js');
  const app = read('../public/js/app.js');
  const worker = read('../backend-worker/src/worker.mjs');
  const styles = read('../public/css/style.css');
  assert.match(api, /getFilteredCatalog/);
  assert.match(api, /\/api\/movies\/filter/);
  assert.match(app, /loadHomeFilterResults/);
  assert.match(app, /catalogLoadMoreBtn/);
  assert.match(app, /Tải thêm 24 phim/);
  assert.match(app, /layout: 'grid'/);
  assert.match(worker, /pathname === "\/api\/movies\/filter"/);
  assert.match(worker, /MOVIE_FILTER_GENRES/);
  assert.match(worker, /MOVIE_FILTER_COUNTRIES/);
  assert.match(styles, /\.filtered-movie-grid/);
});

test('native home paints its bundled catalogue before waiting for the live feed', () => {
  const app = read('../public/js/app.js');
  const fallbackIndex = app.indexOf('this.applyHomeFeed(API.getBundledHomeFeed())');
  const liveRequestIndex = app.indexOf('const data = await API.getHomeFeed()');
  assert.ok(fallbackIndex >= 0, 'native fallback should be rendered');
  assert.ok(liveRequestIndex > fallbackIndex, 'live request must happen after the fallback is visible');
  assert.match(app, /if \(silent \|\| renderedBundledCatalog\) return;/);
  assert.match(app, /applyHomeFeed\(data\)/);
});

test('current coverflow layout cannot crash home loading through retired hero IDs', () => {
  const index = read('../public/index.html');
  const app = read('../public/js/app.js');
  assert.match(index, /id="coverflowSection"/);
  assert.doesNotMatch(index, /id="heroBillboard"/);
  assert.match(app, /getElementById\('heroBillboard'\)\?\.classList/);
  assert.doesNotMatch(app, /getElementById\('heroBillboard'\)\.classList/);
  assert.match(app, /if \(!backdropEl \|\| !titleEl \|\| !subEl \|\| !descEl \|\| !yearEl \|\| !qualityEl\) return;/);
});

test('mobile detail and admin overlays expose reliable close controls', () => {
  const index = read('../public/index.html');
  const styles = read('../public/css/modal.css');
  assert.match(index, /aria-label="Đóng thông tin phim"/);
  assert.match(index, /aria-label="Đóng bảng quản trị"/);
  assert.match(index, /class="admin-close-action"/);
  assert.match(styles, /\.modal-close-btn[\s\S]*min-width: 44px/);
  assert.match(styles, /position: fixed;[\s\S]*env\(safe-area-inset-top\)/);
});

test('home removes legacy fake continue-watching cards and avoids mobile carousel rebuilds', () => {
  const coverflow = read('../public/js/coverflow.js');
  const styles = read('../public/css/style.css');
  assert.match(coverflow, /getDefaultSeed\(\) \{\s*return \[\];/);
  assert.match(coverflow, /max-width: 600px/);
  assert.doesNotMatch(coverflow, /images\.unsplash\.com/);
  assert.match(styles, /\.btn-cf-play svg,[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
});

test('device-only approval remains server-authoritative and bound to a device', () => {
  const index = read('../public/index.html');
  const api = read('../public/js/api.js');
  const auth = read('../public/js/auth.js');
  assert.match(index, /id="btnRequestDeviceAccess"/);
  assert.match(api, /\/api\/auth\/request-device-access/);
  assert.match(api, /\/api\/auth\/device-status/);
  assert.match(auth, /deviceOnly: true/);
  assert.match(auth, /phim4k_device_only/);
  assert.match(auth, /phim4k_pending_device_key/);
  assert.match(auth, /beginDeviceApprovalPolling/);
  assert.match(index, /id="deviceRequestsList"/);
  assert.match(index, /adminTabLogs[\s\S]*?<\/div>\s*<\/div>\s*<!-- TAB 4:[\s\S]*?adminTabDownloads/);
});

test('schedule is generated from the live catalogue and opens movie details', () => {
  const index = read('../public/index.html');
  const app = read('../public/js/app.js');
  const tabs = read('../public/js/coverflow.js');
  assert.match(index, /id="scheduleGrid"/);
  assert.match(index, /id="scheduleRefreshBtn"/);
  assert.doesNotMatch(index, /31\.07\.2026|11\.07\.2026|01\.05\.2026/);
  assert.match(app, /getScheduleMovies\(\)/);
  assert.match(app, /renderSchedule\(\)/);
  assert.match(app, /refreshSchedule\(\)/);
  assert.match(app, /card\.addEventListener\('click', \(\) => this\.openMovieDetail\(movie\.slug\)\)/);
  assert.match(tabs, /tabId === 'schedule'[\s\S]*?renderSchedule/);
});

test('native movie artwork uses the allowlisted same-origin image relay', () => {
  const sandbox = {
    URL,
    window: { Phim4KRuntime: { apiBaseUrl: 'https://api.example.test' } },
    console: { warn() {}, log() {} },
  };
  vm.createContext(sandbox);
  const appSource = read('../public/js/app.js').split('// Global Helpers for HTML inline calls')[0];
  vm.runInContext(`${appSource}\nglobalThis.__app = App;`, sandbox);
  const proxied = sandbox.__app.resolveImageUrl('https://phimimg.com/uploads/movies/poster.webp');
  assert.equal(proxied, 'https://api.example.test/api/media/image?url=https%3A%2F%2Fphimimg.com%2Fuploads%2Fmovies%2Fposter.webp');
  assert.equal(sandbox.__app.resolveImageUrl('/media/poster-fallback.svg'), '/media/poster-fallback.svg');
});
