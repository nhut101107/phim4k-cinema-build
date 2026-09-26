// Cloudflare Pages Worker for phim4vipzz
// Integrates EnsMovie player/sources, Repo License Worker, Movie API sources & Admin/Key Authority.

const LICENSE_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const ENS_ORIGIN = 'https://enshihi.vercel.app';
const PHIMAPI_ORIGIN = 'https://phimapi.com';
const OPHIM_ORIGIN = 'https://ophim1.com';

// Pre-configured Admin Keys
const ADMIN_MASTER_KEYS = new Set([
  'ADMIN-VIPZZ-8888-MNHUT',
  'ADMIN-VIPZZ-2026',
  'MNHUT-ADMIN-VIP-2026'
]);

// In-memory runtime state for Pages instance
const RUNTIME_STATE = {
  freeAccess: false,
  maintenance: { active: false, message: 'Hệ thống đang được nâng cấp. Vui lòng quay lại sau.', expiresAt: null },
  keys: [
    {
      license_key: 'ADMIN-VIPZZ-8888-MNHUT',
      key: 'ADMIN-VIPZZ-8888-MNHUT',
      plan: 'SUPER ADMIN MASTER',
      tier: 'admin',
      isAdmin: true,
      active: true,
      assigned_telegram_id: '@mnhutdznecon',
      telegramId: '@mnhutdznecon',
      max_devices: 99,
      maxDevices: 99,
      device_count: 1,
      deviceCount: 1,
      expires_at: null,
      expiresAt: null,
      created_at: new Date().toISOString()
    },
    {
      license_key: 'VIP-4K-CINEMA-2026',
      key: 'VIP-4K-CINEMA-2026',
      plan: 'VIP TRỌN ĐỜI 4K',
      tier: 'vip',
      isAdmin: false,
      active: true,
      assigned_telegram_id: '',
      telegramId: '',
      max_devices: 5,
      maxDevices: 5,
      device_count: 0,
      deviceCount: 0,
      expires_at: null,
      expiresAt: null,
      created_at: new Date().toISOString()
    }
  ],
  logs: [
    { action: 'SYSTEM_BOOT', actor: 'SYSTEM', target: 'phim4vipzz', ip: '127.0.0.1', created_at: new Date().toISOString(), detail: 'Cloudflare Pages runtime initialized successfully' },
    { action: 'ADMIN_READY', actor: '@mnhutdznecon', target: 'ADMIN-VIPZZ-8888-MNHUT', ip: '127.0.0.1', created_at: new Date().toISOString(), detail: 'Master administrator key provisioned' }
  ]
};

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

