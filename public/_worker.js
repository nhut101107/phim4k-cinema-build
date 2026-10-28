// Cloudflare Pages Worker for phim4vipzz
// Integrates EnsMovie player/sources, Repo License Worker, Movie API sources, Anti-DDoS & Admin Authority.

const LICENSE_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const ENS_ORIGIN = 'https://enshihi.vercel.app';
const PHIMAPI_ORIGIN = 'https://phimapi.com';
const OPHIM_ORIGIN = 'https://ophim1.com';
const PHIMIMG_ORIGIN = 'https://phimimg.com';

// In-memory runtime state for Cloudflare Pages instance (Runs 100% serverless on edge - No VPS or PC needed)
const RUNTIME_STATE = {
  freeAccess: true, // Default to true: Public access for everyone to watch freely!
  maintenance: { active: false, message: 'Hệ thống đang được nâng cấp. Vui lòng quay lại sau.', expiresAt: null },
  keys: [
    {
      license_key: 'VIP-4K-CINEMA-2026',
      key: 'VIP-4K-CINEMA-2026',
      plan: 'VIP TRỌN ĐỜI 4K',
      tier: 'vip',
      isAdmin: false,
      active: true,
      assigned_telegram_id: '',
      telegramId: '',
      boundTelegramId: '',
      max_devices: 99,
      maxDevices: 99,
      device_count: 0,
      deviceCount: 0,
      devices: [],
      expires_at: null,
      expiresAt: null,
      created_at: new Date().toISOString()
    }
  ],
  users: [],
  deviceRequests: [],
  reportedIssues: [],
  logs: [
    { action: 'SYSTEM_BOOT', actor: 'SYSTEM', target: 'phim4vipzz', ip: '127.0.0.1', created_at: new Date().toISOString(), detail: 'Cloudflare Pages serverless edge online. Chế độ truy cập trực tiếp đang kích hoạt.' },
    { action: 'SYSTEM_READY', actor: 'SYSTEM', target: 'admin-auth', ip: '127.0.0.1', created_at: new Date().toISOString(), detail: 'Server-authoritative administrator authentication enabled.' }
  ],
  stats: {
    ddosBlockedCount: 0
  }
};

// Anti-DDoS In-Worker Rate Limiting Tracker
const IP_RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds sliding window

function rateLimitRule(path) {
  if (path.startsWith('/api/admin/')) return { bucket: 'admin', limit: 35 };
  if (path.startsWith('/api/auth/')) return { bucket: 'auth', limit: 30 };
  if (path === '/api/movies/home') return { bucket: 'movie-home', limit: 20 };
  if (path.startsWith('/api/movies/search') || path.startsWith('/api/movies/filter')) return { bucket: 'movie-query', limit: 45 };
  if (path.startsWith('/api/movies/')) return { bucket: 'movies', limit: 70 };
  return { bucket: 'api', limit: 120 };
}

function checkRateLimit(ip, path) {
  if (!path.startsWith('/api/') || path === '/api/media/image') return { allowed: true, limit: 0, retryAfter: 0 }; // Static assets / images are served by the CDN.
  const now = Date.now();
  const rule = rateLimitRule(path);
  const key = `${ip}:${rule.bucket}`;
  let record = IP_RATE_LIMIT.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    IP_RATE_LIMIT.set(key, record);
    if (IP_RATE_LIMIT.size > 5000) {
      const oldestKey = IP_RATE_LIMIT.keys().next().value;
      IP_RATE_LIMIT.delete(oldestKey);
    }
    return { allowed: true, limit: rule.limit, retryAfter: 0 };
  }
  record.count++;
  const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  return { allowed: record.count <= rule.limit, limit: rule.limit, retryAfter };
}

function invalidRequestReason(request, url) {
  if (url.href.length > 2048 || [...url.searchParams].length > 20) return { status: 414, error: 'Yêu cầu quá dài.' };
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1024 * 1024) return { status: 413, error: 'Dữ liệu gửi lên vượt giới hạn.' };
  if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method)) return { status: 405, error: 'Phương thức không được hỗ trợ.' };
  return null;
}

// Generates valid session tokens matching regex: /^p4a_[A-Za-z0-9_-]{43}$/
function generateSecureToken(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let rand = '';
  const bytes = new Uint8Array(43);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 43; i++) {
    rand += chars[bytes[i] % chars.length];
  }
  return prefix + rand;
}

function cloneUpstreamRequest(request, target, extraHeaders = {}) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  return new Request(target, init);
}

