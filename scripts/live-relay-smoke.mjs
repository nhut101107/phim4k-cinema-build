const apiOrigin = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const key = String(process.env.PHIM4K_TEST_KEY || '');
const deviceId = String(process.env.PHIM4K_TEST_DEVICE || '');
if (!key || !deviceId) throw new Error('Missing temporary live-test identity');

const viewerHeaders = {
  'x-license-key': key,
  'x-device-id': deviceId,
  'x-app-version': 'relay-smoke',
};

async function checkedJson(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    redirect: 'manual',
    ...options,
    headers: { ...viewerHeaders, ...(options.headers || {}) },
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`${path} returned HTTP ${response.status}`);
  return { response, data: await response.json() };
}

function firstMovie(feed) {
  for (const section of feed?.sections || []) {
    if (Array.isArray(section.items) && section.items[0]?.slug) return section.items[0];
  }
  throw new Error('Live feed has no movie');
}

function workerMediaUrls(manifest) {
  const urls = [];
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) urls.push(trimmed);
    for (const match of line.matchAll(/URI="([^"]+)"/g)) urls.push(match[1]);
  }
  for (const value of urls) {
    const parsed = new URL(value, apiOrigin);
    if (parsed.origin !== apiOrigin || parsed.pathname !== '/api/media/stream' || !parsed.searchParams.has('t')) {
      throw new Error('Manifest exposed a non-Worker media URL');
    }
  }
  return urls.map((value) => new URL(value, apiOrigin).href);
}

const home = await checkedJson('/api/movies/home');
const movie = firstMovie(home.data);
const detail = await checkedJson(`/api/movies/detail/${encodeURIComponent(movie.slug)}`);
const episode = detail.data?.episodes?.flatMap((server) => server.server_data || []).find((entry) => entry?.stream_ref);
if (!episode) throw new Error('Live movie has no protected stream reference');
const play = await checkedJson('/api/movies/play', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(episode.stream_ref),
});
const firstUrl = new URL(play.data.streamUrl);
if (firstUrl.origin !== apiOrigin || firstUrl.pathname !== '/api/media/stream' || !firstUrl.searchParams.has('t')) {
  throw new Error('Playback endpoint returned a non-Worker URL');
}

const hops = [];
let mediaUrl = firstUrl.href;
for (let index = 0; index < 4; index += 1) {
  const response = await fetch(mediaUrl, {
    redirect: 'manual',
    headers: index ? { range: 'bytes=0-2047' } : {},
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  hops.push({ status: response.status, kind: contentType.includes('mpegurl') ? 'hls' : contentType.split(';')[0] || 'unknown' });
  if (response.status >= 300 && response.status < 400) throw new Error('Media URL redirected outside the Worker');
  if (response.status !== 200 && response.status !== 206) throw new Error(`Media relay returned HTTP ${response.status}`);
  if (contentType.includes('mpegurl')) {
    const next = workerMediaUrls(await response.text())[0];
    if (!next) break;
    mediaUrl = next;
    continue;
  }
  const reader = response.body?.getReader();
  if (reader) {
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) throw new Error('Relayed media body is empty');
    await reader.cancel();
  }
  break;
}

console.log(JSON.stringify({
  home: home.response.status,
  detail: detail.response.status,
  play: play.response.status,
  redirected: false,
  relayHops: hops,
}));
