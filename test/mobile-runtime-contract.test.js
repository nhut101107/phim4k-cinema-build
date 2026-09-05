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