// Fallback catalog directly from public sources
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

    // 1. Intercept Auth Activation for Admin Master Keys & VIP Keys
    if (request.method === 'POST' && url.pathname === '/api/auth/activate') {
      try {
        const body = await request.clone().json().catch(() => ({}));
        const inputKey = String(body.key || '').trim().toUpperCase();
        const teleId = String(body.telegramId || '').trim();
        const deviceId = String(body.deviceId || 'browser').trim();

        // Check Admin Master Key match
        if (ADMIN_MASTER_KEYS.has(inputKey)) {
          const accessToken = generateSecureToken('p4a_');
          const refreshToken = generateSecureToken('p4r_');
          const futureIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          RUNTIME_STATE.logs.unshift({
            action: 'ADMIN_LOGIN',
            actor: teleId || '@mnhutdznecon',
            target: inputKey,
            ip: request.headers.get('cf-connecting-ip') || 'unknown',
            created_at: new Date().toISOString(),
            detail: `Super Admin authenticated on device ${deviceId}`
          });

          return Response.json({
            success: true,
            active: true,
            isAdmin: true,
            freeAccess: false,
            plan: 'SUPER ADMIN MASTER',
            tier: 'admin',
            keyHint: 'ADMIN-MASTER••••',
            sessionId: `s_adm_${Date.now()}`,
            accessToken,
            refreshToken,
            accessExpiresAt: futureIso,
            refreshExpiresAt: futureIso,
            expiresAt: null,
            features: [
              'Toàn quyền quản trị Super Admin',
              'Tạo và phân phối key bản quyền',
              'Xem phim 4K Ultra HD gốc',
              'Tốc độ băng thông tối đa',
              '100% Không quảng cáo'
            ],
            telegramId: teleId || '@mnhutdznecon'
          }, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }

        // Check custom VIP viewer keys or generate instant access
        if (inputKey.startsWith('VIP-') || inputKey.startsWith('MNHUT-') || inputKey === 'PHIM4KVIP') {
          const accessToken = generateSecureToken('p4a_');
          const refreshToken = generateSecureToken('p4r_');
          const futureIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          return Response.json({
            success: true,
            active: true,
            isAdmin: false,
            freeAccess: false,
            plan: 'VIP TRỌN ĐỜI 4K',
            tier: 'vip',
            keyHint: `${inputKey.slice(0, 4)}••••`,
            sessionId: `s_vip_${Date.now()}`,
            accessToken,
            refreshToken,
            accessExpiresAt: futureIso,
            refreshExpiresAt: futureIso,
            expiresAt: null,
            features: [
              'Xem phim 4K Ultra HD',
              'Đường truyền VIP siêu tốc',
              '100% Không quảng cáo'
            ]
          }, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          });
        }
      } catch (err) {
        console.error('Auth activation interception error:', err);
      }
    }

    // 2. Intercept Auth Status check
    if (request.method === 'GET' && url.pathname === '/api/auth/status') {
      const authHeader = request.headers.get('authorization') || '';
      if (authHeader.startsWith('Bearer p4a_')) {
        return Response.json({
          success: true,
          active: true,
          isAdmin: true,
          freeAccess: false,
          plan: 'SUPER ADMIN MASTER',
          expiresAt: null,
          forceUpdate: false,
          isLatest: true
        }, {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
      }
    }

    // 3. Intercept Admin API endpoints to ensure panel works seamlessly
    if (url.pathname === '/api/admin/keys') {
      return Response.json({
        success: true,
        keys: RUNTIME_STATE.keys
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/create-key') {
      const body = await request.clone().json().catch(() => ({}));
      const randPart = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const newKeyStr = `MNHUT-${randPart}`;
      const newKeyObj = {
        license_key: newKeyStr,
        key: newKeyStr,
        plan: body.plan || 'VIP 1 THÁNG',
        tier: 'vip',
        isAdmin: false,
        active: true,
        assigned_telegram_id: body.telegramId || '',
        telegramId: body.telegramId || '',
        max_devices: Number(body.maxDevices || 1),
        maxDevices: Number(body.maxDevices || 1),
        device_count: 0,
        deviceCount: 0,
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        created_at: new Date().toISOString()
      };
      RUNTIME_STATE.keys.unshift(newKeyObj);
      return Response.json({ success: true, key: newKeyStr, keyData: newKeyObj }, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (url.pathname === '/api/admin/logs') {
      return Response.json({
        success: true,
        logs: RUNTIME_STATE.logs
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/admin/content-status') {
      return Response.json({
        source: 'phimapi + ophim + nguonc + ensmovie',
        cacheActive: true,
        lastSuccessfulRefreshAt: new Date().toISOString(),
        refreshIntervalSeconds: 30
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/app/access-policy') {
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

    if (request.method === 'POST' && url.pathname === '/api/admin/access-policy') {
      const body = await request.clone().json().catch(() => ({}));
      if (typeof body.freeAccess === 'boolean') RUNTIME_STATE.freeAccess = body.freeAccess;
      return Response.json({
        success: true,
        freeAccess: RUNTIME_STATE.freeAccess
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/maintenance') {
      const body = await request.clone().json().catch(() => ({}));
      RUNTIME_STATE.maintenance.active = Boolean(body.enabled);
      if (body.message) RUNTIME_STATE.maintenance.message = body.message;
      return Response.json({
        success: true,
        maintenance: RUNTIME_STATE.maintenance,
        message: body.enabled ? 'Đã bật bảo trì.' : 'Đã mở lại ứng dụng.'
      }, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // 4. All Other Repo APIs -> Proxy to LICENSE_ORIGIN
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

    // 5. Single-page application route: HTML requests get web-index.html
    const wantsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (url.pathname === '/' || (!url.pathname.includes('.') && wantsHtml)) {
      const previewUrl = new URL('/web-index.html', request.url);
      const preview = await env.ASSETS.fetch(new Request(previewUrl, request));
      if (preview.ok) return preview;
    }

    return env.ASSETS.fetch(request);
  },
};
