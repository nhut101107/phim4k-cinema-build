import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = resolve(import.meta.dirname, '..');
const webRoot = resolve(projectRoot, 'ios', 'App', 'App', 'public');
const sourceWebRoot = resolve(projectRoot, 'public');
const qaMediaPaths = new Set(['/media/qa-original.mp4', '/media/qa-seek.mp4']);
const screenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-detail-smoke.png');
const homeScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-home-smoke.png');
const playerScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-player-smoke.png');
const scheduleScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-schedule-smoke.png');
const filterScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-filter-smoke.png');
const adminLogsScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-admin-logs-smoke.png');
const announcementScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-announcement-admin-smoke.png');
const railsScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-cinema-rails-smoke.png');
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.svg', 'image/svg+xml'],
]);

function edgePath() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error('Microsoft Edge was not found');
  return found;
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(server.address().port));
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

const staticServer = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  if (pathname === '/api/app/announcement') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ active: false }));
    return;
  }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const targetRoot = qaMediaPaths.has(requested) ? sourceWebRoot : webRoot;
  const target = normalize(resolve(targetRoot, `.${requested}`));
  if (!(target === targetRoot || target.startsWith(`${targetRoot}${sep}`)) || !existsSync(target)) {
    response.writeHead(404).end('Not found');
    return;
  }
  const size = statSync(target).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(size-1,Number(range[2])) : size-1;
    if (start > end || start >= size) { response.writeHead(416,{'content-range':`bytes */${size}`}).end(); return; }
    response.writeHead(206, {'content-type':mimeTypes.get(extname(target)) || 'application/octet-stream','accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${size}`,'content-length':end-start+1});
    createReadStream(target,{start,end}).pipe(response); return;
  }
  response.writeHead(200, {
    'content-length': size,
    'accept-ranges': 'bytes',
    'content-type': mimeTypes.get(extname(target)) || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(response);
});

const debugPortServer = createServer();
const debugPort = await listen(debugPortServer);
await close(debugPortServer);
const webPort = await listen(staticServer);
const profilePath = join(tmpdir(), `phim4k-edge-qa-${process.pid}-${Date.now()}`);
mkdirSync(profilePath, { recursive: true });

const browser = spawn(edgePath(), [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profilePath}`,
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore', windowsHide: true });
browser.unref();

async function waitForTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch (_error) {}
    await delay(100);
  }
  throw new Error('Edge DevTools target did not become ready');
}

const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let commandId = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const requestUrls = new Map();
const failedRequests = [];
const expectedMediaCancellations = [];
let releasingFixture = false;
let originalFixtureDecoded = false;
const badResponses = [];

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve: resolveCommand, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolveCommand(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params.exceptionDetails || {};
    exceptions.push({
      text: detail.text || 'Runtime exception',
      description: detail.exception?.description || detail.exception?.value || '',
      url: detail.url || '',
      line: Number.isInteger(detail.lineNumber) ? detail.lineNumber + 1 : null,
      column: Number.isInteger(detail.columnNumber) ? detail.columnNumber + 1 : null,
    });
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  }
  if (message.method === 'Network.requestWillBeSent') {
    requestUrls.set(message.params.requestId, message.params.request.url);
  }
  if (message.method === 'Network.loadingFailed') {
    const url = requestUrls.get(message.params.requestId) || '';
    // The local seek fixture is deliberately paused, sought and unloaded. CDP
    // may deliver its cancellation after teardown; actual decode/seek/resume
    // assertions remain mandatory. Never exempt production URLs or HTTP errors.
    if (message.params.canceled && message.params.errorText === 'net::ERR_ABORTED' && url === `http://127.0.0.1:${webPort}/media/qa-seek.mp4`) {
      expectedMediaCancellations.push({url,duringAction:releasingFixture,reason:'local seek fixture lifecycle; decode/seek/resume asserted separately'}); return;
    }
    // Closing the decoded local trailer / reload video also cancels its range
    // preload. Only this exact fixture and browser cancellation are exempt;
    // real URLs, HTTP failures, decode and lifecycle checks still fail the run.
    if ((originalFixtureDecoded || url.endsWith('/media/qa-original.mp4?ticket=qa')) && message.params.canceled && message.params.errorText === 'net::ERR_ABORTED' && url.startsWith(`http://127.0.0.1:${webPort}/media/qa-original.mp4`)) {
      expectedMediaCancellations.push({url,reason:'decoded original trailer/reload fixture deliberately unloaded'}); return;
    }
    if (/127\.0\.0\.1|phim4k-license-api|phimimg\.com/.test(url)) failedRequests.push({ url, error: message.params.errorText });
  }
  if (message.method === 'Network.responseReceived') {
    const { response } = message.params;
    if (response.status >= 400 && /127\.0\.0\.1|phim4k-license-api|phimimg\.com/.test(response.url)) {
      badResponses.push({ url: response.url, status: response.status });
    }
  }
});

function send(method, params = {}) {
  commandId += 1;
  const id = commandId;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`DevTools command timed out: ${method}`));
    }, 25000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolveCommand(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = true) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result?.value;
}

async function waitFor(expression, message, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression, false)) return;
    await delay(150);
  }
  throw new Error(message);
}

