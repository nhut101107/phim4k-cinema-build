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

const PUBLIC_RELEASES = Object.freeze({
  android: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=1CMxjT0LyFnrwD2T8N2-ggbwuZJ0zvy0A&export=download&confirm=t',
    version: '3.55',
    sha256: 'c1cc73cb504ab90c7c7d8cbedf73f00c0484e13ab3d499b02d6aa37a4e1d44b4',
    sizeBytes: 3959616,
    signer: 'github-actions[bot]',
  }),
  android_tv: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=1C6ZxnWeEdEi3h1fTPYRnX8TRgHe1if8g&export=download&confirm=t',
    version: '3.55',
    sha256: 'db161b95b46b5728ad8a4cdf53b1a3f4bdb3ec14802fa65882ed3671336a1df0',
    sizeBytes: 3959616,
    signer: 'github-actions[bot]',
  }),
  ios: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=1Qv25YSevfJmhvBX3hYqbk5jGFH_VVVr_&export=download&confirm=t',
    version: '3.55',
    sha256: '43b3b432d14f1a404cb5a840518c38a27212870de2242724672ae5e7cae932b7',
    sizeBytes: 4411895,
    signer: 'github-actions[bot]',
  }),
  windows: Object.freeze({
    url: 'https://drive.usercontent.google.com/download?id=1uOmdX9AwTPVHFYQsTlQp0ifyvNmSYU4_&export=download&confirm=t',
    version: '3.55',
    sha256: '1b2721c02e442c4abb4c48da854b153df24876d85f3fae72920adb2ecdb49f31',
    sizeBytes: 120964411,
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
