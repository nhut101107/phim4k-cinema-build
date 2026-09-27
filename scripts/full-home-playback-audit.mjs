import worker from '../backend-worker/src/worker.mjs';
import { readFileSync } from 'node:fs';

const concurrency = Math.max(1, Math.min(16, Number.parseInt(process.env.PHIM4K_AUDIT_CONCURRENCY || '8', 10) || 8));
const limit = Math.max(0, Number.parseInt(process.env.PHIM4K_AUDIT_LIMIT || '0', 10) || 0);
const deepEpisodes = process.env.PHIM4K_AUDIT_DEEP_EPISODES === '1';
const slugFile = String(process.env.PHIM4K_AUDIT_SLUGS_FILE || '').trim();
const origin = 'https://audit.phim4k.invalid';

// The audit exercises the production Worker code locally against the live
// providers. It deliberately uses a synthetic free viewer and never needs a
// production key, access token, media secret, or admin credential.
const statement = {
  bind() { return this; },
  async first() { return { setting_value: 'true' }; },
  async all() { return { results: [] }; },
  async run() { return { success: true }; },
};
const env = {
  ALLOW_LEGACY_TEST_AUTH: '1',
  DB: { prepare() { return Object.create(statement); } },
  MOVIE_CATALOG_ORIGIN: 'https://phimapi.com',
  MOVIE_OPHIM_ORIGIN: 'https://ophim1.com',
  MOVIE_BACKUP_CATALOG_ORIGIN: 'https://phim.nguonc.com',
  MOVIE_IMAGE_HOSTS: 'phimimg.com,img.ophim.live,phim.nguonc.com',
  MEDIA_TICKET_SECRET: 'local-audit-media-ticket-secret-at-least-32-characters',
};
const headers = { 'x-device-id': 'local-full-home-playback-audit', 'x-app-version': 'catalog-playback-audit' };

async function workerJson(path, init = {}) {
  const response = await worker.fetch(new Request(`${origin}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  }), env, { waitUntil() {} });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function sampleEpisodeIndexes(server) {
  const count = Array.isArray(server?.server_data) ? server.server_data.length : 0;
  if (!count) return [];
  // The most recently published episode is the one currently advertised in
  // the catalogue. CI can opt into both ends for a slower series-wide sample.
  return deepEpisodes && count > 1 ? [0, count - 1] : [count - 1];
}

const homeResult = await workerJson('/api/movies/home');
if (!homeResult.response.ok) throw new Error(`Home feed failed: HTTP ${homeResult.response.status}`);
const discovered = [...new Map([
  ...(homeResult.body.hero || []),
  ...(homeResult.body.sections || []).flatMap((section) => section.items || []),
].filter((movie) => movie?.slug).map((movie) => [movie.slug, movie])).values()];
const requestedSlugs = slugFile
  ? new Set(readFileSync(slugFile, 'utf8').split(/\r?\n/).map((value) => value.trim()).filter(Boolean))
  : null;
const selected = requestedSlugs ? discovered.filter((movie) => requestedSlugs.has(movie.slug)) : discovered;
const movies = limit ? selected.slice(0, limit) : selected;
const failures = [];
const playableSlugs = new Set();
const stats = { details: 0, moviesPlayable: 0, episodeSamples: 0, serverAttempts: 0 };
let cursor = 0;
let completed = 0;

async function auditMovie(movie) {
  const detailResult = await workerJson(`/api/movies/detail/${encodeURIComponent(movie.slug)}`);
  if (!detailResult.response.ok) {
    failures.push({ slug: movie.slug, name: movie.name, stage: 'detail', status: detailResult.response.status, code: detailResult.body.code || '' });
    return;
  }
  stats.details += 1;
  const servers = Array.isArray(detailResult.body.episodes) ? detailResult.body.episodes : [];
  const samples = [];
  const episodeKeys = new Set();
  const sampledServers = deepEpisodes ? servers : servers.filter((server) => server?.server_data?.length).slice(0, 1);
  for (const server of sampledServers) {
    for (const index of sampleEpisodeIndexes(server)) {
      const episode = server.server_data[index];
      const key = `${episode?.stream_ref?.episodeNumber ?? ''}|${episode?.slug || episode?.name || index}`;
      if (episode?.stream_ref && !episodeKeys.has(key)) {
        episodeKeys.add(key);
        samples.push(episode);
      }
    }
  }
  if (!samples.length) {
    failures.push({ slug: movie.slug, name: movie.name, stage: 'episodes', status: 0, code: 'NO_EPISODES' });
    return;
  }

  let moviePlayable = false;
  for (const episode of samples) {
    stats.episodeSamples += 1;
    // One playback request is enough: the production resolver itself checks
    // every equivalent server/source for this episode before returning 404.
    const candidates = [episode];
    let playable = false;
    let last = { status: 0, code: 'NO_WORKING_SERVER' };
    for (const candidate of candidates) {
      stats.serverAttempts += 1;
      const playResult = await workerJson('/api/movies/play', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(candidate.stream_ref),
      });
      if (playResult.response.ok && (playResult.body.streamUrl || playResult.body.nativeBootstrap?.url)) {
        playable = true;
        moviePlayable = true;
        break;
      }
      last = { status: playResult.response.status, code: playResult.body.code || 'PLAYBACK_FAILED' };
    }
    if (!playable) failures.push({
      slug: movie.slug,
      name: movie.name,
      stage: 'playback',
      episode: episode.name || episode.slug || '',
      ...last,
    });
  }
  if (moviePlayable) {
    stats.moviesPlayable += 1;
    playableSlugs.add(movie.slug);
  }
}

async function run() {
  while (cursor < movies.length) {
    const movie = movies[cursor++];
    try {
      await auditMovie(movie);
    } catch (error) {
      failures.push({ slug: movie.slug, name: movie.name, stage: 'exception', status: 0, code: String(error?.message || error).slice(0, 120) });
    }
    completed += 1;
    if (completed % 10 === 0 || completed === movies.length) process.stderr.write(`checked ${completed}/${movies.length}\n`);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => run()));
const failedMovies = new Set(failures.map((failure) => failure.slug));
const grouped = Object.entries(failures.reduce((result, failure) => {
  const key = `${failure.stage}:${failure.status}:${failure.code}`;
  result[key] = (result[key] || 0) + 1;
  return result;
}, {})).map(([error, count]) => ({ error, count }));

console.log(JSON.stringify({
  discoveredMovies: discovered.length,
  auditedMovies: movies.length,
  ...stats,
  failedMovies: failedMovies.size,
  failureCount: failures.length,
  failureGroups: grouped,
  unplayableMovies: movies.filter((movie) => !playableSlugs.has(movie.slug)).map((movie) => ({ slug: movie.slug, name: movie.name })),
  failures,
}, null, 2));

if (failures.length) process.exitCode = 1;