async function proxyTo(request, origin, extraHeaders = {}) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const upstream = await fetch(cloneUpstreamRequest(request, target, extraHeaders));
  const headers = new Headers(upstream.headers);
  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  headers.set('cache-control', upstream.headers.get('cache-control') || 'no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

const ALLOWED_IMAGE_HOSTS = new Set(['phimimg.com', 'img.ophim.live', 'phimapi.com', 'ophim1.com']);

function encodeImageTicket(imageUrl, origin = 'https://phim4vipzz.pages.dev') {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.pathname === '/api/media/image' && parsed.searchParams.get('t')) return parsed.href;
    const bytes = new TextEncoder().encode(parsed.href);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${origin}/api/media/image?t=${token}`;
  } catch (_error) {
    return '';
  }
}

function decodeImageTicket(token) {
  const raw = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{24,512}$/.test(raw)) return null;
  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const target = new URL(decoded);
    if (target.protocol !== 'https:' || target.username || target.password) return null;
    const host = target.hostname.toLowerCase();
    const allowed = [...ALLOWED_IMAGE_HOSTS].some((domain) => host === domain || host.endsWith(`.${domain}`));
    return allowed ? target : null;
  } catch (_error) {
    return null;
  }
}

async function handleMovieImage(request, url, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  const token = url.searchParams.get('t') || '';
  const target = decodeImageTicket(token);
  if (!target) return null;
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`${url.origin}/api/media/image?t=${encodeURIComponent(token)}`, { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  try {
    const upstream = await fetch(target.href, {
      headers: { accept: request.headers.get('accept') || 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (!upstream.ok) return null;
    const response = new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'image/jpeg',
        'cache-control': 'public, max-age=86400, immutable',
        'access-control-allow-origin': '*',
      },
    });
    if (cache && request.method === 'GET') ctx?.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (_error) {
    return null;
  }
}

function absoluteMovieImage(value, base = PHIMIMG_ORIGIN) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'null' || raw === 'undefined') return '';
  try {
    const url = new URL(raw.replace(/^\/+/, ''), `${String(base || PHIMIMG_ORIGIN).replace(/\/$/, '')}/`);
    return url.protocol === 'https:' ? url.href : '';
  } catch (_error) {
    return '';
  }
}

function movieItems(payload) {
  return Array.isArray(payload?.items)
    ? payload.items
    : (Array.isArray(payload?.data?.items) ? payload.data.items : []);
}

function normalizeMovie(item, payload = null, cleanOrigin = 'https://phim4vipzz.pages.dev') {
  if (!item || typeof item !== 'object' || !String(item.slug || '').trim()) return null;
  const imageBase = payload?.data?.APP_DOMAIN_CDN_IMAGE || payload?.APP_DOMAIN_CDN_IMAGE || PHIMIMG_ORIGIN;
  const rawPoster = absoluteMovieImage(item.poster_url, imageBase);
  const rawThumb = absoluteMovieImage(item.thumb_url, imageBase);
  const poster = encodeImageTicket(rawPoster || rawThumb, cleanOrigin);
  const thumb = encodeImageTicket(rawThumb || rawPoster, cleanOrigin);
  return {
    ...item,
    poster_url: poster || thumb,
    thumb_url: thumb || poster,
  };
}

function normalizedMovieItems(payload, cleanOrigin = 'https://phim4vipzz.pages.dev') {
  return movieItems(payload)
    .map((item) => normalizeMovie(item, payload, cleanOrigin))
    .filter((movie) => movie && (movie.poster_url || movie.thumb_url));
}

// Home payload carries ~1,300 titles, so only the fields the cards, filters
// and ranking actually read are kept (provider ids, alt names, etc. dropped).
function compactHomeMovie(movie) {
  const tags = (value) => (Array.isArray(value) ? value : [])
    .map((tag) => (tag && typeof tag === 'object' ? { name: tag.name, slug: tag.slug } : tag))
    .filter(Boolean);
  const out = {
    name: movie.name,
    slug: movie.slug,
    origin_name: movie.origin_name,
    type: movie.type,
    poster_url: movie.poster_url,
    thumb_url: movie.thumb_url,
    year: movie.year,
    quality: movie.quality,
    lang: movie.lang,
    episode_current: movie.episode_current,
    time: movie.time,
    chieurap: movie.chieurap,
    sub_docquyen: movie.sub_docquyen,
    modified: movie.modified,
    category: tags(movie.category),
    country: tags(movie.country),
  };
  for (const key of ['tmdb', 'imdb']) {
    const ref = movie[key];
    if (ref && (Number(ref.vote_count) > 0 || ref.id)) {
      out[key] = { id: ref.id, type: ref.type, season: ref.season, vote_average: ref.vote_average, vote_count: ref.vote_count };
    }
  }
  return out;
}

function movieIdentity(item) {
  const tmdbId = String(item?.tmdb?.id || '').trim();
  if (tmdbId) {
    return `tmdb:${String(item?.tmdb?.type || item?.type || '').toLowerCase()}:${tmdbId}:${String(item?.tmdb?.season || '')}`;
  }
  const title = String(item?.origin_name || item?.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return title ? `title:${title}:${String(item?.year || '')}` : `slug:${String(item?.slug || '').trim()}`;
}

function uniqueMovies(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const identity = movieIdentity(item);
    if (!String(item?.slug || '').trim() || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function movieModifiedTime(movie) {
  const value = movie?.modified?.time || movie?.updated_at || movie?.updatedAt || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestFirst(items) {
  return uniqueMovies(items).sort((left, right) => movieModifiedTime(right) - movieModifiedTime(left));
}

function hotNewMovies(items, limit = 12) {
  const currentYear = new Date().getUTCFullYear();
  const now = Date.now();
  const score = (movie) => {
    const year = Number(movie?.year) || 0;
    const modified = movieModifiedTime(movie);
    const ageDays = modified ? Math.max(0, (now - modified) / 86400000) : 365;
    const voteAverage = Number(movie?.tmdb?.vote_average) || 0;
    const voteCount = Number(movie?.tmdb?.vote_count) || 0;
    const quality = String(movie?.quality || '').toLowerCase();
    return (year >= currentYear ? 1400 : year === currentYear - 1 ? 650 : 0)
      + Math.max(0, 360 - ageDays)
      + (movie?.chieurap ? 220 : 0)
      + (quality.includes('4k') || quality.includes('fhd') ? 90 : 0)
      + voteAverage * 18
      + Math.min(180, Math.log10(voteCount + 1) * 55);
  };
  return uniqueMovies(items)
    .filter((movie) => movie.poster_url || movie.thumb_url)
    .sort((left, right) => score(right) - score(left))
    .slice(0, limit);
}

async function fetchMovieJson(path, origin = PHIMAPI_ORIGIN) {
  try {
    const response = await fetch(`${origin}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cf: { cacheEverything: true, cacheTtl: 20 },
    });
    if (!response.ok || !String(response.headers.get('content-type') || '').includes('application/json')) return null;
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function catalogPagination(payload, page, itemCount) {
  return payload?.pagination || payload?.data?.params?.pagination || {
    currentPage: Number(page) || 1,
    totalPages: itemCount ? 1 : 0,
    totalItems: itemCount,
  };
}

function hlsCleanId(sourceUrl) {
  const text = String(sourceUrl || '');
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `c_${h1.toString(36)}_${h2.toString(36)}_${text.length.toString(36)}`;
}

function adFreeEpisodeEmbed(episode, cleanOrigin) {
  if (!episode || typeof episode !== 'object' || !cleanOrigin) return episode;
  try {
    const embedRaw = String(episode.link_embed || '').trim();
    const m3u8Raw = String(episode.link_m3u8 || '').trim();
    const embed = embedRaw ? new URL(embedRaw.replace(/^http:\/\//i, 'https://')) : null;
    if (embed && embed.hostname === 'player.phimapi.com' && /^\/player(?:debug)?(?:\/|$)/.test(embed.pathname)) {
      let source = new URL(embed.searchParams.get('url') || m3u8Raw || '');
      if (source.pathname === HLS_CLEAN_PATH && source.searchParams.get('src')) {
        source = new URL(source.searchParams.get('src') || '');
      }
      if (/^https?:$/.test(source.protocol) && /\.m3u8$/i.test(source.pathname)) {
        source.protocol = 'https:';
        const id = hlsCleanId(source.href);
        embed.pathname = '/playerdebug/';
        embed.searchParams.set('url', `${cleanOrigin}${HLS_CLEAN_PATH}?id=${encodeURIComponent(id)}&src=${encodeURIComponent(source.href)}&_=/%`);
        return { ...episode, link_embed: embed.href };
      }
    }
  } catch (_error) {}
  return episode;
}

function adFreeDetailPayload(payload, cleanOrigin) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.episodes)) return payload;
  return {
    ...payload,
    episodes: payload.episodes.map((server) => (server && Array.isArray(server.server_data)
      ? { ...server, server_data: server.server_data.map((ep) => adFreeEpisodeEmbed(ep, cleanOrigin)) }
      : server)),
  };
}

