const apiOrigin = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const key = String(process.env.PHIM4K_TEST_KEY || '');
const deviceId = String(process.env.PHIM4K_TEST_DEVICE || '');
const auditStart = Math.max(0, Number.parseInt(process.env.PHIM4K_AUDIT_START || '0', 10) || 0);
const auditLimit = Math.max(1, Number.parseInt(process.env.PHIM4K_AUDIT_LIMIT || '280', 10) || 280);
if (!key || !deviceId) throw new Error('Missing temporary live-test identity');

const headers = {
  'x-license-key': key,
  'x-device-id': deviceId,
  'x-app-version': 'catalog-image-audit',
};

async function getJson(path) {
  const response = await fetch(`${apiOrigin}${path}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const home = await getJson('/api/movies/home');
const allMovies = [
  ...(Array.isArray(home.hero) ? home.hero : []),
  ...(Array.isArray(home.sections) ? home.sections.flatMap((section) => section.items || []) : []),
];
const movies = [...new Map(allMovies.filter((movie) => movie?.slug).map((movie) => [movie.slug, movie])).values()];
// Match what the home UI actually requests: one preferred card poster per
// movie, plus the wide artwork used by each hero. This remains below the
// public per-minute request budget even as the catalogue grows.
const allChecks = [
  ...movies.map((movie) => ({
    slug: movie.slug,
    kind: 'card_artwork',
    url: String(movie.poster_url || movie.thumb_url || ''),
  })),
  ...(Array.isArray(home.hero) ? home.hero : []).map((movie) => ({
    slug: movie.slug,
    kind: 'hero_artwork',
    url: String(movie.thumb_url || movie.poster_url || ''),
  })),
];
const checks = allChecks.slice(auditStart, auditStart + auditLimit);

const failures = [];
let okImages = 0;
let cursor = 0;
async function worker() {
  while (cursor < checks.length) {
    const check = checks[cursor++];
    try {
      const url = new URL(check.url);
      if (url.origin !== apiOrigin || url.pathname !== '/api/media/image' || !url.searchParams.has('t')) {
        throw new Error(check.url ? 'unprotected-or-invalid-url' : 'missing-url');
      }
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || !type.startsWith('image/')) throw new Error(`HTTP-${response.status}-${type || 'unknown'}`);
      const reader = response.body?.getReader();
      if (reader) {
        const first = await reader.read();
        if (first.done || !first.value?.byteLength) throw new Error('empty-image');
        await reader.cancel();
      }
      okImages += 1;
    } catch (error) {
      failures.push({ slug: check.slug, kind: check.kind, error: String(error.message || error).slice(0, 100) });
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));

const pageCounts = [];
const inventory = new Set();
for (let page = 1; page <= 12; page += 1) {
  const data = await getJson(`/api/movies/category/phim-moi-cap-nhat?page=${page}`);
  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((movie) => movie?.slug && inventory.add(movie.slug));
  pageCounts.push(items.length);
  if (!items.length) break;
}

console.log(JSON.stringify({
  hero: home.hero?.length || 0,
  sections: (home.sections || []).map((section) => ({ id: section.id, count: section.items?.length || 0 })),
  uniqueHomeMovies: movies.length,
  allImageChecks: allChecks.length,
  imageCheckStart: auditStart,
  imageChecks: checks.length,
  okImages,
  failureCount: failures.length,
  failureGroups: Object.entries(failures.reduce((groups, failure) => {
    const key = `${failure.kind}:${failure.error}`;
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {})).map(([error, count]) => ({ error, count })),
  failureSamples: failures.slice(0, 20),
  latestPageCounts: pageCounts,
  uniqueLatestMovies: inventory.size,
}, null, 2));

if (failures.length) process.exitCode = 1;
