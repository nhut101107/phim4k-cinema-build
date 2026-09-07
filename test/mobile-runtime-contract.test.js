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
  const api = read('../public/js/api.js');
  const index = read('../public/index.html');
  assert.match(auth, /if \(teleInput\) teleInput\.value = '';/);
  assert.doesNotMatch(auth, /teleInput\.value = savedTeleId;\s*\/\/ Pre-fill/);
  assert.match(auth, /key người xem không cần Telegram ID/i);
  assert.match(auth, /activationFailureMessage\(res/);
  assert.match(auth, /clearStoredSession\(\);\s*this\.triggerLock\(activationFailureMessage/);
  assert.match(index, /Key người xem không cần Telegram ID/);
  assert.doesNotMatch(api, /Không thể xác thực key hoặc Telegram ID/);
  assert.match(index, /media\/phim4k-avatar\.png/);
});

test('free-access policy is checked before a saved key and users can refresh app state', () => {
  const auth = read('../public/js/auth.js');
  const admin = read('../public/js/admin.js');
  const index = read('../public/index.html');
  assert.ok(auth.indexOf('await this.getAccessPolicy()') < auth.indexOf('if (!savedKey)'));
  assert.match(auth, /window\.refreshAppFromServer = refreshAppFromServer/);
  assert.match(auth, /window\.location\.reload\(\)/);
  assert.match(index, /onclick="refreshAppFromServer\(this\)"[^>]*>🔄 Làm mới ứng dụng/);
  assert.match(index, /onclick="refreshAppFromServer\(this\)"[^>]*>[\s\S]*?🔄 Làm Mới App/);
  assert.match(index, /id="adminFreeAccess"[^>]*onchange="Admin\.saveAccessPolicy\(\)"/);
  assert.match(admin, /result\.freeAccess !== requestedFreeAccess/);
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
  assert.match(account, /window\.API\?\.getVersion\?\.\(\) \|\| '3\.4\.34'/);
  assert.match(auth, /const verifiedSession = \{ \.\.\.res, key, telegramId \}/);
  assert.match(auth, /Auth\.unlockApp\(verifiedSession\)/);
});

