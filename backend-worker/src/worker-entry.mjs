import coreWorker from './worker.mjs';

const RELEASE_API = 'https://api.github.com/repos/nhut101107/phim4k-cinema-build/releases/latest';
const RELEASE_CACHE_KEY = 'https://phim4k-release-metadata.invalid/latest-v1';
const RELEASE_CACHE_SECONDS = 300;

const RELEASE_MATCHERS = Object.freeze({
  android_tv: (name) => /^4K-Cinema-Android-TV-[0-9.]+\.apk$/i.test(name),
  android: (name) => /^4K-Cinema-Android-[0-9.]+\.apk$/i.test(name),
  ios: (name) => /^4K-Cinema-iOS-[0-9.]+(?:-unsigned)?\.ipa$/i.test(name),
  windows: (name) => /^4K-Cinema-Windows-[0-9.]+-x64\.exe$/i.test(name),
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

function cleanDigest(value) {
  const match = String(value || '').trim().toLowerCase().match(/^sha256:([a-f0-9]{64})$/);
  return match ? match[1] : '';
}

function releaseVersion(release, assetName = '') {
  const values = [assetName, release?.tag_name, release?.name];
  for (const value of values) {
    const match = String(value || '').match(/(?:^|[^0-9])v?(\d+\.\d+(?:\.\d+)?)(?:[^0-9]|$)/i);
    if (match) return match[1];
  }
  return '';
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

function releasePayload(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const output = {};

  for (const [platform, matches] of Object.entries(RELEASE_MATCHERS)) {
    const asset = assets.find((candidate) => matches(String(candidate?.name || '')));
    if (!asset) continue;
    const sha256 = cleanDigest(asset.digest);
    const sizeBytes = Number(asset.size || 0);
    const url = String(asset.browser_download_url || '').trim();
    const version = releaseVersion(release, asset.name);
    if (!/^https:\/\/github\.com\//i.test(url) || !sha256 || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !version) continue;
    output[platform] = {
      url,
      version,
      sha256,
      sizeBytes,
      signer: String(asset?.uploader?.login || 'github-actions').slice(0, 200),
    };
  }

  return normalizeLegacyFields(output);
}

async function fetchLiveDownloads(executionContext) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheRequest = new Request(RELEASE_CACHE_KEY, { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheRequest);
    if (cached) return cached.json();
  }

  const response = await fetch(RELEASE_API, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': '4K-Cinema-Release-Sync/1.0',
      'x-github-api-version': '2022-11-28',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`GITHUB_RELEASE_HTTP_${response.status}`);

  const release = await response.json();
  const downloads = releasePayload(release);
  const populated = ['android', 'android_tv', 'ios', 'windows'].filter((key) => downloads[key]?.url).length;
  if (!populated) throw new Error('GITHUB_RELEASE_HAS_NO_VALID_ASSETS');

  if (cache) {
    const cachedResponse = jsonResponse(downloads, 200, `public, max-age=${RELEASE_CACHE_SECONDS}`);
    executionContext?.waitUntil?.(cache.put(cacheRequest, cachedResponse));
  }
  return downloads;
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
    return coreWorker.fetch(request, env, executionContext);
  },
};