let result;
try {
  process.stderr.write('[qa] enabling browser diagnostics\n');
  await Promise.all([
    send('Page.enable'),
    send('Runtime.enable'),
    send('Network.enable'),
    send('Log.enable'),
  ]);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    platform: 'iPhone',
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {source:`(() => {
    const original = window.fetch;
    window.fetch = (input, options) => {
      const path = String(input);
      if (path.includes('/api/auth/status')) {
        return Promise.resolve(new Response(JSON.stringify({active:false,code:'KEY_REQUIRED'}),{status:401,headers:{'content-type':'application/json'}}));
      }
      if (path.includes('/api/watch-progress')) {
        const payload = options?.method === 'DELETE' ? {success:true,cleared:true} : options?.method === 'POST' ? {success:true,saved:1} : {success:true,items:[]};
        return Promise.resolve(new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}}));
      }
      return original(input, options);
    };
  })();`});
  await send('Page.navigate', { url: `http://127.0.0.1:${webPort}/` });
  process.stderr.write('[qa] loading iPhone web bundle\n');
  await waitFor('document.readyState === "complete"', 'Document did not finish loading');
  await waitFor("Boolean(window.App && window.Auth && typeof Player === 'object')", 'App modules were not initialized');
  // This run uses fixture licenses, so suppress only outbound usage writes.
  // The telemetry endpoint's authentication and sanitization are covered by
  // the Worker integration test with a server-side fixture database.
  await evaluate('window.API.trackUsage = () => {}');
  // Browser QA is deterministic and never relies on a production license or
  // discloses a production provider. Worker integration tests cover the real
  // authenticated catalogue and encrypted media-ticket boundary separately.
  await evaluate(`(() => {
    const year = new Date().getUTCFullYear();
    const artwork = location.origin + '/media/killer_shop_4k.jpg';
    const movies = Array.from({length: 60}, (_, index) => ({
      name: index === 0 ? 'Tuyet The Chien Hon' : 'QA Movie ' + (index + 1),
      origin_name: 'QA Original ' + (index + 1),
      slug: index === 0 ? 'tuyet-the-chien-hon' : 'qa-movie-' + (index + 1),
      poster_url: artwork, thumb_url: artwork, year, chieurap: true,
      quality: 'FHD', lang: 'Vietsub', episode_current: 'Full', type: 'series',
      category: [{name:'Hanh Dong'}], country: [{name:'Trung Quoc'}],
      content: 'Du lieu kiem thu giao dien cuc bo.'
    }));
    const page = (number) => ({
      items: movies.slice((number - 1) * 24, number * 24),
      pagination: {currentPage:number,totalPages:3,totalItems:60}
    });
    API.getHomeFeed = async () => ({
      hero: movies.slice(0, 6),
      sections: [
        {id:'cinema-new',title:'Phim chieu rap moi',items:movies.slice(0,12)},
        {id:'series-new',title:'Phim bo moi',items:movies.slice(12,24)},
        {id:'movies-new',title:'Phim le moi',items:movies.slice(24,36)},
        {id:'animation-new',title:'Hoat hinh moi',items:movies.slice(36,48)},
        {id:'recent-interest',title:'Dang duoc quan tam',items:movies.slice(48,60)}
      ],
      offline: false,
      updatedAt: new Date().toISOString()
    });
    API.getFilteredCatalog = async (_filters, number = 1) => page(number);
    API.getCategory = async (_category, number = 1) => ({title:'QA', ...page(number)});
    API.search = async (_query, number = 1) => ({query:'qa', ...page(number)});
    API.getDetail = async (slug) => ({
      movie: {...(movies.find(movie => movie.slug === slug) || movies[0]), trailer_url:'https://ignored.invalid/trailer'},
      episodes: [{server_name:'QA Server',server_data:[{name:'Tap 1',slug:'tap-1',filename:'tap-1',stream_ref:{movie:slug,server:0,episode:0}}]}]
    });
    API.getPlaybackTicket = async ref => ({
      streamUrl: location.origin + (ref?.movie === 'qa-touch' ? '/media/qa-seek.mp4' : '/media/qa-original.mp4?ticket=qa'),
      isHls: ref?.movie !== 'qa-touch'
    });
  })()`);
  // Use an original local trailer fixture, never a substitute in production.
  // This journey uses mocked license identities. Never send their periodic
  // status checks to production while exercising the live public catalogue.
  await evaluate("window.Auth.startHeartbeat = () => { clearInterval(window.Auth.heartbeatTimer); window.Auth.heartbeatTimer=null; }");
  const accessFlow = await evaluate(`(async()=>{
    const activate=API.activate, status=API.checkStatus, accessPolicy=Auth.getAccessPolicy;
    const hiddenTelegram=!document.getElementById('adminLoginFields').open && !document.getElementById('telegramInput').required;
    let submitted;
    API.activate=async(key,telegram,device)=>{submitted={telegram,device}; return {success:true,active:true,keyOnly:true,isAdmin:false,plan:'TEST'};};
    document.getElementById('keyInput').value='P4K-KEY-ONLY-QA';
    await handleActivation({preventDefault(){}});
    await new Promise(r=>setTimeout(r,650));
    renderAccountTab();
    const keyOnly=Auth.activeKeyData.keyOnly && submitted.telegram==='' && document.getElementById('accPlan').textContent==='TEST';
    Auth.clearStoredSession();
    Auth.getAccessPolicy=async()=>({freeAccess:true});
    API.checkStatus=async()=>({active:true,freeAccess:true,isAdmin:false,plan:'MIỄN KEY'});
    await Auth.init();
    const guest=Auth.activeKeyData.freeAccess && document.getElementById('activationGate').classList.contains('hidden') && document.getElementById('accAdminBtn').classList.contains('hidden');
    Auth.clearStoredSession(); API.activate=activate; API.checkStatus=status; Auth.getAccessPolicy=accessPolicy; Auth.triggerLock();
    return {hiddenTelegram,keyOnly,guest};
  })()`);
  if (Object.values(accessFlow).some(value=>!value)) throw new Error('Key-only/free access UI failed: '+JSON.stringify(accessFlow));
  console.log('[qa] key-only and guest UI passed', JSON.stringify(accessFlow));
  await evaluate(`(() => { const original = API.getDetail.bind(API); API.getDetail = async (...args) => { const data = await original(...args); return {...data, movie: {...data.movie, trailer_url: location.origin + '/media/qa-original.mp4'}}; }; })()`);

  process.stderr.write('[qa] checking key-only device approval unlock\n');
  const deviceApprovalState = await evaluate(`(async () => {
    const requestOriginal = window.API.requestDeviceAccess;
    const statusOriginal = window.API.checkDeviceAccess;
    window.API.requestDeviceAccess = async () => ({ status: 'pending', message: 'Đang chờ Admin duyệt' });
    window.API.checkDeviceAccess = async () => ({
      active: true,
      status: 'approved',
      plan: 'QA DEVICE',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    document.getElementById('keyInput').value = 'P4K-DEVICE-QA';
    await window.requestDeviceOnlyAccess();
    const state = {
      unlocked: !document.getElementById('appContainer').classList.contains('hidden'),
      deviceOnly: window.Auth.activeKeyData?.deviceOnly === true,
      telegramEmpty: !localStorage.getItem('phim4k_telegram_id'),
      pendingCleared: !localStorage.getItem('phim4k_pending_device_key'),
    };
    window.API.requestDeviceAccess = requestOriginal;
    window.API.checkDeviceAccess = statusOriginal;
    return state;
  })()`);

  await evaluate(`(async()=>{ window.Auth.unlockApp({
    key: 'P4K-QA-LOCAL', telegramId: '10000', plan: 'QA',
    expiresAt: new Date(Date.now() + 60000).toISOString(), isAdmin: false
  }); await window.App.loadHomeFeed(); })()`);
  process.stderr.write('[qa] checking home catalogue and posters\n');
  await waitFor('!window.App.homeFeedLoading && !window.App.homeFeedOffline && window.App.homeSections[0]?.id === "cinema-new"', 'Live new-cinema feed did not replace the bundled catalogue');
  await waitFor('document.querySelectorAll(".movie-card").length >= 6', 'Home catalogue did not render');
  await waitFor('[...document.querySelectorAll(".movie-card img")].some((img) => img.complete && img.naturalWidth > 0)', 'No movie poster loaded');
  await waitFor('document.querySelector(".coverflow-card.center img")?.naturalWidth > 0', 'Live cinema hero poster did not load');

  const homeState = await evaluate(`(() => {
    const images = [...document.querySelectorAll('.movie-card img')].slice(0, 8);
    const rail = document.querySelector('.cinema-rail');
    return {
      cards: document.querySelectorAll('.movie-card').length,
      loadedImages: images.filter((img) => img.complete && img.naturalWidth > 0).length,
      brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0).length,
      heroHasImage: Boolean(document.querySelector('.coverflow-card.center img')?.naturalWidth > 0),
      version: window.API.getVersion(),
      heroYears: window.App.heroList.map(m=>Number(m.year)),
      firstHeroCinema: window.App.heroList[0]?.chieurap === true,
      firstSection: window.App.homeSections[0]?.id,
      rails: document.querySelectorAll('.cinema-rail').length,
      railFlow: rail ? getComputedStyle(rail).gridAutoFlow : '',
      railOverflow: Boolean(rail && rail.scrollWidth > rail.clientWidth),
    };
  })()`);

  mkdirSync(resolve(projectRoot, 'data', 'qa'), { recursive: true });
  const homeScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(homeScreenshotPath, Buffer.from(homeScreenshot.data, 'base64'));
  const railState = await evaluate(`(async () => {
    const rail = document.querySelector('.cinema-rail');
    const section = rail?.closest('.cinema-rail-section');
    if (!rail || !section) return { found: false };
    section.scrollIntoView({ block: 'start' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const status = section.querySelector('.rail-position');
    const before = status?.textContent || '';
    rail.scrollLeft = Math.min(rail.scrollWidth - rail.clientWidth, rail.clientWidth * 1.15);
    rail.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      found: true,
      before,
      after: status?.textContent || '',
      moved: rail.scrollLeft > 0,
      cardWidth: rail.querySelector('.movie-card')?.getBoundingClientRect().width || 0,
    };
  })()`);
  const railsScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(railsScreenshotPath, Buffer.from(railsScreenshot.data, 'base64'));
  await evaluate('window.scrollTo(0, 0)');
  const scrollState = await evaluate(`(() => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    window.scrollTo(0, Math.min(maxScroll, 900));
    const moved = scrollY > 0;
    window.scrollTo(0, 0);
    return { moved, maxScroll };
  })()`);

  process.stderr.write('[qa] checking full catalogue filters and load more\n');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('#genreFilterChips .catalog-filter-chip')]
      .find((item) => item.textContent.trim() === 'Hành Động');
    if (!button) throw new Error('Action filter button missing');
    button.click();
  })()`);
  await waitFor('window.App.filterLoading === false && window.App.filterResults.length >= 24', 'Genre filter did not load a full page');
  const genreTotal = await evaluate('window.App.filterPagination.totalItems');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('#countryFilterChips .catalog-filter-chip')]
      .find((item) => item.textContent.trim() === 'Trung Quốc');
    if (!button) throw new Error('Country filter button missing');
    button.click();
  })()`);
  await waitFor('window.App.filterLoading === false && window.App.filterResults.length >= 24', 'Combined filter did not load a full page');
  await waitFor('Boolean(document.getElementById("catalogLoadMoreBtn"))', 'Load-more control was not rendered');
  await evaluate('document.getElementById("catalogLoadMoreBtn").click()');
  await waitFor('window.App.filterLoading === false && window.App.filterResults.length >= 48', 'Load more did not append the next page');
  await waitFor('[...document.querySelectorAll(".filtered-movie-grid .card-poster")].some((img) => img.complete && img.naturalWidth > 0)', 'Filtered poster artwork did not load');
  const filterState = await evaluate(`(() => {
    const grid = document.querySelector('.filtered-movie-grid');
    const loadMore = document.getElementById('catalogLoadMoreBtn');
    return {
      genreTotal: ${genreTotal},
      loaded: window.App.filterResults.length,
      combinedTotal: window.App.filterPagination.totalItems,
      currentPage: window.App.filterPagination.currentPage,
      cards: grid?.querySelectorAll('.movie-card').length || 0,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      loadMoreHeight: loadMore?.getBoundingClientRect().height || 0,
      summary: document.getElementById('catalogFilterSummary').textContent,
    };
  })()`);
  const filterScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(filterScreenshotPath, Buffer.from(filterScreenshot.data, 'base64'));
  await evaluate('window.App.clearHomeFilters()');

  process.stderr.write('[qa] checking category navigation\n');
  await evaluate("window.App.switchCategory('phim-bo', 1)");
  await waitFor('document.querySelectorAll("#categoryGrid .movie-card").length > 0', 'Category catalogue did not render');
  const categoryState = await evaluate(`(() => ({
    cards: document.querySelectorAll('#categoryGrid .movie-card').length,
    categoryVisible: !document.getElementById('categoryView').classList.contains('hidden'),
    coverflowHidden: document.getElementById('coverflowSection').classList.contains('hidden'),
  }))()`);
  await evaluate("window.App.switchCategory('home')");
  await waitFor('window.App.homeFeedLoading === false && document.querySelectorAll("#dynamicSections .movie-card").length > 0', 'Home catalogue did not recover after category navigation');

  process.stderr.write('[qa] checking live schedule tab\n');
  await evaluate("window.switchTab('schedule')");
  await waitFor('document.querySelectorAll("#scheduleGrid .schedule-card").length >= 10', 'Schedule did not render current movies');
  await waitFor('[...document.querySelectorAll("#scheduleGrid .schedule-poster")].some((img) => img.complete && img.naturalWidth > 0)', 'Schedule artwork did not load');
  const scheduleState = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#scheduleGrid .schedule-card')];
    const refresh = document.getElementById('scheduleRefreshBtn');
    const originalOpen = window.App.openMovieDetail;
    let openedSlug = '';
    window.App.openMovieDetail = (slug) => { openedSlug = slug; };
    cards[0].click();
    window.App.openMovieDetail = originalOpen;
    return {
      cards: cards.length,
      loadedPosters: [...document.querySelectorAll('#scheduleGrid .schedule-poster')].filter((img) => img.complete && img.naturalWidth > 0).length,
      updatedText: document.getElementById('scheduleUpdatedAt').textContent,
      refreshHeight: refresh.getBoundingClientRect().height,
      openedSlug,
      staleStaticDates: document.getElementById('scheduleTabContent').textContent.includes('31.07.2026'),
    };
  })()`);
  const scheduleScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(scheduleScreenshotPath, Buffer.from(scheduleScreenshot.data, 'base64'));
  await evaluate("window.switchTab('home')");

  await evaluate("window.App.openMovieDetail('tuyet-the-chien-hon')");
  process.stderr.write('[qa] checking movie detail and episodes\n');
  await waitFor('document.querySelectorAll("#episodesList .ep-btn").length > 0', 'Movie detail did not load episodes');
  await waitFor('document.getElementById("detailPoster").complete && document.getElementById("detailPoster").naturalWidth > 0', 'Detail poster did not load');
  await waitFor("getComputedStyle(document.getElementById('detailBackdrop')).backgroundImage !== 'none'", 'Detail backdrop did not load');
  const trailerState = await evaluate("({ disabled: !document.querySelector('#movieModal video, #movieModal iframe, #detailTrailer'), posterLoaded: document.getElementById('detailPoster').naturalWidth > 0 })");
  if (!trailerState.disabled || !trailerState.posterLoaded) throw new Error('Movie detail must show only images, even when the source supplies a trailer');
  const detailState = await evaluate(`(() => ({
    title: document.getElementById('detailName').textContent,
    episodes: document.querySelectorAll('#episodesList .ep-btn').length,
    posterWidth: document.getElementById('detailPoster').naturalWidth,
    serverTabs: document.querySelectorAll('#serverTabs .server-tab').length,
  }))()`);

  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  const detailCloseState = await evaluate(`(() => {
    const button = document.querySelector('#movieModal .modal-close-btn');
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const hittable = Boolean(hit?.closest('#movieModal .modal-close-btn'));
    button.click();
    return { width: rect.width, height: rect.height, hittable };
  })()`);
  await waitFor("document.getElementById('movieModal').classList.contains('hidden')", 'Movie detail close button did not work');
  trailerState.stoppedOnClose = await evaluate("!document.querySelector('#detailTrailerMedia video, #detailTrailerMedia iframe')");
  if (!trailerState.stoppedOnClose) throw new Error('Unexpected trailer after closing details');
  await evaluate("window.App.openMovieDetail('tuyet-the-chien-hon')");
  await waitFor('document.querySelectorAll("#episodesList .ep-btn").length > 0', 'Movie detail did not reopen');

  const nativePlayerState = await evaluate(`(async () => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {},
    };
    const server = window.App.activeMovieDetail.episodes[0];
    const episode = server.server_data[0];
    Player.open(window.App.activeMovieDetail.movie, episode, server.server_data, 0, window.App.activeMovieDetail.episodes, 0);
    await new Promise(resolve => setTimeout(resolve, 120));
    return {
      nativeHls: Player.usingNativeHls,
      ticketResolved: document.getElementById('videoPlayer').src.endsWith('/media/qa-original.mp4?ticket=qa'),
      quality: document.getElementById('btnQuality').textContent,
      playerVisible: !document.getElementById('playerModal').classList.contains('hidden'),
    };
  })()`);
  process.stderr.write('[qa] checking native iOS HLS path\n');
  const playerScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(playerScreenshotPath, Buffer.from(playerScreenshot.data, 'base64'));
  await evaluate('Player.close()');

  process.stderr.write('[qa] checking real video touch controls and edge-to-edge landscape\n');
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, screenWidth: 844, screenHeight: 390, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(() => {
    localStorage.setItem('phim4k-player-fit', 'cover');
    localStorage.removeItem('phim4k-player-fit-v2');
    Player.video.muted = true; Player.video.loop = true;
    Player.open({ name: 'Original QA', slug: 'qa-touch' }, { name: 'QA', stream_ref: {movie:'qa-touch',server:0,episode:0} });
    return Player.enterCinemaFullscreen();
  })()`);
  await waitFor('!Player.video.paused && Player.video.currentTime > 0.1', 'Original QA video did not play');
  await evaluate('Player.resetInactivityTimer(); Player.updateSubtitleSafeArea()');
  const subtitleDefault = await evaluate(`(() => {
    const v=Player.video, r=v.getBoundingClientRect(), c=document.getElementById('playerControls').getBoundingClientRect();
    const shown=getComputedStyle(v).objectFit==='contain' && r.bottom<=c.top-8;
    Player.wrapper.classList.add('inactive');
    const hidden=getComputedStyle(v).objectFit==='contain' && v.getBoundingClientRect().bottom<=innerHeight;
    Player.resetInactivityTimer();
    return {shown,hidden,legacyCropIgnored:Player.aspectMode==='contain'};
  })()`);
  if (!subtitleDefault.shown || !subtitleDefault.hidden || !subtitleDefault.legacyCropIgnored) throw new Error('Subtitle-safe fullscreen default regressed: '+JSON.stringify(subtitleDefault));
  const safeShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(resolve(projectRoot,'data/qa/fullscreen-subtitle-safe.png'),Buffer.from(safeShot.data,'base64'));
  // The subtitle-safe mode is locked; old builds must not re-enable cropping.
  await evaluate('Player.toggleAspectRatio()');
  await delay(250);
  const playerInteractionState = await evaluate(`(() => {
    const v = Player.video, r = v.getBoundingClientRect(), m=Player.modal.getBoundingClientRect(), vv=window.visualViewport;
    return {
      subtitleLocked: Player.aspectMode==='contain' && getComputedStyle(v).objectFit==='contain' && !Player.wrapper.classList.contains('aspect-cover'),
      videoInsideViewport: r.top>=-1 && r.left>=-1 && r.right<=(vv?.width||innerWidth)+1 && r.bottom<=(vv?.height||innerHeight)+1,
      modalInsideViewport: m.left>=(vv?.offsetLeft||0)-1 && m.top>=(vv?.offsetTop||0)-1 && m.right<=(vv?.offsetLeft||0)+(vv?.width||innerWidth)+1 && m.bottom<=(vv?.offsetTop||0)+(vv?.height||innerHeight)+1,
      width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight, classes:Player.wrapper.className
    };
  })()`);
  playerInteractionState.subtitleDefault = subtitleDefault;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 150 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(300);
  playerInteractionState.outsideDoesNotPause = await evaluate('!Player.video.paused');
  await delay(400);
  await evaluate('Player.resetInactivityTimer()');
  await evaluate(`Player.onSurfaceTap({detail:1,clientX:Player.video.getBoundingClientRect().left+10,timeStamp:performance.now()})`);
  const centerTarget = await evaluate(`(() => { const r=document.getElementById('btnCenterPlayPause').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await evaluate("Player.wrapper.classList.add('inactive')");
  releasingFixture = true; // Pausing may cancel the in-flight preload range; playback is asserted below.
  await send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[centerTarget]});
  await delay(100);
  const centerHeld=await evaluate(`(()=>{const r=document.getElementById('btnCenterPlayPause').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if(Math.abs(centerHeld.x-centerTarget.x)>1||Math.abs(centerHeld.y-centerTarget.y)>1) throw new Error('Press feedback moved center pause target: '+JSON.stringify({centerTarget,centerHeld}));
  await send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await delay(400);
  playerInteractionState.centerPauses = await evaluate('Player.video.paused');
  playerInteractionState.clockVisible = await evaluate(`(() => { const el=document.querySelector('.time-display'), r=el.getBoundingClientRect(), p=document.getElementById('progressContainer').getBoundingClientRect(); return getComputedStyle(el).display!=='none' && r.height>0 && r.top>=p.bottom && r.bottom<innerHeight && document.getElementById('durationTime').textContent!=='00:00'; })()`);
  if (!playerInteractionState.clockVisible) throw new Error('Landscape playback time missing below seek bar');
  if (await evaluate("Player.wrapper.classList.contains('inactive') || !Player.video.paused")) {
    const state=await evaluate(`(() => {const b=document.getElementById('btnCenterPlayPause'),r=b.getBoundingClientRect();return {paused:Player.video.paused,classes:Player.wrapper.className,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:document.elementFromPoint(${centerTarget.x},${centerTarget.y})?.outerHTML?.slice(0,200),oldTarget:${JSON.stringify(centerTarget)}};})()`);
    throw new Error('Delayed surface tap hid explicit pause controls: '+JSON.stringify(state));
  }
  await evaluate("document.getElementById('btnPlayPause').click()");
  await waitFor('!Player.video.paused', 'Bottom play control failed');
  playerInteractionState.bottomResumes = true;
  releasingFixture = true; // Browser cancels old byte ranges when seeking this local fixture.
  await evaluate('Player.video.currentTime = 12');
  await delay(150);
  const beforeSeek = await evaluate('Player.video.currentTime');
  for (let i=0;i<2;i++) {
    await send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:690,y:145}]});
    await send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await delay(70);
  }
  const afterSeek = await evaluate('Player.video.currentTime');
  playerInteractionState.doubleRight = afterSeek-beforeSeek > 9.7 && afterSeek-beforeSeek < 11.2;
  // Start a distinct gesture sequence. Four taps without the double-tap
  // window expiring are treated as one browser multi-tap gesture on mobile.
  await delay(400);
  for (let i=0;i<2;i++) {
    await send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:170,y:145}]});
    await send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await delay(70);
  }
  const afterBack = await evaluate('Player.video.currentTime');
  playerInteractionState.doubleLeft = afterSeek-afterBack > 9 && afterSeek-afterBack < 10.4;
  if (!playerInteractionState.doubleRight || !playerInteractionState.doubleLeft || await evaluate('Player.video.paused')) throw new Error('Real double tap seek failed: '+JSON.stringify({beforeSeek,afterSeek,afterBack}));
  await send('Runtime.evaluate', {expression:"Player.toggleAudioMode()",awaitPromise:true,userGesture:true});
  playerInteractionState.audioEnabled = await evaluate("document.getElementById('btnAudioMode').textContent === 'Rõ thoại'");
  if (!playerInteractionState.audioEnabled) throw new Error('Audio enhancement did not enable for local fixture');
  await evaluate('Player.toggleAspectRatio()');
  await send('Emulation.setDeviceMetricsOverride', { width: 852, height: 393, screenWidth: 852, screenHeight: 393, deviceScaleFactor: 1, mobile: true });
  await delay(100);
  playerInteractionState.fitPreferenceSurvivesResize = await evaluate("Player.aspectMode === 'contain' && getComputedStyle(Player.video).objectFit === 'contain'");
  await evaluate('Player.resetInactivityTimer(); Player.updateSubtitleSafeArea()');
  playerInteractionState.subtitleClear = await evaluate("Player.video.getBoundingClientRect().bottom <= document.getElementById('playerControls').getBoundingClientRect().top - 8");
  if (!playerInteractionState.subtitleClear) throw new Error('Fit mode subtitle strip overlaps controls');
  await evaluate("Player.toggleAspectRatio(); Player.resetInactivityTimer()");
  const fitScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(projectRoot, 'data/qa/phim4k-player-fit.png'), Buffer.from(fitScreenshot.data, 'base64'));
  if (!playerInteractionState.subtitleLocked || !playerInteractionState.videoInsideViewport || !playerInteractionState.modalInsideViewport || !playerInteractionState.outsideDoesNotPause || !playerInteractionState.centerPauses || !playerInteractionState.fitPreferenceSurvivesResize) throw new Error('Player interaction/fullscreen regression: ' + JSON.stringify(playerInteractionState));
  releasingFixture = true;
  await evaluate("Player.close(); Player.video.loop = false; localStorage.removeItem('phim4k-player-fit-v2')");
  await evaluate("Player.video.muted=true; Player.open({name:'QA reload',slug:'qa-reload'}, {name:'QA',stream_ref:{movie:'qa-reload',server:0,episode:0}})");
  await waitFor('!Player.video.paused && Player.video.currentTime > .1','Video did not recover after audio graph disposal');
  originalFixtureDecoded = true;
  await evaluate('Player.close()');
  releasingFixture = false;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 3, mobile: true });

  process.stderr.write('[qa] checking admin tabs, device request, and close controls\n');
  const adminCloseState = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    window.__qaOriginalFetch = originalFetch;
    window.fetch = (url, options) => {
      const path = String(url);
      if (path.includes('/api/admin/maintenance')) {
        const body = JSON.parse(options?.body || '{}');
        window.__qaMaintenance = body.enabled ? {
          active: true,
          message: body.message,
          expiresAt: body.durationMinutes ? new Date(Date.now() + body.durationMinutes * 60000).toISOString() : ''
        } : { active: false };
        return Promise.resolve(new Response(JSON.stringify({success:true,maintenance:window.__qaMaintenance,message:body.enabled?'Đã bật chế độ bảo trì.':'Đã mở lại ứng dụng.'}),{status:200,headers:{'content-type':'application/json'}}));
      }
      if (path.includes('/api/app/access-policy') || path.includes('/api/admin/access-policy')) {
        if (options?.method === 'POST') window.__qaFreeAccess = JSON.parse(options.body).freeAccess;
        return Promise.resolve(new Response(JSON.stringify({success:true,freeAccess:!!window.__qaFreeAccess,maintenance:window.__qaMaintenance||{active:false}}),{status:200,headers:{'content-type':'application/json'}}));
      }
      if (path.includes('/api/admin/device-access-requests')) {
        return Promise.resolve(new Response(JSON.stringify({ requests: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/admin/keys')) {
        return Promise.resolve(new Response(JSON.stringify({ keys: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/admin/downloads')) {
        return Promise.resolve(new Response(JSON.stringify({ downloads: {} }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/admin/logs')) {
        return Promise.resolve(new Response(JSON.stringify({ logs: [{
          id: 91, timestamp: new Date().toISOString(), action: 'usage_movie_open', type: 'USER',
          details: '', context: { movie: 'Phim QA', episode: 'Tập 1', device: 'device••••qa', session: 's-qa', runtime: 'iOS app', network: '4g', watched: 125 },
          account: { telegramId: '1000000001', deviceHash: 'device••••qa' }
        }], hasMore: true, nextCursor: 91 }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/admin/content-status')) {
        return Promise.resolve(new Response(JSON.stringify({
          source: 'PhimAPI metadata', status: 'READY', lastSuccessfulRefreshAt: new Date().toISOString(),
          cacheActive: true, cacheTtlSeconds: 30, ads: { sdkEmbedded: false },
          providers: [
            { id: 'catalog', label: 'PhimAPI metadata', status: 'READY', purpose: 'Danh mục và poster' },
            { id: 'jellyfin', label: 'Jellyfin tự host', status: 'NEEDS_CONFIGURATION', purpose: 'Kho được cấp quyền' }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/admin/announcement')) {
        const body = JSON.parse(options?.body || '{}');
        if (body.action === 'clear') window.__qaAnnouncement = { active: false };
        else window.__qaAnnouncement = {
          active: true, id: 'notice-qa', title: body.title, message: body.message,
          expiresAt: new Date(Date.now() + body.durationMinutes * 60000).toISOString()
        };
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          message: body.action === 'clear' ? 'Đã gỡ thông báo.' : 'Đã ghim thông báo.',
          announcement: window.__qaAnnouncement
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/app/announcement')) {
        return Promise.resolve(new Response(JSON.stringify(window.__qaAnnouncement || { active: false }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return originalFetch(url, options);
    };
    window.confirm = () => true;
    window.Auth.activeKeyData = { isAdmin: true, telegramId: '1000000001', key: 'P4K-QA-LOCAL', active: true };
    window.Admin.open();
    await window.Admin.switchTab('logs');
    const logPanelVisible = !document.getElementById('adminTabLogs').classList.contains('hidden');
    const userLogRendered = document.getElementById('terminalLogsBody').textContent.includes('Phim QA');
    const viewerCount = document.getElementById('logViewerCount').textContent;
    const sessionCount = document.getElementById('logSessionCount').textContent;
    const watchTime = document.getElementById('logWatchTime').textContent;
    const loadMoreVisible = !document.getElementById('logsLoadMoreBtn').classList.contains('hidden');
    await window.Admin.switchTab('downloads');
    const downloads = document.getElementById('adminTabDownloads');
    const logs = document.getElementById('adminTabLogs');
    const downloadsVisible = !downloads.classList.contains('hidden')
      && !downloads.parentElement.closest('.hidden')
      && downloads.getBoundingClientRect().height > 0;
    const updateButton = downloads.querySelector('button[type="submit"]');
    const updateButtonVisible = Boolean(updateButton && updateButton.getBoundingClientRect().height >= 40);
    const logsHiddenAfterSwitchDownloads = logs.classList.contains('hidden');
    await window.Admin.switchTab('content');
    const providerCards = document.querySelectorAll('#contentProviderList .content-provider-card').length;
    const adsStatus = document.getElementById('contentAdsStatus').textContent;
    document.getElementById('announcementTitleInput').value = 'Tin QA';
    document.getElementById('announcementMessageInput').value = 'Phim mới đã cập nhật.';
    document.getElementById('announcementDurationInput').value = '2';
    document.getElementById('announcementDurationUnit').value = '60';
    await window.Admin.publishAnnouncement();
    const announcementButton = document.getElementById('announcementPublishBtn');
    const announcementButtonRect = announcementButton.getBoundingClientRect();
    const announcementVisible = !document.getElementById('globalAnnouncement').classList.contains('hidden');
    const announcementText = document.getElementById('globalAnnouncementMessage').textContent;
    const announcementState = document.getElementById('announcementAdminState').textContent;
    await window.Admin.switchTab('logs');
    const requestButton = document.getElementById('btnRequestDeviceAccess');
    const button = document.querySelector('#adminModal .modal-close-btn');
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const hittable = Boolean(hit?.closest('#adminModal .modal-close-btn'));
    document.getElementById('adminTabLogs').scrollIntoView({ block: 'start' });
    return {
      width: rect.width,
      height: rect.height,
      hittable,
      downloadsVisible,
      logsHidden: logsHiddenAfterSwitchDownloads,
      updateButtonVisible,
      logPanelVisible,
      userLogRendered,
      viewerCount,
      sessionCount,
      watchTime,
      providerCards,
      adsStatus,
      announcementVisible,
      announcementText,
      announcementState,
      announcementButtonHeight: announcementButtonRect.height,
      loadMoreVisible,
      requestButtonAvailable: Boolean(
        requestButton
        && requestButton.textContent.includes('Báo Admin')
        && Number.parseFloat(getComputedStyle(requestButton).minHeight) >= 44
      ),
    };
  })()`);
  await evaluate("window.Admin.switchTab('keys'); document.querySelector('.admin-dialog').scrollTop=0");
  // Measure final tap targets, not the opening animation's temporary 0.96 scale.
  await waitFor("document.querySelector('.admin-dialog').getAnimations().every(a=>a.playState==='finished')", 'Admin opening animation did not settle');
  const adminQuick = await evaluate(`(()=>{
    const entries=['adminReadLogsBtn','adminGetUpdateBtn'].map(id=>{
      const b=document.getElementById(id);b.scrollIntoView({block:'center',behavior:'instant'});
      const r=b.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {id,height:r.height,hittable:h===b||b.contains(h),textFits:b.scrollWidth<=b.clientWidth+1};
    });
    return {entries,version:document.getElementById('adminBuildVersion').textContent,expectedVersion:API.getVersion()};
  })()`);
  if(adminQuick.entries.some(b=>b.height<48||!b.hittable||!b.textFits)||!adminQuick.version.includes(adminQuick.expectedVersion)) throw new Error('Admin shortcuts not accessible: '+JSON.stringify(adminQuick));
  await evaluate("document.getElementById('adminReadLogsBtn').click()");
  await waitFor("Admin.currentTab==='logs'&&!document.getElementById('adminTabLogs').classList.contains('hidden')", 'Admin log shortcut failed');
  await evaluate("document.getElementById('adminGetUpdateBtn').click()");
  await waitFor("!document.getElementById('downloadAppModal').classList.contains('hidden')", 'Admin download shortcut failed');
  await evaluate("hideDownloadModal(); Admin.switchTab('keys'); document.querySelector('.admin-dialog').scrollTop=0");
  const accessPolicyUI=await evaluate(`(async()=>{
    document.getElementById('adminAccessPolicyBtn').click();
    await Admin.loadAccessPolicy();
    const toggle=document.getElementById('adminFreeAccess');
    const initiallyOff=!toggle.checked && !toggle.disabled;
    toggle.checked=true; await Admin.saveAccessPolicy();
    const enabled=toggle.checked && window.__qaFreeAccess===true;
    toggle.checked=false; await Admin.saveAccessPolicy();
    const disabled=!toggle.checked && window.__qaFreeAccess===false;
    Admin.showTab('keys');
    return {initiallyOff,enabled,disabled};
  })()`);
  if(Object.values(accessPolicyUI).some(value=>!value)) throw new Error('Admin access policy UI failed: '+JSON.stringify(accessPolicyUI));
  console.log('[qa] admin access policy UI passed',JSON.stringify(accessPolicyUI));
  const maintenanceUI=await evaluate(`(async()=>{
    Admin.showTab('downloads');
    await Admin.loadMaintenance();
    const toggle=document.getElementById('adminMaintenanceToggle');
    const initiallyOff=!toggle.checked && !toggle.disabled;
    document.getElementById('maintenanceMessageInput').value='Đang nâng cấp QA.';
    document.getElementById('maintenanceDurationInput').value='15';
    toggle.checked=true; await Admin.saveMaintenance();
    const enabled=toggle.checked && window.__qaMaintenance?.active===true
      && document.getElementById('maintenanceAdminState').classList.contains('active')
      && document.getElementById('adminMaintenanceBtn').classList.contains('active');
    toggle.checked=false; await Admin.saveMaintenance();
    const disabled=!toggle.checked && window.__qaMaintenance?.active===false
      && !document.getElementById('maintenanceAdminState').classList.contains('active');
    Admin.showTab('keys');
    return {initiallyOff,enabled,disabled};
  })()`);
  if(Object.values(maintenanceUI).some(value=>!value)) throw new Error('Admin maintenance UI failed: '+JSON.stringify(maintenanceUI));
  console.log('[qa] admin maintenance UI passed',JSON.stringify(maintenanceUI));
  adminCloseState.maintenance=maintenanceUI;
  adminCloseState.quickActions=adminQuick;
  const adminLayout = await evaluate(`(() => {
    const dialog=document.querySelector('.admin-dialog'), nav=dialog.querySelector('.admin-tabs-nav');
    const rows=[...nav.querySelectorAll('button')];
    const tabs=rows.map(b=>{b.scrollIntoView({block:'nearest',inline:'center'});const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {height:r.height,textFits:b.scrollWidth<=b.clientWidth+1,visible:r.top>=0&&r.bottom<=innerHeight,hittable:hit===b||b.contains(hit)};});
    const range=dialog.scrollHeight-dialog.clientHeight; dialog.scrollTop=range;
    const reachesBottom=Math.abs(dialog.scrollTop-range)<2;
    dialog.scrollTop=0; nav.scrollLeft=0;
    return {tabs,navHeight:nav.getBoundingClientRect().height,reachesBottom,range};
  })()`);
  if (!adminLayout.reachesBottom || adminLayout.range<=0 || adminLayout.navHeight<56 || adminLayout.tabs.some(t=>t.height<44||!t.visible||!t.hittable||!t.textFits)) throw new Error('Admin tabs collapsed/obstructed: '+JSON.stringify(adminLayout));
  adminCloseState.layout=adminLayout;
  const adminShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(resolve(projectRoot,'data/qa/admin-tabs-unclipped.png'),Buffer.from(adminShot.data,'base64'));
  await evaluate("window.Admin.switchTab('content')");
  const announcementScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(announcementScreenshotPath, Buffer.from(announcementScreenshot.data, 'base64'));
  await evaluate("window.Admin.switchTab('logs')");
  const adminLogsScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(adminLogsScreenshotPath, Buffer.from(adminLogsScreenshot.data, 'base64'));
  await evaluate(`(() => {
    document.querySelector('#adminModal .modal-close-btn').click();
    window.fetch = window.__qaOriginalFetch;
    delete window.__qaOriginalFetch;
  })()`);
  await waitFor("document.getElementById('adminModal').classList.contains('hidden')", 'Admin close button did not work');

  console.log('[qa] checking visible iPhone download entry, scrolling and safe close');
  // The earlier player checks leave its parent details dialog open. Return to
  // the app through the real close action before testing the account tab.
  await evaluate("document.querySelector('#movieModal .modal-close-btn').click()");
  await waitFor("document.getElementById('movieModal').classList.contains('hidden')", 'Details remained above account tab');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("window.PHIM4K_PLATFORM='ios'; switchTab('account')");
  await delay(600); // Let tab navigation's smooth scroll finish before targeting the account control.
  await evaluate("document.getElementById('accDownloadBtn').scrollIntoView({block:'center',behavior:'instant'})");
  await delay(100);
  const accountDownloadShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(resolve(projectRoot,'data/qa/iphone-account-download.png'),Buffer.from(accountDownloadShot.data,'base64'));
  const phoneDownloads = await evaluate(`(async()=>{
    const button=document.getElementById('accDownloadBtn'),r=button.getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    const entryVisible=r.height>=44&&r.top>=0&&r.bottom<=innerHeight&&(hit===button||button.contains(hit));
    button.click(); await refreshPublicDownloads();
    return {entryVisible, entryRect:{top:r.top,bottom:r.bottom,height:r.height},hitId:hit?.id, status:document.getElementById('downloadReleaseStatus').textContent,
      safeLink:Phim4KPlatform.safeUrl(document.getElementById('btnDownloadIpa').href).length>0};
  })()`);
  await delay(300);
  Object.assign(phoneDownloads,await evaluate(`(()=>{
    const d=document.querySelector('.download-dialog'); d.scrollTop=d.scrollHeight;
    const close=d.querySelector('.modal-close-btn'),r=close.getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {scrolls:d.scrollTop>100,atBottom:Math.abs(d.scrollHeight-d.clientHeight-d.scrollTop)<2,
      closeHittable:r.height>=44&&r.top>=0&&r.bottom<=innerHeight&&(hit===close||close.contains(hit)),
      noOverflow:d.scrollWidth<=d.clientWidth+1};
  })()`));
  const phoneDownloadShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(resolve(projectRoot,'data/qa/iphone-download-modal.png'),Buffer.from(phoneDownloadShot.data,'base64'));
  await evaluate("document.querySelector('#downloadAppModal .modal-close-btn').click()");
  phoneDownloads.closed=await evaluate("document.getElementById('downloadAppModal').classList.contains('hidden')");
  // The public download screen must work from the locked gate too, never unlock it.
  Object.assign(phoneDownloads,await evaluate(`(async()=>{
    document.getElementById('activationGate').classList.remove('hidden');
    document.body.classList.add('activation-locked');
    document.getElementById('gateDownloadBtn').click(); await refreshPublicDownloads();
    return {gateStillLocked:document.body.classList.contains('activation-locked'),
      aboveGate:Number(getComputedStyle(document.getElementById('downloadAppModal')).zIndex)>Number(getComputedStyle(document.getElementById('activationGate')).zIndex)};
  })()`));
  await evaluate("hideDownloadModal(); document.getElementById('activationGate').classList.add('hidden'); document.body.classList.remove('activation-locked'); switchTab('home')");
  if(!phoneDownloads.entryVisible||!phoneDownloads.safeLink||!phoneDownloads.scrolls||!phoneDownloads.atBottom||!phoneDownloads.closeHittable||!phoneDownloads.noOverflow||!phoneDownloads.closed||!phoneDownloads.gateStillLocked||!phoneDownloads.aboveGate) throw new Error('iPhone downloads failed: '+JSON.stringify(phoneDownloads));
  console.log('[qa] iPhone downloads passed',JSON.stringify(phoneDownloads));
  console.log('[qa] checking Windows download layout and Android TV remote');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  const windowsDownloads = await evaluate(`(async () => {
    const saved = API.fetchJson;
    API.fetchJson = async () => ({ windows: { url: 'https://example.com/app.exe', version: API.getVersion() }, android_tv: { url: 'https://example.com/tv.apk', version: API.getVersion() } });
    window.PHIM4K_PLATFORM = 'windows';
    openDownloadModal(); await refreshPublicDownloads();
    const enabled = document.getElementById('btnDownloadExe').getAttribute('aria-disabled') === 'false';
    const missingDisabled = !document.getElementById('btnDownloadIpa').hasAttribute('href');
    const unsafe = Phim4KPlatform.safeUrl('javascript:alert(1)') === '';
    hideDownloadModal(); API.fetchJson = saved;
    return { enabled, missingDisabled, unsafe };
  })()`);
  await evaluate("window.PHIM4K_PLATFORM = 'android_tv'");
  await evaluate(readFileSync(resolve(projectRoot, 'public/js/tv.js'), 'utf8'));
  await evaluate(`(() => {
    const saved = API.fetchJson;
    API.fetchJson = async () => ({});
    openDownloadModal();
    setTimeout(() => { API.fetchJson = saved; }, 500);
  })()`);
  await delay(600);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  const tvState = await evaluate(`({ active: document.documentElement.classList.contains('tv-mode'), focusedInModal: !!document.activeElement.closest('#downloadAppModal'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 })`);
  const tvShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(projectRoot, 'data/qa/phim4k-tv-downloads.png'), Buffer.from(tvShot.data, 'base64'));
  const backClosed = await evaluate("Phim4KTV.back() && document.getElementById('downloadAppModal').classList.contains('hidden')");
  if (!windowsDownloads.enabled || !windowsDownloads.missingDisabled || !windowsDownloads.unsafe || !tvState.active || !tvState.focusedInModal || tvState.horizontalOverflow || !backClosed) throw new Error('Windows/TV downloads or remote smoke failed: ' + JSON.stringify({ windowsDownloads, tvState, backClosed }));
  console.log('[qa] Windows downloads and TV focus/back passed');
  const activeVersion = await evaluate('API.getVersion()');
  const checksPassed = homeState.version === activeVersion
    && homeState.heroYears.length > 0
    && homeState.heroYears.every(year=>year===new Date().getUTCFullYear())
    && homeState.firstHeroCinema
    && homeState.firstSection === 'cinema-new'
    && homeState.rails >= 3
    && homeState.railFlow === 'column'
    && homeState.railOverflow
    && railState.found
    && railState.moved
    && railState.before !== railState.after
    && railState.cardWidth >= 140
    && deviceApprovalState.unlocked
    && deviceApprovalState.deviceOnly
    && deviceApprovalState.telegramEmpty
    && deviceApprovalState.pendingCleared
    && homeState.cards >= 6
    && homeState.loadedImages > 0
    && homeState.brokenImages === 0
    && homeState.heroHasImage
    && scrollState.moved
    && scrollState.maxScroll > 0
    && filterState.genreTotal > 24
    && filterState.loaded >= 48
    && filterState.combinedTotal > 24
    && filterState.currentPage === 2
    && filterState.cards >= 48
    && filterState.columns === 2
    && filterState.loadMoreHeight >= 44
    && categoryState.cards > 0
    && categoryState.categoryVisible
    && categoryState.coverflowHidden
    && scheduleState.cards >= 10
    && scheduleState.loadedPosters > 0
    && scheduleState.updatedText.includes('Đồng bộ lúc')
    && scheduleState.refreshHeight >= 44
    && Boolean(scheduleState.openedSlug)
    && !scheduleState.staleStaticDates
    && detailState.episodes > 0
    && detailState.posterWidth > 0
    && detailState.serverTabs > 0
    && detailCloseState.width >= 44
    && detailCloseState.height >= 44
    && detailCloseState.hittable
    && nativePlayerState.nativeHls
    && nativePlayerState.ticketResolved
    && nativePlayerState.quality === 'Tự động'
    && nativePlayerState.playerVisible
    && adminCloseState.width >= 44
    && adminCloseState.height >= 44
    && adminCloseState.hittable
    && adminCloseState.downloadsVisible
    && adminCloseState.logsHidden
    && adminCloseState.updateButtonVisible
    && adminCloseState.requestButtonAvailable
    && adminCloseState.logPanelVisible
    && adminCloseState.userLogRendered
    && adminCloseState.viewerCount === '1'
    && adminCloseState.sessionCount === '1'
    && adminCloseState.watchTime.includes('2 phút')
    && adminCloseState.providerCards === 2
    && adminCloseState.adsStatus.includes('Không nhúng')
    && adminCloseState.announcementVisible
    && adminCloseState.announcementText.includes('cập nhật')
    && adminCloseState.announcementState.includes('Đang ghim')
    && adminCloseState.announcementButtonHeight >= 44
    && adminCloseState.loadMoreVisible
    && Object.values(adminCloseState.maintenance || {}).every(Boolean)
    && exceptions.length === 0
    && consoleErrors.length === 0
    && failedRequests.length === 0
    && badResponses.length === 0;

  result = {
    passed: checksPassed,
    phoneDownloads,
    deviceApproval: deviceApprovalState,
    playerInteraction: playerInteractionState,
    trailer: trailerState,
    expectedMediaCancellations,
    home: homeState,
    rails: railState,
    scroll: scrollState,
    filter: filterState,
    category: categoryState,
    schedule: scheduleState,
    detail: detailState,
    detailClose: detailCloseState,
    nativePlayer: nativePlayerState,
    adminClose: adminCloseState,
    exceptions,
    consoleErrors,
    failedRequests,
    badResponses,
    screenshot: screenshotPath,
    homeScreenshot: homeScreenshotPath,
    playerScreenshot: playerScreenshotPath,
    scheduleScreenshot: scheduleScreenshotPath,
    filterScreenshot: filterScreenshotPath,
    adminLogsScreenshot: adminLogsScreenshotPath,
    announcementScreenshot: announcementScreenshotPath,
    railsScreenshot: railsScreenshotPath,
  };
  if (!checksPassed) process.exitCode = 1;
} catch (error) {
  let pageState = null;
  try {
    pageState = await evaluate(`(() => ({
      url: location.href,
      readyState: document.readyState,
      app: typeof window.App,
      auth: typeof window.Auth,
      player: typeof Player,
      cards: document.querySelectorAll('.movie-card').length,
      sections: document.querySelectorAll('.movie-section').length,
      appHidden: document.getElementById('appContainer')?.classList.contains('hidden'),
      gateHidden: document.getElementById('activationGate')?.classList.contains('hidden'),
      homeLoading: window.App?.homeFeedLoading,
      homeCatalog: window.App?.homeCatalog?.length,
      homeSections: window.App?.homeSections?.map((section) => ({ id: section.id, count: section.items?.length })),
      scripts: [...document.scripts].map((script) => script.src),
      bodyText: document.body?.innerText?.slice(0, 300) || '',
    }))()`);
  } catch (_diagnosticError) {}
  try {
    mkdirSync(resolve(projectRoot, 'data', 'qa'), { recursive: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  } catch (_screenshotError) {}
  result = {
    passed: false,
    error: error?.stack || String(error),
    pageState,
    exceptions,
    consoleErrors,
    failedRequests,
    badResponses,
    screenshot: screenshotPath,
  };
  process.exitCode = 1;
} finally {
  try { socket.close(); } catch (_error) {}
  if (process.platform === 'win32' && browser.pid) {
    spawnSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    browser.kill();
  }
  await delay(1500);
  staticServer.closeAllConnections?.();
  await close(staticServer);
  const safeTempRoot = resolve(tmpdir());
  const resolvedProfile = resolve(profilePath);
  if (resolvedProfile.startsWith(`${safeTempRoot}${sep}`) && resolvedProfile.includes('phim4k-edge-qa-')) {
    try {
      rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } catch (cleanupError) {
      if (result) result.cleanupWarning = cleanupError.code || cleanupError.message;
    }
  }
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => {
  process.exit(process.exitCode || 0);
});