test('maintenance mode is controlled by verified admin and enforced across client sessions', () => {
  const auth = read('../public/js/auth.js');
  const api = read('../public/js/api.js');
  const admin = read('../public/js/admin.js');
  const index = read('../public/index.html');
  const worker = read('../backend-worker/src/worker.mjs');
  assert.match(index, /id="maintenanceNotice"/);
  assert.match(index, /id="adminMaintenanceToggle"/);
  assert.match(index, /id="maintenanceDurationInput"/);
  assert.match(auth, /showMaintenance\(value/);
  assert.match(auth, /MAINTENANCE_MODE/);
  assert.match(api, /maintenance: payload\.maintenance/);
  assert.match(admin, /\/api\/admin\/maintenance/);
  assert.match(worker, /function maintenanceError/);
  assert.match(worker, /if \(maintenance\.active\) return maintenanceError/);
});

test('web, iOS and Windows release versions stay aligned', () => {
  const api = read('../public/js/api.js');
  const iosProject = read('../ios/App/App.xcodeproj/project.pbxproj');
  const desktop = JSON.parse(read('../electron-builder.json'));
  const webVersion = api.match(/return '(\d+\.\d+\.\d+)'/)?.[1];
  assert.equal(webVersion, '3.4.34');
  assert.equal(desktop.extraMetadata.version, webVersion);
  assert.deepEqual([...iosProject.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]), [webVersion, webVersion]);
  assert.deepEqual([...iosProject.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((match) => match[1]), ['34', '34']);
});

test('Android phone and TV are separate optimized release flavors', () => {
  const gradle = read('../android/app/build.gradle');
  const mainManifest = read('../android/app/src/main/AndroidManifest.xml');
  const tvManifest = read('../android/app/src/tv/AndroidManifest.xml');
  const activity = read('../android/app/src/main/java/com/phim4k/cinema/MainActivity.java');
  const platform = read('../public/js/platform.js');
  const navigation = read('../public/js/tv.js');
  const styles = read('../public/css/style.css');
  const player = read('../public/js/player.js');

  assert.match(gradle, /versionCode 34/);
  assert.match(gradle, /versionName "3\.4\.34"/);
  assert.match(gradle, /phone\s*\{[\s\S]*?applicationId "com\.phim4k\.cinema"[\s\S]*?PHIM4K_PLATFORM[^\n]*android/);
  assert.match(gradle, /tv\s*\{[\s\S]*?applicationId "com\.phim4k\.cinema\.tv"[\s\S]*?PHIM4K_PLATFORM[^\n]*android_tv/);
  assert.match(gradle, /debug\.assets\.srcDir\(layout\.buildDirectory\.dir\('generated\/qaAssets'\)\)/);
  assert.match(gradle, /prepareDebugQaAssets/);
  assert.doesNotMatch(mainManifest, /LEANBACK_LAUNCHER|screenOrientation="landscape"/);
  assert.match(mainManifest, /networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(tvManifest, /LEANBACK_LAUNCHER/);
  assert.match(tvManifest, /screenOrientation="landscape"/);
  assert.match(activity, /Phim4KAndroid/);
  assert.match(activity, /Phim4KTV/);
  assert.match(activity, /getOnBackPressedDispatcher/);
  assert.match(platform, /platform-\$\{current\.replace\('_', '-'\)\}/);
  assert.match(navigation, /window\.Phim4KNavigation/);
  assert.match(styles, /\.platform-android \.cinema-rail/);
  assert.match(player, /this\.nativePlatform\(\) === 'ios'/);
  assert.match(read('../public/js/auth.js'), /key === 'android' \|\| key === 'android_tv'/);
});

test('Android CI builds, signs and device-tests the correct flavor', () => {
  const phoneWorkflow = read('../.github/workflows/build-android-phone.yml');
  const tvWorkflow = read('../.github/workflows/build-tv-windows.yml');
  assert.match(phoneWorkflow, /assemblePhoneRelease/);
  assert.match(phoneWorkflow, /connectedPhoneDebugAndroidTest/);
  assert.match(phoneWorkflow, /package: name='com\.phim4k\.cinema'/);
  assert.match(phoneWorkflow, /apksigner" verify/);
  assert.match(tvWorkflow, /assembleTvRelease/);
  assert.match(tvWorkflow, /connectedTvDebugAndroidTest/);
  assert.match(tvWorkflow, /package: name='com\.phim4k\.cinema\.tv'/);
});

test('iOS entry point cache-busts every bundled script and stylesheet', () => {
  const html = read('../public/index.html');
  const localAssets = [...html.matchAll(/(?:src|href)="\/(?:js|css|vendor)\/[^"?]+(?:\?[^" ]+)?"/g)].map(match => match[0]);
  assert.ok(localAssets.length >= 20);
  assert.ok(localAssets.every(asset => asset.includes('?v=3.4.34')), localAssets.join('\n'));
  assert.match(html, /3\.4\.34[^<]*BẢO TRÌ \+ BĂNG PHIM MƯỢT/);
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
  vm.runInContext(read('../public/js/home-curation.js'), sandbox);
  sandbox.Phim4KHome = sandbox.window.Phim4KHome;
  vm.runInContext(`${read('../public/js/api.js')}\nglobalThis.__api = API;`, sandbox);
  assert.equal(sandbox.window.API.getVersion(), '3.4.34');
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

test('home uses touch-native cinema rails while filtered results remain a grid', () => {
  const app = read('../public/js/app.js');
  const styles = read('../public/css/style.css');
  assert.match(app, /cinema-rail-section/);
  assert.match(app, /bindMovieRail/);
  assert.match(app, /requestAnimationFrame\(update\)/);
  assert.match(app, /section-index/);
  assert.match(app, /isGrid \? 'movie-grid filtered-movie-grid' : 'movie-row cinema-rail'/);
  assert.match(styles, /\.movie-row\.cinema-rail[\s\S]*?grid-auto-flow: column/);
  assert.match(styles, /scroll-snap-type: x proximity/);
  assert.match(styles, /-webkit-overflow-scrolling: touch/);
  assert.match(styles, /@media \(hover: none\)[\s\S]*?\.movie-card:hover/);
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

test('native movie artwork accepts only opaque image tickets from its configured Worker', () => {
  const sandbox = {
    URL,
    window: { Phim4KRuntime: { apiBaseUrl: 'https://api.example.test' } },
    console: { warn() {}, log() {} },
  };
  vm.createContext(sandbox);
  const appSource = read('../public/js/app.js').split('// Global Helpers for HTML inline calls')[0];
  vm.runInContext(`${appSource}\nglobalThis.__app = App;`, sandbox);
  const ticketed = 'https://api.example.test/api/media/image?t=abcdefghijklmnopqrstuvwxyz_0123456789';
  assert.equal(sandbox.__app.resolveImageUrl(ticketed), ticketed);
  assert.equal(sandbox.__app.resolveImageUrl('https://source.example/uploads/movies/poster.webp'), '/media/poster-fallback.svg');
  assert.equal(sandbox.__app.resolveImageUrl('/media/poster-fallback.svg'), '/media/poster-fallback.svg');
  assert.match(appSource, /_poster_retry/);
  assert.match(appSource, /retry < 2/);
});

test('native bundle contains no direct movie provider or raw media fallback', () => {
  const bundled = ['../public/js/api.js', '../public/js/app.js', '../public/js/catalog-fallback.js', '../public/js/home-curation.js', '../public/js/player.js']
    .map(read).join('\n');
  assert.doesNotMatch(bundled, /phimapi|ophim1|phimimg|api\/media\/image\?url=|\/v1\/api|\/danh-sach\/phim-moi-cap-nhat|link_(?:m3u8|embed)/i);
  assert.match(bundled, /getPlaybackTicket/);
  assert.match(read('../public/js/player.js'), /stream_ref/);
});

test('iOS workflow audits the completed IPA before uploading it', () => {
  const workflow = read('../.github/workflows/build-ios-ipa.yml');
  const audit = workflow.indexOf('package_ios_web_update.py --audit-only');
  const upload = workflow.indexOf('actions/upload-artifact@');
  assert.ok(audit >= 0 && upload > audit);
});

test('user activity is batched without stream URLs and admin logs support user filters and pagination', () => {
  const api = read('../public/js/api.js');
  const app = read('../public/js/app.js');
  const player = read('../public/js/player.js');
  const admin = read('../public/js/admin.js');
  const index = read('../public/index.html');
  const worker = read('../backend-worker/src/worker.mjs');
  assert.match(api, /usageQueue/);
  assert.match(api, /\/api\/telemetry/);
  assert.match(api, /JSON\.stringify\(\{ events \}\)/);
  assert.doesNotMatch(player, /trackUsage\([^\n]*activeStreamUrl/);
  assert.match(app, /trackUsage\('movie_open'/);
  assert.match(player, /trackUsage\('playback_error'/);
  assert.match(worker, /TELEMETRY_ACTIONS/);
  assert.match(worker, /normalizeTelemetryEvents/);
  assert.match(index, /id="logTypeFilter"/);
  assert.match(index, /id="logsLoadMoreBtn"/);
  assert.match(admin, /startLogAutoRefresh/);
  assert.match(admin, /before/);
});

test('mobile performance avoids repeated requests and expensive fixed blur repaints', () => {
  const api = read('../public/js/api.js');
  const app = read('../public/js/app.js');
  const styles = read('../public/css/style.css');
  assert.match(api, /cachedMovieRequest/);
  assert.match(api, /cached\?\.promise/);
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /createDocumentFragment/);
  assert.match(styles, /WKWebView scrolls more consistently/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('home refreshes near real time without rebuilding unchanged cards and supports timed pinned announcements', () => {
  const api = read('../public/js/api.js');
  const app = read('../public/js/app.js');
  const admin = read('../public/js/admin.js');
  const index = read('../public/index.html');
  const worker = read('../backend-worker/src/worker.mjs');
  assert.match(api, /cachedMovieRequest\('\/api\/movies\/home', 25000\)/);
  assert.match(app, /\}, 30000\);/);
  assert.match(app, /catalogSignature/);
  assert.match(app, /signature !== this\.homeFeedSignature/);
  assert.match(app, /window\.addEventListener\('online'/);
  assert.match(index, /id="globalAnnouncement"/);
  assert.match(index, /id="announcementPublishBtn"/);
  assert.match(admin, /publishAnnouncement/);
  assert.match(admin, /durationMinutes/);
  assert.match(worker, /global_announcement_v1/);
  assert.match(worker, /MAX_ANNOUNCEMENT_MINUTES/);
});
