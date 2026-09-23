import coreWorker from './worker.mjs';

const RELAY_HEALTH_TTL_MS = 30_000;
const RELAY_HEALTH_TIMEOUT_MS = 2_500;
// Artwork is fetched directly by the Worker and never uses the VPS relay. Do
// not make every poster wait for a relay health check, especially while the
// relay is degraded and many cards are loading concurrently.
const RELAY_MEDIA_PATHS = new Set(['/api/media/stream', '/api/movies/play']);
const RETRYABLE_RELAY_STATUSES = new Set([502, 503, 504]);

let relayHealth = { origin: '', checkedAt: 0, healthy: true };
let relayHealthCheck = null;

// Do not merge or deploy this 3.56 manifest until all four Drive files permit
// anonymous reader access. The previous 3.55 production links remain active.
const PUBLIC_RELEASES = Object.freeze({
  android: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=1cIKz4nVb1ODD5TFqRx_yxc6bn02QB8pS&export=download&confirm=t',
    version: '3.56',
    sha256: '78e0a673bf61f61bb78d5971e3a3c6986bd199fedacc89a5f24c5aded5f56325',
    sizeBytes: 3967808,
    signer: 'github-actions[bot]',
  }),
  android_tv: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=132cxRcOetx_AsOm6m9vgDFoVJCZOwWhs&export=download&confirm=t',
    version: '3.56',
    sha256: '5d8335f77144aebbaf882992351b7a059857a932e781c335d0375769dcf148a8',
    sizeBytes: 3963712,
    signer: 'github-actions[bot]',
  }),
  ios: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=14AOZdrCewKFU2Rn52oySmgXNqQiWzNW_&export=download&confirm=t',
    version: '3.56',
    sha256: '94959219094d568eb8722db148fceac88f66d1c297a1f6d562f579ca51ab99c0',
    sizeBytes: 4424082,
    signer: 'github-actions[bot]',
  }),
  windows: Object.freeze({
    url: 'https://github.com/nhut101107/phim4k-cinema-build/releases/download/ios-v3.56/4K-Cinema-Windows-3.56-x64.exe',
    version: '3.56',
    sha256: 'ec1fc094ca880b412b175db973187cb37af4f71100a15e3c1463b8fc159c0e84',
    sizeBytes: 120969742,
    signer: 'github-actions[bot]',
  }),
});

function responseHeaders(cacheControl = 'no-store') {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  };
}

function jsonResponse(payload, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(cacheControl),
  });
}

function compareVersions(left, right) {
  const a = String(left || '').match(/\d+/g)?.map(Number) || [];
  const b = String(right || '').match(/\d+/g)?.map(Number) || [];
  const length = Math.max(a.length, b.length, 1);
  for (let index = 0; index < length; index += 1) {
    const av = Number.isFinite(a[index]) ? a[index] : 0;
    const bv = Number.isFinite(b[index]) ? b[index] : 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function normalizeLegacyFields(downloads) {
  return {
    ...downloads,
    androidUrl: downloads.android?.url || '',
    androidVersion: downloads.android?.version || '',
    iosUrl: downloads.ios?.url || '',
    iosVersion: downloads.ios?.version || '',
    windowsUrl: downloads.windows?.url || '',
    windowsVersion: downloads.windows?.version || '',
    android_tvUrl: downloads.android_tv?.url || '',
    android_tvVersion: downloads.android_tv?.version || '',
  };
}

async function fetchLiveDownloads(executionContext) {
  void executionContext;
  return normalizeLegacyFields(PUBLIC_RELEASES);
}

function configuredRelayOrigin(env) {
  const raw = String(env?.VPS_RELAY_ORIGIN || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return '';
    return url.origin;
  } catch (_error) {
    return '';
  }
}

function directWorkerEnv(env) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'VPS_RELAY_ORIGIN') return '';
      return Reflect.get(target, property, receiver);
    },
  });
}

