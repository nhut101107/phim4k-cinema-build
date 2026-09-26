// Cloudflare Pages Worker for phim4vipzz
// Integrates EnsMovie player/sources, Repo License Worker, and Movie API sources.

const LICENSE_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const ENS_ORIGIN = 'https://enshihi.vercel.app';
const PHIMAPI_ORIGIN = 'https://phimapi.com';
const OPHIM_ORIGIN = 'https://ophim1.com';

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

// Fallback catalog directly from public sources when license worker requires session
async function fetchDirectMovieCatalog(endpoint, searchParams) {
  const page = searchParams.get('page') || '1';
  try {
    if (endpoint === '/api/movies/home') {
      const [latestRes, seriesRes, animeRes] = await Promise.allSettled([
        fetch(`${PHIMAPI_ORIGIN}/danh-sach/phim-moi-cap-nhat?page=1`).then(r => r.json()),
        fetch(`${PHIMAPI_ORIGIN}/v1/api/danh-sach/phim-bo?page=1&limit=18`).then(r => r.json()),
        fetch(`${PHIMAPI_ORIGIN}/v1/api/danh-sach/hoat-hinh?page=1&limit=18`).then(r => r.json())
      ]);

      const latestItems = latestRes.status === 'fulfilled' ? (latestRes.value.items || []) : [];
      const seriesItems = seriesRes.status === 'fulfilled' ? (seriesRes.value.data?.items || []) : [];
      const animeItems = animeRes.status === 'fulfilled' ? (animeRes.value.data?.items || []) : [];

      const hero = latestItems.slice(0, 6).map(m => ({
        name: m.name,
        slug: m.slug,
        origin_name: m.origin_name,
        poster_url: m.poster_url?.startsWith('http') ? m.poster_url : `https://phimimg.com/${m.poster_url}`,
        thumb_url: m.thumb_url?.startsWith('http') ? m.thumb_url : `https://phimimg.com/${m.thumb_url}`,
        year: m.year,
        quality: m.quality || '4K Ultra HD',
        episode_current: m.episode_current || 'Bản Đẹp'
      }));

      const normalize = (items) => items.map(m => ({
        ...m,
        poster_url: m.poster_url?.startsWith('http') ? m.poster_url : `https://phimimg.com/${m.poster_url}`,
        thumb_url: m.thumb_url?.startsWith('http') ? m.thumb_url : `https://phimimg.com/${m.thumb_url}`
      }));

      return Response.json({
        hero,
        updatedAt: new Date().toISOString(),
        sections: [
          { id: 'latest', title: '🔥 Phim Mới Cập Nhật', items: normalize(latestItems.slice(0, 18)) },
          { id: 'series', title: '📺 Phim Bộ Nổi Bật', items: normalize(seriesItems) },
          { id: 'anime', title: '✨ Hoạt Hình & Anime Hot', items: normalize(animeItems) }
        ]
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
    }

    if (endpoint.startsWith('/api/movies/detail/')) {
      const slug = endpoint.split('/api/movies/detail/')[1];
      const res = await fetch(`${PHIMAPI_ORIGIN}/phim/${encodeURIComponent(slug)}`);
      if (res.ok) {
        const data = await res.json();
        return Response.json(data, {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }
        });
      }
    }

    if (endpoint === '/api/movies/search') {
      const q = searchParams.get('q') || '';
      const res = await fetch(`${PHIMAPI_ORIGIN}/v1/api/tim-kiem?keyword=${encodeURIComponent(q)}&page=${page}&limit=24`);
      if (res.ok) {
        const data = await res.json();
        return Response.json({
          query: q,
          items: data.data?.items || [],
          pagination: data.data?.params?.pagination || { currentPage: parseInt(page, 10), totalPages: 1 }
        }, { headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
    }
  } catch (err) {
    console.error('Direct movie catalog error:', err);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health endpoints for EnsMovie & Web Verification
    if (url.pathname === '/__web/health' || url.pathname === '/__ens/health') {
      return Response.json({
        ok: true,
        app: 'Phim 4K VIP 4.0 (phim4vipzz)',
        status: 'online',
        project: 'phim4vipzz',
        licenseOrigin: LICENSE_ORIGIN,
        ensOrigin: ENS_ORIGIN,
        timestamp: new Date().toISOString()
      }, {
        headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // EnsMovie specific routes preserved
    if (url.pathname.startsWith('/api/ens/') || url.pathname.startsWith('/ens/')) {
      return proxyTo(request, ENS_ORIGIN);
    }

    // All Repo APIs (Auth, Admin, App config, Watch progress, Telemetry, Movies)
    if (url.pathname.startsWith('/api/')) {
      const response = await proxyTo(request, LICENSE_ORIGIN, {
        'x-forwarded-host': url.host,
        'x-forwarded-proto': 'https',
        'x-app-runtime': 'web'
      });

      // If license server returns 401 or 502 on movie browsing, fallback to direct catalogs so browsing works
      if ((response.status === 401 || response.status >= 500) && url.pathname.startsWith('/api/movies/')) {
        const direct = await fetchDirectMovieCatalog(url.pathname, url.searchParams);
        if (direct) return direct;
      }

      return response;
    }

    // Single-page application route: HTML requests get web-index.html
    const wantsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (url.pathname === '/' || (!url.pathname.includes('.') && wantsHtml)) {
      const previewUrl = new URL('/web-index.html', request.url);
      const preview = await env.ASSETS.fetch(new Request(previewUrl, request));
      if (preview.ok) return preview;
    }

    return env.ASSETS.fetch(request);
  },
};
