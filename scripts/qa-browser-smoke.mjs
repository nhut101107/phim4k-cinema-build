import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = resolve(import.meta.dirname, '..');
const webRoot = resolve(projectRoot, 'ios', 'App', 'App', 'public');
const screenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-detail-smoke.png');
const homeScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-home-smoke.png');
const playerScreenshotPath = resolve(projectRoot, 'data', 'qa', 'phim4k-player-smoke.png');
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
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
  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = normalize(resolve(webRoot, `.${requested}`));
  if (!(target === webRoot || target.startsWith(`${webRoot}${sep}`)) || !existsSync(target)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
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
  await send('Page.navigate', { url: `http://127.0.0.1:${webPort}/` });
  process.stderr.write('[qa] loading iPhone web bundle\n');
  await waitFor('document.readyState === "complete"', 'Document did not finish loading');
  await waitFor("Boolean(window.App && window.Auth && typeof Player === 'object')", 'App modules were not initialized');

  await evaluate(`window.Auth.unlockApp({
    key: 'P4K-QA-LOCAL', telegramId: '10000', plan: 'QA',
    expiresAt: new Date(Date.now() + 60000).toISOString(), isAdmin: false
  });`);
  process.stderr.write('[qa] checking home catalogue and posters\n');
  await waitFor('document.querySelectorAll(".movie-card").length >= 6', 'Home catalogue did not render');
  await waitFor('[...document.querySelectorAll(".movie-card img")].some((img) => img.complete && img.naturalWidth > 0)', 'No movie poster loaded');

  const homeState = await evaluate(`(() => {
    const images = [...document.querySelectorAll('.movie-card img')].slice(0, 8);
    return {
      cards: document.querySelectorAll('.movie-card').length,
      loadedImages: images.filter((img) => img.complete && img.naturalWidth > 0).length,
      brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0).length,
      heroHasImage: Boolean(document.querySelector('.coverflow-card.center img')?.naturalWidth > 0),
      version: window.API.getVersion(),
    };
  })()`);

  mkdirSync(resolve(projectRoot, 'data', 'qa'), { recursive: true });
  const homeScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(homeScreenshotPath, Buffer.from(homeScreenshot.data, 'base64'));
  const scrollState = await evaluate(`(() => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    window.scrollTo(0, Math.min(maxScroll, 900));
    const moved = scrollY > 0;
    window.scrollTo(0, 0);
    return { moved, maxScroll };
  })()`);

  await evaluate("window.App.openMovieDetail('tuyet-the-chien-hon')");
  process.stderr.write('[qa] checking movie detail and episodes\n');
  await waitFor('document.querySelectorAll("#episodesList .ep-btn").length > 0', 'Movie detail did not load episodes');
  await waitFor('document.getElementById("detailPoster").complete && document.getElementById("detailPoster").naturalWidth > 0', 'Detail poster did not load');
  const detailState = await evaluate(`(() => ({
    title: document.getElementById('detailName').textContent,
    episodes: document.querySelectorAll('#episodesList .ep-btn').length,
    posterWidth: document.getElementById('detailPoster').naturalWidth,
    serverTabs: document.querySelectorAll('#serverTabs .server-tab').length,
  }))()`);

  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  const nativePlayerState = await evaluate(`(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {},
    };
    const server = window.App.activeMovieDetail.episodes[0];
    const episode = server.server_data[0];
    Player.open(window.App.activeMovieDetail.movie, episode, server.server_data, 0, window.App.activeMovieDetail.episodes, 0);
    return {
      nativeHls: Player.usingNativeHls,
      sourceIsHls: document.getElementById('videoPlayer').src.includes('.m3u8'),
      quality: document.getElementById('btnQuality').textContent,
      playerVisible: !document.getElementById('playerModal').classList.contains('hidden'),
    };
  })()`);
  process.stderr.write('[qa] checking native iOS HLS path\n');
  const playerScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(playerScreenshotPath, Buffer.from(playerScreenshot.data, 'base64'));

  const relevantResponses = await evaluate('true');
  void relevantResponses;
  const checksPassed = homeState.version === '3.4.7'
    && homeState.cards >= 6
    && homeState.loadedImages > 0
    && homeState.brokenImages === 0
    && homeState.heroHasImage
    && scrollState.moved
    && scrollState.maxScroll > 0
    && detailState.episodes > 0
    && detailState.posterWidth > 0
    && detailState.serverTabs > 0
    && nativePlayerState.nativeHls
    && nativePlayerState.sourceIsHls
    && nativePlayerState.quality === 'Tự động'
    && nativePlayerState.playerVisible
    && exceptions.length === 0
    && consoleErrors.length === 0
    && failedRequests.length === 0
    && badResponses.length === 0;

  result = {
    passed: checksPassed,
    home: homeState,
    scroll: scrollState,
    detail: detailState,
    nativePlayer: nativePlayerState,
    exceptions,
    consoleErrors,
    failedRequests,
    badResponses,
    screenshot: screenshotPath,
    homeScreenshot: homeScreenshotPath,
    playerScreenshot: playerScreenshotPath,
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