async function isRelayHealthy(env) {
  const origin = configuredRelayOrigin(env);
  if (!origin) return false;
  const timestamp = Date.now();
  if (relayHealth.origin === origin && timestamp - relayHealth.checkedAt < RELAY_HEALTH_TTL_MS) {
    return relayHealth.healthy;
  }

  if (relayHealthCheck?.origin === origin) return relayHealthCheck.promise;

  const promise = (async () => {
    let healthy = false;
    try {
      const response = await fetch(`${origin}/healthz`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(RELAY_HEALTH_TIMEOUT_MS),
        headers: { accept: 'text/plain' },
      });
      healthy = response.ok;
      try { await response.body?.cancel(); } catch (_error) {}
    } catch (_error) {
      healthy = false;
    }

    relayHealth = { origin, checkedAt: Date.now(), healthy };
    return healthy;
  })();
  relayHealthCheck = { origin, promise };
  try {
    return await promise;
  } finally {
    if (relayHealthCheck?.promise === promise) relayHealthCheck = null;
  }
}

function markRelayUnhealthy(env) {
  const origin = configuredRelayOrigin(env);
  if (!origin) return;
  relayHealth = { origin, checkedAt: Date.now(), healthy: false };
}

async function resilientCoreFetch(request, env, executionContext) {
  const pathname = new URL(request.url).pathname;
  const origin = configuredRelayOrigin(env);
  if (!origin || !RELAY_MEDIA_PATHS.has(pathname)) {
    return coreWorker.fetch(request, env, executionContext);
  }

  const directEnv = directWorkerEnv(env);
  if (!await isRelayHealthy(env)) {
    return coreWorker.fetch(request, directEnv, executionContext);
  }

  // Clone before coreWorker consumes a POST body. Playback ticket requests are
  // small, bounded JSON bodies and are safe to replay once through the direct
  // Worker path when the relay accepts health checks but rejects media.
  let retryRequest = null;
  try { retryRequest = request.clone(); } catch (_error) {}
  const response = await coreWorker.fetch(request, env, executionContext);
  const retryable = RETRYABLE_RELAY_STATUSES.has(response.status)
    || (pathname === '/api/movies/play' && response.status === 404);
  if (!retryable) return response;

  markRelayUnhealthy(env);
  if (!retryRequest) return response;
  try { await response.body?.cancel(); } catch (_error) {}
  return coreWorker.fetch(retryRequest, directEnv, executionContext);
}

async function coreJson(request, env, executionContext) {
  const response = await coreWorker.fetch(request, env, executionContext);
  let payload = {};
  try { payload = await response.clone().json(); } catch (_error) {}
  return { response, payload };
}

async function mergedDownloads(request, env, executionContext) {
  const { response, payload } = await coreJson(request, env, executionContext);
  let live;
  try {
    live = await fetchLiveDownloads(executionContext);
  } catch (_error) {
    return response;
  }

  const merged = {};
  for (const platform of ['android', 'android_tv', 'ios', 'windows']) {
    merged[platform] = live[platform]?.url ? live[platform] : payload?.[platform];
  }
  return jsonResponse(normalizeLegacyFields(merged));
}

async function mergedUpdateStatus(request, env, executionContext) {
  const { response, payload } = await coreJson(request, env, executionContext);
  if (!response.ok || payload?.forceUpdate) return response;

  let live;
  try {
    live = await fetchLiveDownloads(executionContext);
  } catch (_error) {
    return response;
  }

  const url = new URL(request.url);
  const platform = String(url.searchParams.get('platform') || '').trim();
  const currentVersion = String(url.searchParams.get('version') || request.headers.get('x-app-version') || '').trim();
  const release = live[platform];
  if (!release?.url) return response;

  const comparison = compareVersions(currentVersion, release.version);
  return jsonResponse({
    ...payload,
    latestVersion: release.version,
    isLatest: comparison >= 0,
    downloadSha256: release.sha256,
    downloadSizeBytes: release.sizeBytes,
    downloadSigner: release.signer,
    message: comparison >= 0
      ? 'Bạn đang dùng phiên bản mới nhất.'
      : `Có bản ${release.version}. Mở Tải ứng dụng để cập nhật.`,
  });
}

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/app/downloads') {
      return mergedDownloads(request, env, executionContext);
    }
    if (request.method === 'GET' && (url.pathname === '/api/app/check-update' || url.pathname === '/api/app/version')) {
      return mergedUpdateStatus(request, env, executionContext);
    }
    return resilientCoreFetch(request, env, executionContext);
  },
};
