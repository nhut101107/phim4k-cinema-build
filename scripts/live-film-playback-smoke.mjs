const apiOrigin = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const key = String(process.env.PHIM4K_TEST_KEY || '');
const deviceId = String(process.env.PHIM4K_TEST_DEVICE || '');
if (!key || !deviceId) throw new Error('Missing temporary live-test identity');

const viewerHeaders = {
  'x-license-key': key,
  'x-device-id': deviceId,
  'x-app-version': 'ios-hls-range-smoke',
};

async function checkedJson(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    redirect: 'manual',
    ...options,
    headers: { ...viewerHeaders, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, (letter) => (letter === 'Đ' ? 'D' : 'd'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function findObsession() {
  const candidates = [];
  for (const query of ['Âm Ảnh', 'Obsession', 'Am Anh']) {
    const result = await checkedJson(`/api/movies/search?q=${encodeURIComponent(query)}&page=1`);
    candidates.push(...(Array.isArray(result.items) ? result.items : []));
  }
  const exact = candidates.find((movie) => normalized(movie.origin_name) === 'obsession')
    || candidates.find((movie) => normalized(movie.name) === 'am anh');
  if (!exact?.slug) throw new Error('Could not find the requested movie in the live catalogue');
  return exact;
}

function protectedMediaUrls(manifest) {
  const values = [];
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) values.push(trimmed);
    for (const match of line.matchAll(/URI="([^"]+)"/g)) values.push(match[1]);
  }
  return values.map((value) => {
    const parsed = new URL(value, apiOrigin);
    if (parsed.origin !== apiOrigin || parsed.pathname !== '/api/media/stream' || !parsed.searchParams.has('t')) {
      throw new Error('Manifest exposed a non-Worker media URL');
    }
    return parsed.href;
  });
}

async function probeStream(streamUrl) {
  let current = streamUrl;
  const hops = [];
  for (let index = 0; index < 5; index += 1) {
    // AVPlayer performs this exact two-byte range probe against HLS manifests.
    const response = await fetch(current, { redirect: 'manual', headers: { range: 'bytes=0-1' } });
    if (response.status >= 300 && response.status < 400) throw new Error('Media relay redirected outside the Worker');
    if (response.status !== 200 && response.status !== 206) throw new Error(`Media relay returned HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const hls = contentType.includes('mpegurl');
    hops.push({ status: response.status, type: hls ? 'hls' : contentType.split(';')[0] || 'unknown' });
    if (!hls) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) throw new Error('Relayed media body is empty');
      return hops;
    }
    const manifest = await response.text();
    if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('HLS manifest was truncated by a range probe');
    const next = protectedMediaUrls(manifest)[0];
    if (!next) return hops;
    current = next;
  }
  throw new Error('HLS nesting exceeded the smoke-test limit');
}

const movie = await findObsession();
const detail = await checkedJson(`/api/movies/detail/${encodeURIComponent(movie.slug)}`);
const servers = Array.isArray(detail.episodes) ? detail.episodes : [];
if (!servers.length) throw new Error('Requested movie has no playback servers');

const results = [];
for (let serverIndex = 0; serverIndex < servers.length; serverIndex += 1) {
  const episode = servers[serverIndex]?.server_data?.find((entry) => entry?.stream_ref);
  if (!episode) continue;
  const play = await checkedJson('/api/movies/play', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(episode.stream_ref),
  });
  const stream = new URL(play.streamUrl);
  if (stream.origin !== apiOrigin || stream.pathname !== '/api/media/stream') {
    throw new Error('Playback endpoint returned a non-Worker URL');
  }
  results.push({
    server: String(servers[serverIndex]?.server_name || `server-${serverIndex + 1}`).slice(0, 80),
    hops: await probeStream(stream.href),
  });
}

if (!results.length) throw new Error('Requested movie has no testable protected stream');
console.log(JSON.stringify({ movie: movie.name, slug: movie.slug, servers: results }, null, 2));
