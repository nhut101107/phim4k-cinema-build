const apiOrigin = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const key = String(process.env.PHIM4K_TEST_KEY || '');
const deviceId = String(process.env.PHIM4K_TEST_DEVICE || '');
if (!key || !deviceId) throw new Error('Missing temporary live-test identity');

const viewerHeaders = {
  'x-license-key': key,
  'x-device-id': deviceId,
  'x-app-version': 'catalog-playback-audit',
};

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...options,
    headers: { ...viewerHeaders, ...(options.headers || {}) },
  });
  if (!response.ok) {
    let code = '';
    try { code = String((await response.json())?.code || ''); } catch (_error) {}
    throw new Error(`HTTP-${response.status}${code ? `-${code}` : ''}`);
  }
  return response.json();
}

function validateProtectedImage(value) {
  const url = new URL(String(value || ''));
  return url.origin === apiOrigin && url.pathname === '/api/media/image' && url.searchParams.has('t');
}

function validateProtectedManifest(text) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('INVALID_HLS');
  const references = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) references.push(trimmed);
    for (const match of line.matchAll(/URI="([^"]+)"/g)) references.push(match[1]);
  }
  for (const reference of references) {
    const url = new URL(reference, apiOrigin);
    if (url.origin !== apiOrigin || url.pathname !== '/api/media/stream' || !url.searchParams.has('t')) {
      throw new Error('UNPROTECTED_HLS_REFERENCE');
    }
  }
}

async function probeStream(streamUrl) {
  const url = new URL(String(streamUrl || ''));
  if (url.origin !== apiOrigin || url.pathname !== '/api/media/stream' || !url.searchParams.has('t')) {
    throw new Error('UNPROTECTED_STREAM_URL');
  }
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { range: 'bytes=0-1' },
    signal: AbortSignal.timeout(25000),
  });
  if (![200, 206].includes(response.status)) throw new Error(`STREAM-HTTP-${response.status}`);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('mpegurl')) {
    validateProtectedManifest(await response.text());
    return 'hls';
  }
  if (!/^(?:video|audio)\//.test(type) && !/^application\/(?:octet-stream|mp2t)/.test(type)) {
    throw new Error(`INVALID-STREAM-TYPE-${type || 'missing'}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY-STREAM');
  const first = await reader.read();
  if (first.done || !first.value?.byteLength) throw new Error('EMPTY-STREAM');
  await reader.cancel();
  return 'media';
}

const home = await requestJson('/api/movies/home');
const movies = [...new Map([
  ...(Array.isArray(home.hero) ? home.hero : []),
  ...(Array.isArray(home.sections) ? home.sections.flatMap((section) => section.items || []) : []),
].filter((movie) => movie?.slug).map((movie) => [movie.slug, movie])).values()];

const failures = [];
const stats = { detailOk: 0, imageRefsOk: 0, playable: 0, hls: 0, media: 0 };
let cursor = 0;
let completed = 0;

async function auditMovie(movie) {
  let detail;
  try {
    detail = await requestJson(`/api/movies/detail/${encodeURIComponent(movie.slug)}`);
    stats.detailOk += 1;
  } catch (error) {
    failures.push({ slug: movie.slug, stage: 'detail', error: String(error.message || error).slice(0, 120) });
    return;
  }

  try {
    const poster = detail?.movie?.poster_url || detail?.movie?.thumb_url;
    const thumb = detail?.movie?.thumb_url || detail?.movie?.poster_url;
    if (!validateProtectedImage(poster) || !validateProtectedImage(thumb)) throw new Error('INVALID_IMAGE_REFERENCE');
    stats.imageRefsOk += 1;
  } catch (error) {
    failures.push({ slug: movie.slug, stage: 'image-reference', error: String(error.message || error).slice(0, 120) });
  }

  const candidates = (Array.isArray(detail?.episodes) ? detail.episodes : [])
    .map((server) => (Array.isArray(server?.server_data) ? server.server_data.find((episode) => episode?.stream_ref) : null))
    .filter(Boolean);
  if (!candidates.length) {
    failures.push({ slug: movie.slug, stage: 'episodes', error: 'NO_PLAYABLE_EPISODE_REFERENCE' });
    return;
  }

  const errors = [];
  for (const episode of candidates.slice(0, 3)) {
    try {
      const play = await requestJson('/api/movies/play', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(episode.stream_ref),
      });
      const kind = await probeStream(play.streamUrl);
      stats.playable += 1;
      stats[kind] += 1;
      return;
    } catch (error) {
      errors.push(String(error.message || error).slice(0, 100));
    }
  }
  failures.push({ slug: movie.slug, stage: 'playback', error: [...new Set(errors)].join('|').slice(0, 180) || 'NO_WORKING_SERVER' });
}

async function auditWorker() {
  while (cursor < movies.length) {
    const movie = movies[cursor++];
    await auditMovie(movie);
    completed += 1;
    if (completed % 20 === 0 || completed === movies.length) process.stderr.write(`checked ${completed}/${movies.length}\n`);
  }
}

await Promise.all(Array.from({ length: 3 }, () => auditWorker()));

const failureGroups = Object.entries(failures.reduce((groups, failure) => {
  const group = `${failure.stage}:${failure.error}`;
  groups[group] = (groups[group] || 0) + 1;
  return groups;
}, {})).map(([error, count]) => ({ error, count }));

console.log(JSON.stringify({
  movies: movies.length,
  ...stats,
  failureCount: failures.length,
  failureGroups,
  failureSamples: failures.slice(0, 30),
}, null, 2));

if (failures.length) process.exitCode = 1;