// Public web catalogue fallback. It keeps browsing available when the licensed
// API requires a native session, and normalizes every relative poster path
// before it reaches the browser.
async function fetchDirectMovieCatalog(endpoint, searchParams, cleanOrigin = 'https://phim4vipzz.pages.dev') {
  const page = searchParams.get('page') || '1';
  try {
    if (endpoint === '/api/movies/home') {
      // 64 titles per request (provider maximum), newest-updated first, so
      // every refresh carries ~1,300 distinct titles while staying well under
      // the Worker subrequest budget (6 + 5 x 3 = 21 upstream calls).
      const latestPageCount = 12;
      const categoryPageCount = 4;
      const freshSort = 'limit=64&sort_field=modified.time&sort_type=desc';
      const phimApiRequests = [
        ...Array.from({ length: latestPageCount }, (_, index) => `/v1/api/danh-sach/phim-moi-cap-nhat?page=${index + 1}&${freshSort}`),
        ...['phim-chieu-rap', 'phim-le', 'phim-bo', 'hoat-hinh', 'tv-shows']
          .flatMap((category) => Array.from({ length: categoryPageCount }, (_, index) => `/v1/api/danh-sach/${category}?page=${index + 1}&${freshSort}`)),
      ];
      const phimApiPayloads = await Promise.all(phimApiRequests.map((path) => fetchMovieJson(path)));
      const groups = phimApiPayloads.map((payload) => normalizedMovieItems(payload, cleanOrigin));
      const latestItems = latestFirst(groups.slice(0, latestPageCount).flat());
      const categoryGroups = ['cinema', 'movies', 'series', 'anime', 'tv'].map((id, index) => ({
        id,
        items: latestFirst(groups.slice(
          latestPageCount + index * categoryPageCount,
          latestPageCount + (index + 1) * categoryPageCount,
        ).flat()),
      }));
      const allItems = uniqueMovies([...latestItems, ...categoryGroups.flatMap((group) => group.items)]);
      const premiumItems = latestFirst(allItems.filter((movie) => /(?:4k|uhd|fhd|1080)/i.test(String(movie?.quality || ''))));
      if (!allItems.length) return null;

      const hero = hotNewMovies([
        ...latestItems,
        ...categoryGroups[0].items,
        ...categoryGroups[1].items,
        ...categoryGroups[2].items,
      ], 12).map((movie) => ({
        ...movie,
        quality: movie.quality || 'Theo nguồn',
        episode_current: movie.episode_current || 'Mới cập nhật',
      }));

      return Response.json({
        hero: hero.map(compactHomeMovie),
        updatedAt: new Date().toISOString(),
        sections: [
          { id: 'latest', title: '🔥 Phim Mới & Hot Cập Nhật Liên Tục', items: latestItems.slice(0, 480) },
          { id: 'premium-quality', title: '💎 Kho FHD & 4K Chất Lượng Cao', items: premiumItems.slice(0, 320) },
          { id: 'cinema', title: '🎬 Phim Chiếu Rạp', items: categoryGroups[0].items.slice(0, 180) },
          { id: 'movies', title: '🍿 Phim Lẻ Mới', items: categoryGroups[1].items.slice(0, 256) },
          { id: 'series', title: '📺 Phim Bộ Nổi Bật', items: categoryGroups[2].items.slice(0, 256) },
          { id: 'anime', title: '✨ Hoạt Hình & Anime Hot', items: categoryGroups[3].items.slice(0, 220) },
          { id: 'tv', title: '🌟 TV Shows', items: categoryGroups[4].items.slice(0, 160) },
        ].filter((section) => section.items.length)
          .map((section) => ({ ...section, items: section.items.map(compactHomeMovie) })),
        pagination: { currentPage: 1, totalPages: 1, totalItems: allItems.length },
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=20, stale-while-revalidate=60' } });
    }

    if (endpoint.startsWith('/api/movies/detail/')) {
      const slug = endpoint.split('/api/movies/detail/')[1];
      for (const target of [`${PHIMAPI_ORIGIN}/phim/${encodeURIComponent(slug)}`]) {
        const res = await fetch(target, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          const normalized = data?.movie ? { ...data, movie: normalizeMovie(data.movie, data, cleanOrigin) || data.movie } : data;
          return Response.json(adFreeDetailPayload(normalized, cleanOrigin), {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' }
          });
        }
      }
    }

    if (endpoint === '/api/movies/search') {
      const q = searchParams.get('q') || '';
      const data = await fetchMovieJson(`/v1/api/tim-kiem?keyword=${encodeURIComponent(q)}&page=${page}&limit=64`);
      if (data) {
        const items = uniqueMovies(normalizedMovieItems(data, cleanOrigin));
        return Response.json({
          query: q,
          items,
          pagination: catalogPagination(data, page, items.length),
        }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
      }
    }

    if (endpoint === '/api/movies/catalog') {
      const data = await fetchMovieJson(`/v1/api/danh-sach/phim-moi-cap-nhat?page=${page}&limit=64&sort_field=modified.time&sort_type=desc`);
      if (data) {
        const items = uniqueMovies(normalizedMovieItems(data, cleanOrigin));
        return Response.json({
          title: 'Toàn bộ kho phim',
          items,
          pagination: catalogPagination(data, page, items.length),
        }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
      }
    }

    if (endpoint === '/api/movies/filter') {
      const genre = String(searchParams.get('genre') || '').trim().toLowerCase();
      const country = String(searchParams.get('country') || '').trim().toLowerCase();
      if (!genre && !country) return null;
      let target = genre === 'hoat-hinh'
        ? `/v1/api/danh-sach/hoat-hinh?page=${page}&limit=64&sort_field=modified.time&sort_type=desc`
        : genre
          ? `/v1/api/the-loai/${encodeURIComponent(genre)}?page=${page}&limit=64&sort_field=modified.time&sort_type=desc`
          : `/v1/api/quoc-gia/${encodeURIComponent(country)}?page=${page}&limit=64&sort_field=modified.time&sort_type=desc`;
      if (genre && country) target += `&country=${encodeURIComponent(country)}`;
      const data = await fetchMovieJson(target);
      if (data) {
        const items = normalizedMovieItems(data, cleanOrigin);
        return Response.json({
          filters: { genre, country },
          items,
          pagination: catalogPagination(data, page, items.length),
        }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
      }
    }

    if (endpoint.startsWith('/api/movies/category/')) {
      const cat = endpoint.split('/api/movies/category/')[1];
      const data = await fetchMovieJson(`/v1/api/danh-sach/${encodeURIComponent(cat)}?page=${page}&limit=64&sort_field=modified.time&sort_type=desc`);
      if (data) {
        const items = uniqueMovies(normalizedMovieItems(data, cleanOrigin));
        return Response.json({
          category: cat,
          items,
          pagination: catalogPagination(data, page, items.length),
        }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
      }
    }
  } catch (err) {
    console.error('Direct movie catalog error:', err);
  }
  return null;
}

function publicMovieCacheRequest(url) {
  const cacheUrl = new URL(url.origin + url.pathname);
  for (const key of ['page', 'q', 'genre', 'country']) {
    const value = url.searchParams.get(key);
    if (value) cacheUrl.searchParams.set(key, value.slice(0, 120));
  }
  return new Request(cacheUrl.href, { method: 'GET' });
}

// ---------------------------------------------------------------------------
// HLS ad stripping (auto "tua quảng cáo").
// Provider playlists (kkphim/phimapi CDNs) splice betting-ad clips between
// #EXT-X-DISCONTINUITY tags. Those clips live in a different directory and use
// a different file-name shape than the real movie segments. The ENSMovie
// iframe player (player.phimapi.com) is pointed at this cleaned playlist, so
// the ads are removed before playback starts and nothing has to be skipped by
// hand. Only playlists pass through here; video segments stay on the CDN.
// HLS_AD_FILTER_START
const HLS_CLEAN_PATH = '/hls/clean.m3u8';
const HLS_MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const HLS_MAX_AD_GROUP_SECONDS = 180;
const HLS_MAX_AD_SHARE = 0.25;

function hlsAbsolute(uri, base) {
  try { return new URL(String(uri || '').trim(), base).href; } catch (_error) { return ''; }
}

function hlsSegmentSignature(absoluteUrl) {
  try {
    const parsed = new URL(absoluteUrl);
    const slash = parsed.pathname.lastIndexOf('/');
    const directory = parsed.pathname.slice(0, slash + 1);
    const file = parsed.pathname.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot).toLowerCase() : '';
    return `${parsed.host}${directory}|${stem.replace(/[A-Za-z0-9]/g, 'x')}${ext}`;
  } catch (_error) {
    return 'invalid';
  }
}

function hlsRewriteUriAttribute(line, base, cleanUrlFor = null) {
  return line.replace(/URI\s*=\s*["']([^"']*)["']/i, (_match, uri) => {
    const abs = hlsAbsolute(uri, base) || uri;
    return `URI="${cleanUrlFor ? cleanUrlFor(abs) : abs}"`;
  });
}

// Returns { playlist, removedSegments, removedSeconds, isMaster, variants }.
function stripHlsAds(text, baseUrl, { cleanUrlFor = null } = {}) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!lines[0] || !lines[0].trim().startsWith('#EXTM3U')) throw new Error('NOT_HLS_PLAYLIST');

  // Master playlist: route every variant and media rendition through the cleaner as well.
  if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'))) {
    const out = [];
    const variants = [];
    let expectVariant = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          expectVariant = true;
          out.push(line);
        } else if (line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
          out.push(hlsRewriteUriAttribute(line, baseUrl, cleanUrlFor));
        } else {
          out.push(line);
        }
        continue;
      }
      const absolute = hlsAbsolute(line, baseUrl) || line;
      if (expectVariant) variants.push(absolute);
      out.push(expectVariant && cleanUrlFor ? cleanUrlFor(absolute) : absolute);
      expectVariant = false;
    }
    return { playlist: `${out.join('\n')}\n`, removedSegments: 0, removedSeconds: 0, isMaster: true, variants };
  }

  // Media playlist: parse into header + segments with their context.
  const header = [];
  const segments = [];
  const trailer = [];
  let pending = [];
  let currentKey = null;
  let currentMap = null;
  let group = 0;
  let discontinuityBefore = false;
  let seenSegment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-ENDLIST')) { trailer.push(line); continue; }
    if (line.startsWith('#EXT-X-DISCONTINUITY') && !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')) {
      if (seenSegment) group += 1;
      discontinuityBefore = true;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY')) { currentKey = hlsRewriteUriAttribute(line, baseUrl); continue; }
    if (line.startsWith('#EXT-X-MAP')) { currentMap = hlsRewriteUriAttribute(line, baseUrl); continue; }
    if (line.startsWith('#')) {
      if (!seenSegment && !line.startsWith('#EXTINF') && !line.startsWith('#EXT-X-BYTERANGE')
        && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) header.push(line);
      else pending.push(line);
      continue;
    }
    const extinf = pending.find((tag) => tag.startsWith('#EXTINF'));
    const duration = Math.max(0, Number.parseFloat(String(extinf || '').slice(8)) || 0);
    const url = hlsAbsolute(line, baseUrl) || line;
    segments.push({ tags: pending, url, duration, key: currentKey, map: currentMap, group, discontinuityBefore,
      signature: hlsSegmentSignature(url) });
    pending = [];
    discontinuityBefore = false;
    seenSegment = true;
  }

  // The movie itself is the signature carrying the most playback time.
  const bySignature = new Map();
  let totalSeconds = 0;
  for (const segment of segments) {
    totalSeconds += segment.duration;
    bySignature.set(segment.signature, (bySignature.get(segment.signature) || 0) + segment.duration);
  }
  const dominant = [...bySignature.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const groups = new Map();
  for (const segment of segments) {
    const entry = groups.get(segment.group) || { seconds: 0, foreign: true };
    entry.seconds += segment.duration;
    if (segment.signature === dominant) entry.foreign = false;
    groups.set(segment.group, entry);
  }
  const multipleGroups = groups.size > 1;
  const adGroups = new Set();
  let adSeconds = 0;
  for (const [id, entry] of groups) {
    if (multipleGroups && entry.foreign && entry.seconds <= HLS_MAX_AD_GROUP_SECONDS) {
      adGroups.add(id);
      adSeconds += entry.seconds;
    }
  }
  // Safety valve: never delete a large share of a title; that is not an ad.
  if (!totalSeconds || adSeconds > totalSeconds * HLS_MAX_AD_SHARE) adGroups.clear();

  const out = [...header];
  let emittedKey = null;
  let emittedMap = null;
  let pendingDiscontinuity = false;
  let removedSegments = 0;
  let removedSeconds = 0;
  let emittedAny = false;
  let lastKeptSignature = '';
  let removedSinceKept = false;
  for (const segment of segments) {
    if (segment.discontinuityBefore) pendingDiscontinuity = true;
    if (adGroups.has(segment.group)) {
      removedSegments += 1;
      removedSeconds += segment.duration;
      removedSinceKept = true;
      continue;
    }
    // The movie's own timestamps run straight through a spliced-in ad, so the
    // discontinuity that only existed around the removed clip is dropped too.
    const spliceOnly = removedSinceKept && segment.signature === lastKeptSignature;
    if (pendingDiscontinuity && emittedAny && !spliceOnly) out.push('#EXT-X-DISCONTINUITY');
    pendingDiscontinuity = false;
    removedSinceKept = false;
    lastKeptSignature = segment.signature;
    if (segment.key !== emittedKey) {
      out.push(segment.key || '#EXT-X-KEY:METHOD=NONE');
      emittedKey = segment.key;
    }
    if (segment.map && segment.map !== emittedMap) {
      out.push(segment.map);
      emittedMap = segment.map;
    }
    out.push(...segment.tags, segment.url);
    emittedAny = true;
  }
  out.push(...trailer);
  return { playlist: `${out.join('\n')}\n`, removedSegments, removedSeconds, isMaster: false };
}
// HLS_AD_FILTER_END

function hlsCorsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': 'range, content-type',
    'access-control-expose-headers': 'x-ads-removed, x-ads-removed-seconds',
    ...extra,
  };
}

const CLEAN_HLS_STORE = new Map();

async function handleCleanHls(request, url, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: hlsCorsHeaders() });
  const cache = globalThis.caches?.default;
  const rawId = String(url.searchParams.get('id') || '').trim();
  const validId = /^[A-Za-z0-9_-]{4,80}$/.test(rawId) ? rawId : '';
  const idCacheKey = validId ? new Request(`${url.origin}${HLS_CLEAN_PATH}?id=${encodeURIComponent(validId)}`, { method: 'GET' }) : null;

  if (request.method === 'POST') {
    if (!validId) return new Response('Invalid playlist id', { status: 400, headers: hlsCorsHeaders({ 'cache-control': 'no-store' }) });
    const body = await request.text();
    if (!body || body.length > HLS_MAX_PLAYLIST_BYTES || !body.trimStart().startsWith('#EXTM3U')) {
      return new Response('Invalid playlist body', { status: 400, headers: hlsCorsHeaders({ 'cache-control': 'no-store' }) });
    }
    CLEAN_HLS_STORE.set(validId, body);
    if (CLEAN_HLS_STORE.size > 200) {
      CLEAN_HLS_STORE.delete(CLEAN_HLS_STORE.keys().next().value);
    }
    if (cache && idCacheKey) {
      await cache.put(idCacheKey, new Response(body, {
        status: 200,
        headers: hlsCorsHeaders({
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'public, max-age=1800',
        }),
      }));
    }
    return Response.json({ ok: true, id: validId }, { status: 200, headers: hlsCorsHeaders({ 'cache-control': 'no-store' }) });
  }

  let source = null;
  try {
    source = new URL(url.searchParams.get('src') || '');
  } catch (_error) {}

  if (validId) {
    const maxPolls = source ? 28 : 1;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const mem = CLEAN_HLS_STORE.get(validId);
      if (mem) {
        return new Response(request.method === 'HEAD' ? null : mem, {
          status: 200,
          headers: hlsCorsHeaders({
            'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'cache-control': 'public, max-age=1800',
          }),
        });
      }
      if (cache && idCacheKey) {
        const cachedById = await cache.match(idCacheKey);
        if (cachedById) return cachedById;
      }
      if (attempt + 1 < maxPolls) await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  if (!source || source.protocol !== 'https:' || source.username || source.password
    || !/\.m3u8$/i.test(source.pathname) || source.href.length > 1500) {
    return new Response('Invalid playlist source', { status: 400, headers: hlsCorsHeaders({ 'cache-control': 'no-store' }) });
  }
  const fallback = () => new Response(null, {
    status: 302,
    headers: hlsCorsHeaders({ location: source.href, 'cache-control': 'no-store' }),
  });

  const cacheKey = new Request(`${url.origin}${HLS_CLEAN_PATH}?src=${encodeURIComponent(source.href)}`, { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  try {
    const upstream = await fetch(source.href, {
      headers: {
        accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, */*',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        referer: 'https://player.phimapi.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });
    if (!upstream.ok) return fallback();
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > HLS_MAX_PLAYLIST_BYTES) return fallback();
    const text = await upstream.text();
    if (text.length > HLS_MAX_PLAYLIST_BYTES) return fallback();
    const base = upstream.url || source.href;
    const result = stripHlsAds(text, base, {
      cleanUrlFor: (variant) => `${url.origin}${HLS_CLEAN_PATH}?src=${encodeURIComponent(variant)}&_=/%`,
    });
    const response = new Response(request.method === 'HEAD' ? null : result.playlist, {
      status: 200,
      headers: hlsCorsHeaders({
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'cache-control': 'public, max-age=600',
        'x-ads-removed': String(result.removedSegments),
        'x-ads-removed-seconds': result.removedSeconds.toFixed(2),
      }),
    });
    if (cache && request.method === 'GET') ctx?.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (_error) {
    return fallback();
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

    // Ad-free playlist relay used by the ENSMovie iframe (auto ad skip).
    if (url.pathname === HLS_CLEAN_PATH) {
      return handleCleanHls(request, url, ctx);
    }

    // Poster image relay for opaque /api/media/image?t= tickets.
    if (url.pathname === '/api/media/image') {
      const imageResponse = await handleMovieImage(request, url, ctx);
      if (imageResponse) return imageResponse;
    }

    // 1. Anti-DDoS Rate Limiting Guard
    const invalid = url.pathname.startsWith('/api/') ? invalidRequestReason(request, url) : null;
    if (invalid) {
      return Response.json({ success: false, error: invalid.error }, {
        status: invalid.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    const rateLimit = checkRateLimit(clientIp, url.pathname);
    if (!rateLimit.allowed) {
      RUNTIME_STATE.stats.ddosBlockedCount++;
      if (RUNTIME_STATE.stats.ddosBlockedCount % 50 === 1) {
        RUNTIME_STATE.logs.unshift({
          action: 'DDOS_BLOCKED',
          actor: 'SHIELD',
          target: clientIp,
          ip: clientIp,
          created_at: new Date().toISOString(),
          detail: `Phát hiện tần suất truy vấn bất thường (>${rateLimit.limit} req/10s). Anti-DDoS đã tự động chặn IP.`
        });
        RUNTIME_STATE.logs.length = Math.min(RUNTIME_STATE.logs.length, 500);
      }
      return Response.json({
        success: false,
        error: 'Tần suất gửi yêu cầu quá nhanh. Hệ thống Anti-DDoS đang kích hoạt bảo vệ. Vui lòng thử lại sau vài giây.'
      }, {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': String(rateLimit.retryAfter || 10),
          'x-rate-limit-limit': String(rateLimit.limit),
        }
      });
    }

    // Health endpoints for EnsMovie & Web Verification
    if (url.pathname === '/__web/health' || url.pathname === '/__ens/health') {
      return Response.json({
        ok: true,
        app: 'Phim 4K VIP 4.0 (phim4vipzz)',
        status: 'online',
        project: 'phim4vipzz',
        mode: 'serverless-edge',
        freeAccess: RUNTIME_STATE.freeAccess,
        ddosBlockedCount: RUNTIME_STATE.stats.ddosBlockedCount,
        licenseOrigin: LICENSE_ORIGIN,
        ensOrigin: ENS_ORIGIN,
        adminConfigured: true,
        timestamp: new Date().toISOString()
      }, {
        headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // EnsMovie specific routes preserved
    if (url.pathname.startsWith('/api/ens/') || url.pathname.startsWith('/ens/')) {
      return proxyTo(request, ENS_ORIGIN);
    }

    // Authentication and every administrator mutation are server-authoritative.
    // Keep them on the D1-backed license Worker so maintenance, logs, device
    // approvals and movie reports survive Cloudflare Pages isolate restarts.
    const authoritativeApi = url.pathname.startsWith('/api/auth/')
      || url.pathname.startsWith('/api/admin/')
      || url.pathname.startsWith('/download/')
      || ['/api/app/access-policy', '/api/app/downloads', '/api/app/check-update', '/api/app/version', '/api/app/announcement', '/api/telemetry', '/api/feedback', '/api/watch-progress', '/api/movies/report-issue', '/api/movies/play'].includes(url.pathname);
    if (authoritativeApi) {
      return proxyTo(request, LICENSE_ORIGIN, {
        'x-forwarded-host': url.host,
        'x-forwarded-proto': 'https',
        'x-app-runtime': request.headers.get('x-app-runtime') || 'web'
      });
    }

    // Access Policy: Always grant free direct access unless maintenance is explicitly active
    if (url.pathname === '/api/app/access-policy') {
      return Response.json({
        success: true,
        freeAccess: RUNTIME_STATE.freeAccess,
        maintenance: RUNTIME_STATE.maintenance
      }, {
        headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' }
      });
    }

    // 2. Legacy local activation fallback. Administrator authentication is
    // always handled by the authoritative Worker above.
    if (request.method === 'POST' && url.pathname === '/api/auth/activate') {
      try {
        const body = await request.clone().json().catch(() => ({}));
        const rawKey = String(body.key || '').trim();
        const teleId = String(body.telegramId || '').trim();
        const deviceId = String(body.deviceId || 'browser').trim();

        const isMasterAdmin = false;
        if (isMasterAdmin) {
          const accessToken = generateSecureToken('p4a_');
          const refreshToken = generateSecureToken('p4r_');
          const futureIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          RUNTIME_STATE.logs.unshift({
            action: 'ADMIN_LOGIN',
            actor: teleId || '@mnhutdznecon',
            target: 'admin-auth',
            ip: clientIp,
            created_at: new Date().toISOString(),
            detail: `Super Admin đăng nhập thành công trên thiết bị ${deviceId}`
          });

          return Response.json({
            success: true,
            active: true,
            isAdmin: true,
            freeAccess: RUNTIME_STATE.freeAccess,
            plan: 'SUPER ADMIN MASTER',
            tier: 'admin',
            keyHint: 'MNHUT••••',
            sessionId: `s_adm_${Date.now()}`,
            accessToken,
            refreshToken,
            accessExpiresAt: futureIso,
            refreshExpiresAt: futureIso,
            expiresAt: null,
            features: [
              'Toàn quyền quản trị Super Admin',
              'Tạo và phân phối key bản quyền tự do',
              'Xem phim 4K Ultra HD gốc',
              'Tốc độ băng thông tối đa',
              '100% Không quảng cáo'
            ],
            telegramId: teleId || '@mnhutdznecon'
          }, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }

        // B. Check if key exists in memory keys (created by Admin or predefined)
        const matchedKey = rawKey ? RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === rawKey.toLowerCase() || (k.license_key && k.license_key.toLowerCase() === rawKey.toLowerCase())) : null;
        if (matchedKey) {
          if (!matchedKey.active) {
            return Response.json({ success: false, message: 'Key này hiện đang bị tạm khóa bởi Quản trị viên.' }, {
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
            });
          }
          if (matchedKey.expires_at && new Date(matchedKey.expires_at).getTime() < Date.now()) {
            return Response.json({ success: false, message: 'Key này đã hết hạn sử dụng. Vui lòng liên hệ Admin để gia hạn.' }, {
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
            });
          }

          const accessToken = generateSecureToken('p4a_');
          const refreshToken = generateSecureToken('p4r_');
          const futureIso = matchedKey.expires_at || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          // Increment device usage
          matchedKey.device_count = (matchedKey.device_count || 0) + 1;
          matchedKey.deviceCount = matchedKey.device_count;

          return Response.json({
            success: true,
            active: true,
            isAdmin: Boolean(matchedKey.isAdmin),
            freeAccess: RUNTIME_STATE.freeAccess,
            plan: matchedKey.plan || 'VIP TRỌN ĐỜI 4K',
            tier: matchedKey.tier || 'vip',
            keyHint: `${matchedKey.key.slice(0, 4)}••••`,
            sessionId: `s_vip_${Date.now()}`,
            accessToken,
            refreshToken,
            accessExpiresAt: futureIso,
            refreshExpiresAt: futureIso,
            expiresAt: matchedKey.expires_at,
            features: [
              'Xem phim 4K Ultra HD',
              'Đường truyền VIP siêu tốc',
              '100% Không quảng cáo'
            ]
          }, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }

        // C. If Free Access is active (Default) OR empty key requested: Give free public viewer access!
        if (!rawKey || RUNTIME_STATE.freeAccess) {
          const accessToken = generateSecureToken('p4a_');
          const refreshToken = generateSecureToken('p4r_');
          const futureIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          return Response.json({
            success: true,
            active: true,
            isAdmin: false,
            freeAccess: true,
            plan: 'MNHUT CINEMA 4K',
            tier: 'free',
            keyHint: 'FREE-PUBLIC••••',
            sessionId: `s_free_${Date.now()}`,
            accessToken,
            refreshToken,
            accessExpiresAt: futureIso,
            refreshExpiresAt: futureIso,
            expiresAt: null,
            features: [
              'Xem phim 4K tự do toàn hệ thống',
              'Không cần nhập Key hay tài khoản',
              'Đầy đủ tính năng xem phim, tìm kiếm & lịch chiếu'
            ]
          }, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
      } catch (err) {
        console.error('Auth activation interception error:', err);
      }
    }

    // 3. Auth Status & Refresh Check
    if (request.method === 'GET' && url.pathname === '/api/auth/status') {
      const authHeader = request.headers.get('authorization') || '';
      const isAdminSession = authHeader.includes('adm');
      return Response.json({
        success: true,
        active: true,
        isAdmin: isAdminSession,
        freeAccess: RUNTIME_STATE.freeAccess,
        plan: isAdminSession ? 'SUPER ADMIN MASTER' : (RUNTIME_STATE.freeAccess ? 'MNHUT CINEMA 4K' : 'VIP 4K'),
        tier: isAdminSession ? 'admin' : (RUNTIME_STATE.freeAccess ? 'free' : 'vip'),
        expiresAt: null,
        forceUpdate: false,
        isLatest: true
      }, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/refresh') {
      const authHeader = request.headers.get('authorization') || '';
      const isAdminSession = authHeader.includes('adm');
      const accessToken = generateSecureToken(isAdminSession ? 'p4a_adm_' : 'p4a_');
      const refreshToken = generateSecureToken(isAdminSession ? 'p4r_adm_' : 'p4r_');
      const futureIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
      return Response.json({
        success: true,
        active: true,
        isAdmin: isAdminSession,
        freeAccess: RUNTIME_STATE.freeAccess,
        accessToken,
        refreshToken,
        accessExpiresAt: futureIso,
        refreshExpiresAt: futureIso
      }, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    // 4. Movie Issue Report Endpoint (Nút Báo Lỗi Phim)
    if (request.method === 'POST' && url.pathname === '/api/movies/report-issue') {
      const body = await request.clone().json().catch(() => ({}));
      const reportItem = {
        id: `rep_${Date.now()}`,
        movieName: body.movieName || 'Phim chưa xác định',
        movieSlug: body.movieSlug || '',
        episode: body.episode || 'Tất cả tập',
        reason: body.reason || 'Lỗi tải video hoặc mất tiếng',
        deviceId: body.deviceId || 'browser',
        ip: clientIp,
        created_at: new Date().toISOString()
      };
      RUNTIME_STATE.reportedIssues.unshift(reportItem);
      RUNTIME_STATE.logs.unshift({
        action: 'MOVIE_REPORT',
        actor: reportItem.deviceId,
        target: `${reportItem.movieName} (${reportItem.episode})`,
        ip: clientIp,
        created_at: reportItem.created_at,
        detail: `Khán giả báo lỗi: "${reportItem.reason}"`
      });
      return Response.json({
        success: true,
        message: 'Đã gửi báo lỗi thành công! Đội ngũ Admin mnhut sẽ kiểm tra và sửa ngay.'
      }, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    // 4b. Movie Playback Ticket Handler (ensures instant 4K playback response)
    if (request.method === 'POST' && url.pathname === '/api/movies/play') {
      const body = await request.clone().json().catch(() => ({}));
      const streamUrl = body.streamUrl || body.link_m3u8 || body.url || '';
      return Response.json({
        success: true,
        streamUrl,
        isHls: true,
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      }, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (url.pathname === '/api/admin/reports') {
      return Response.json({
        success: true,
        reports: RUNTIME_STATE.reportedIssues
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // 5. Admin API Endpoints: Keys, Users, Anti-DDoS & Settings
    if (url.pathname === '/api/admin/keys') {
      return Response.json({
        success: true,
        stats: {
          totalKeys: RUNTIME_STATE.keys.length,
          activeKeys: RUNTIME_STATE.keys.filter(k => k.active).length,
          boundDevices: RUNTIME_STATE.keys.reduce((sum, k) => sum + (k.deviceCount || (k.devices ? k.devices.length : 0)), 0),
          bannedUsersCount: RUNTIME_STATE.users.filter(u => u.isBanned).length,
          ddosBlockedCount: RUNTIME_STATE.stats.ddosBlockedCount
        },
        keys: RUNTIME_STATE.keys
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // Admin creates key: accepts ANY text/format without restrictions!
    if (request.method === 'POST' && url.pathname === '/api/admin/create-key') {
      const body = await request.clone().json().catch(() => ({}));
      const rawInputKey = String(body.key || '').trim();
      const newKeyStr = rawInputKey || `VIP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const durationDays = Number(body.durationDays) || 0;
      const expiresAt = durationDays > 0 ? new Date(Date.now() + durationDays * 24 * 3600 * 1000).toISOString() : null;

      const newKeyObj = {
        license_key: newKeyStr,
        key: newKeyStr,
        plan: body.plan || (expiresAt ? `VIP ${durationDays} NGÀY` : 'VIP TRỌN ĐỜI 4K'),
        tier: 'vip',
        isAdmin: false,
        active: true,
        assigned_telegram_id: body.assignedTelegramId || body.telegramId || '',
        telegramId: body.assignedTelegramId || body.telegramId || '',
        boundTelegramId: body.assignedTelegramId || body.telegramId || '',
        max_devices: Number(body.maxDevices || 5),
        maxDevices: Number(body.maxDevices || 5),
        device_count: 0,
        deviceCount: 0,
        devices: [],
        expires_at: expiresAt,
        expiresAt: expiresAt,
        created_at: new Date().toISOString()
      };

      // If key already exists, replace it, otherwise unshift
      const existingIdx = RUNTIME_STATE.keys.findIndex(k => k.key.toLowerCase() === newKeyStr.toLowerCase());
      if (existingIdx >= 0) {
        RUNTIME_STATE.keys[existingIdx] = newKeyObj;
      } else {
        RUNTIME_STATE.keys.unshift(newKeyObj);
      }

      RUNTIME_STATE.logs.unshift({
        action: 'CREATE_KEY',
        actor: '@mnhutdznecon',
        target: newKeyStr,
        ip: clientIp,
        created_at: new Date().toISOString(),
        detail: `Admin tạo key [${newKeyStr}] thành công (${newKeyObj.plan}, tối đa ${newKeyObj.maxDevices} máy)`
      });

      return Response.json({
        success: true,
        message: `Đã tạo key [${newKeyStr}] thành công! Định dạng tự do hoàn toàn.`,
        key: newKeyStr,
        keyData: newKeyObj
      }, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/toggle-key') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      const target = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (target) {
        target.active = !target.active;
        return Response.json({ success: true, message: `Key [${keyStr}] đã được ${target.active ? 'mở khóa' : 'khóa'}.` });
      }
      return Response.json({ success: false, error: 'Không tìm thấy key' }, { status: 404 });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/delete-key') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      RUNTIME_STATE.keys = RUNTIME_STATE.keys.filter(k => k.key.toLowerCase() !== keyStr.toLowerCase());
      return Response.json({ success: true, message: `Đã xóa key [${keyStr}] thành công.` });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/renew-key') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      const addDays = Number(body.addDays) || 30;
      const target = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (target) {
        const base = target.expires_at ? new Date(target.expires_at).getTime() : Date.now();
        target.expires_at = new Date(Math.max(base, Date.now()) + addDays * 24 * 3600 * 1000).toISOString();
        target.expiresAt = target.expires_at;
        return Response.json({ success: true, message: `Đã gia hạn thêm ${addDays} ngày cho key [${keyStr}].` });
      }
      return Response.json({ success: false, error: 'Không tìm thấy key' }, { status: 404 });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/set-max-devices') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      const maxDevices = Number(body.maxDevices) || 1;
      const target = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (target) {
        target.max_devices = maxDevices;
        target.maxDevices = maxDevices;
        return Response.json({ success: true, message: `Đã đặt giới hạn thiết bị cho [${keyStr}] thành ${maxDevices} máy.` });
      }
      return Response.json({ success: false, error: 'Không tìm thấy key' }, { status: 404 });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/reset-device') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      const target = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (target) {
        target.device_count = 0;
        target.deviceCount = 0;
        target.devices = [];
        return Response.json({ success: true, message: `Đã gỡ toàn bộ thiết bị khỏi key [${keyStr}].` });
      }
      return Response.json({ success: false, error: 'Không tìm thấy key' }, { status: 404 });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/reset-telegram') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      const target = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (target) {
        target.assigned_telegram_id = body.newTelegramId || '';
        target.telegramId = body.newTelegramId || '';
        target.boundTelegramId = body.newTelegramId || '';
        return Response.json({ success: true, message: `Đã cập nhật Telegram ID cho key [${keyStr}].` });
      }
      return Response.json({ success: false, error: 'Không tìm thấy key' }, { status: 404 });
    }

    if (url.pathname === '/api/admin/users') {
      return Response.json({
        success: true,
        users: RUNTIME_STATE.users
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/ban-user') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      const userItem = {
        key: keyStr,
        boundDeviceId: body.deviceId || '',
        plan: 'VIP',
        isBanned: true,
        reason: body.reason || 'Vi phạm điều khoản',
        bannedAt: new Date().toISOString()
      };
      RUNTIME_STATE.users.unshift(userItem);
      const targetKey = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (targetKey) targetKey.active = false;

      RUNTIME_STATE.logs.unshift({
        action: 'BAN_USER',
        actor: '@mnhutdznecon',
        target: keyStr,
        ip: clientIp,
        created_at: new Date().toISOString(),
        detail: `Đã ban user key [${keyStr}]. Lý do: ${userItem.reason}`
      });
      return Response.json({ success: true, message: `Đã khóa và ban user dùng key [${keyStr}].` });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/unban-user') {
      const body = await request.clone().json().catch(() => ({}));
      const keyStr = String(body.key || '').trim();
      RUNTIME_STATE.users = RUNTIME_STATE.users.filter(u => u.key.toLowerCase() !== keyStr.toLowerCase());
      const targetKey = RUNTIME_STATE.keys.find(k => k.key.toLowerCase() === keyStr.toLowerCase());
      if (targetKey) targetKey.active = true;
      return Response.json({ success: true, message: `Đã gỡ ban cho key [${keyStr}].` });
    }

    if (url.pathname === '/api/admin/device-access-requests') {
      return Response.json({
        success: true,
        requests: RUNTIME_STATE.deviceRequests
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/device-access-decision') {
      const body = await request.clone().json().catch(() => ({}));
      return Response.json({ success: true, message: 'Đã cập nhật yêu cầu thiết bị.' });
    }

    if (url.pathname === '/api/admin/logs') {
      return Response.json({
        success: true,
        logs: RUNTIME_STATE.logs
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/admin/content-status') {
      return Response.json({
        source: 'phimapi + ensmovie',
        cacheActive: true,
        lastSuccessfulRefreshAt: new Date().toISOString(),
        refreshIntervalSeconds: 30
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/app/access-policy' || url.pathname === '/api/admin/access-policy') {
      if (request.method === 'POST') {
        const body = await request.clone().json().catch(() => ({}));
        if (typeof body.freeAccess === 'boolean') RUNTIME_STATE.freeAccess = body.freeAccess;
      }
      return Response.json({
        success: true,
        freeAccess: RUNTIME_STATE.freeAccess,
        maintenance: RUNTIME_STATE.maintenance
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/maintenance') {
      const body = await request.clone().json().catch(() => ({}));
      RUNTIME_STATE.maintenance.active = Boolean(body.enabled);
      if (body.message) RUNTIME_STATE.maintenance.message = body.message;
      return Response.json({
        success: true,
        maintenance: RUNTIME_STATE.maintenance,
        message: body.enabled ? 'Đã bật chế độ bảo trì.' : 'Đã mở lại toàn bộ hệ thống xem phim.'
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // 6. Movie browsing and details go directly through the same provider
    // contract used by ENSMovie. This avoids waiting for the legacy backend
    // before falling back and keeps link_embed/link_m3u8 intact on every client.
    if (request.method === 'GET' && url.pathname.startsWith('/api/movies/')) {
      const movieCache = globalThis.caches?.default;
      const movieCacheKey = publicMovieCacheRequest(url);
      // ?refresh=1 (used when a title shows no new episodes) must really skip
      // the edge copy; the fresh answer then replaces it for everyone.
      const forceFresh = url.searchParams.get('refresh') === '1';
      if (movieCache && movieCacheKey && !forceFresh) {
        const cached = await movieCache.match(movieCacheKey);
        if (cached) return cached;
      }
      const direct = await fetchDirectMovieCatalog(url.pathname, url.searchParams, url.origin);
      if (direct) {
        if (movieCache && movieCacheKey) ctx?.waitUntil(movieCache.put(movieCacheKey, direct.clone()));
        return direct;
      }
    }

    // 7. All Other Movie & Backend APIs -> Proxy to Upstream with fallback
    if (url.pathname.startsWith('/api/')) {
      const canCacheMovie = request.method === 'GET' && url.pathname.startsWith('/api/movies/');
      const movieCache = canCacheMovie ? globalThis.caches?.default : null;
      const movieCacheKey = canCacheMovie ? publicMovieCacheRequest(url) : null;
      if (movieCache && movieCacheKey) {
        const cached = await movieCache.match(movieCacheKey);
        if (cached) return cached;
      }
      const response = await proxyTo(request, LICENSE_ORIGIN, {
        'x-forwarded-host': url.host,
        'x-forwarded-proto': 'https',
        'x-app-runtime': 'web'
      });

      // If license server returns error on movie browsing, fallback to direct catalogs so browsing always works
      if ((response.status === 401 || response.status === 403 || response.status >= 500) && url.pathname.startsWith('/api/movies/')) {
        const direct = await fetchDirectMovieCatalog(url.pathname, url.searchParams, url.origin);
        if (direct) {
          if (movieCache && movieCacheKey) ctx?.waitUntil(movieCache.put(movieCacheKey, direct.clone()));
          return direct;
        }
      }

      return response;
    }

    // 8. Single-page application route: HTML requests get web-index.html
    const wantsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (url.pathname === '/' || (!url.pathname.includes('.') && wantsHtml)) {
      const previewUrl = new URL('/web-index.html', request.url);
      const preview = await env.ASSETS.fetch(new Request(previewUrl, request));
      if (preview.ok) {
        const headers = new Headers(preview.headers);
        headers.set('cache-control', 'no-store, max-age=0');
        return new Response(preview.body, { status: preview.status, statusText: preview.statusText, headers });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
