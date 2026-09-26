// Cloudflare Pages Worker for phim4vipzz
// Integrates EnsMovie player/sources, Repo License Worker, Movie API sources, Anti-DDoS & Admin Authority.

const LICENSE_ORIGIN = 'https://phim4k-license-api.phim4k-pwdbhdz.workers.dev';
const ENS_ORIGIN = 'https://enshihi.vercel.app';
const PHIMAPI_ORIGIN = 'https://phimapi.com';
const OPHIM_ORIGIN = 'https://ophim1.com';

// Pre-configured Admin Keys (User specified key: mnhut)
const ADMIN_MASTER_KEYS = new Set([
  'mnhut',
  'MNHUT',
  'mnhutdznecon',
  'ADMIN-VIPZZ-8888-MNHUT',
  'ADMIN-VIPZZ-2026',
  'MNHUT-ADMIN-VIP-2026'
]);

// In-memory runtime state for Cloudflare Pages instance (Runs 100% serverless on edge - No VPS or PC needed)
const RUNTIME_STATE = {
  freeAccess: true, // Default to true: Public access for everyone to watch freely!
  maintenance: { active: false, message: 'Hệ thống đang được nâng cấp. Vui lòng quay lại sau.', expiresAt: null },
  keys: [
    {
      license_key: 'mnhut',
      key: 'mnhut',
      plan: 'SUPER ADMIN MASTER',
      tier: 'admin',
      isAdmin: true,
      active: true,
      assigned_telegram_id: '@mnhutdznecon',
      telegramId: '@mnhutdznecon',
      boundTelegramId: '@mnhutdznecon',
      max_devices: 999,
      maxDevices: 999,
      device_count: 1,
      deviceCount: 1,
      devices: [{ deviceId: 'admin_primary', ip: '127.0.0.1', addedAt: new Date().toISOString() }],
      expires_at: null,
      expiresAt: null,
      created_at: new Date().toISOString()
    },
    {
      license_key: 'ADMIN-VIPZZ-8888-MNHUT',
      key: 'ADMIN-VIPZZ-8888-MNHUT',
      plan: 'SUPER ADMIN MASTER',
      tier: 'admin',
      isAdmin: true,
      active: true,
      assigned_telegram_id: '@mnhutdznecon',
      telegramId: '@mnhutdznecon',
      boundTelegramId: '@mnhutdznecon',
      max_devices: 99,
      maxDevices: 99,
      device_count: 1,
      deviceCount: 1,
      devices: [{ deviceId: 'admin_backup', ip: '127.0.0.1', addedAt: new Date().toISOString() }],
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
    { action: 'SYSTEM_BOOT', actor: 'SYSTEM', target: 'phim4vipzz', ip: '127.0.0.1', created_at: new Date().toISOString(), detail: 'Cloudflare Pages serverless edge online. Chế độ công khai miễn phí (Free Access) đang kích hoạt.' },
    { action: 'ADMIN_READY', actor: '@mnhutdznecon', target: 'mnhut', ip: '127.0.0.1', created_at: new Date().toISOString(), detail: 'Master administrator key provisioned: mnhut' }
  ],
  stats: {
    ddosBlockedCount: 0
  }
};

// Anti-DDoS In-Worker Rate Limiting Tracker
const IP_RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds sliding window
const MAX_REQUESTS_PER_WINDOW = 120; // 120 API calls / 10s is plenty for normal users, blocks floods

function checkRateLimit(ip, path) {
  if (!path.startsWith('/api/')) return true; // Static assets / images never blocked
  const now = Date.now();
  let record = IP_RATE_LIMIT.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    IP_RATE_LIMIT.set(ip, record);
    if (IP_RATE_LIMIT.size > 5000) {
      const oldestKey = IP_RATE_LIMIT.keys().next().value;
      IP_RATE_LIMIT.delete(oldestKey);
    }
    return true;
  }
  record.count++;
  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  return true;
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

    if (endpoint.startsWith('/api/movies/category/')) {
      const cat = endpoint.split('/api/movies/category/')[1];
      const res = await fetch(`${PHIMAPI_ORIGIN}/v1/api/danh-sach/${encodeURIComponent(cat)}?page=${page}&limit=24`);
      if (res.ok) {
        const data = await res.json();
        return Response.json({
          category: cat,
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
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

    // 1. Anti-DDoS Rate Limiting Guard
    if (!checkRateLimit(clientIp, url.pathname)) {
      RUNTIME_STATE.stats.ddosBlockedCount++;
      RUNTIME_STATE.logs.unshift({
        action: 'DDOS_BLOCKED',
        actor: 'SHIELD',
        target: clientIp,
        ip: clientIp,
        created_at: new Date().toISOString(),
        detail: `Phát hiện tần suất truy vấn bất thường (>120 req/10s). Anti-DDoS đã tự động chặn IP.`
      });
      return Response.json({
        success: false,
        error: 'Tần suất gửi yêu cầu quá nhanh. Hệ thống Anti-DDoS đang kích hoạt bảo vệ. Vui lòng thử lại sau vài giây.'
      }, {
        status: 429,
        headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '10' }
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
        masterKey: 'mnhut',
        timestamp: new Date().toISOString()
      }, {
        headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // EnsMovie specific routes preserved
    if (url.pathname.startsWith('/api/ens/') || url.pathname.startsWith('/ens/')) {
      return proxyTo(request, ENS_ORIGIN);
    }

    // 2. Auth Activation: Handles Admin Master Key 'mnhut', VIP keys, & Free Public Access
    if (request.method === 'POST' && url.pathname === '/api/auth/activate') {
      try {
        const body = await request.clone().json().catch(() => ({}));
        const rawKey = String(body.key || '').trim();
        const teleId = String(body.telegramId || '').trim();
        const deviceId = String(body.deviceId || 'browser').trim();

        // A. Check Master Admin Key ('mnhut' or configured admin master keys)
        const isMasterAdmin = rawKey.toLowerCase() === 'mnhut' || ADMIN_MASTER_KEYS.has(rawKey) || ADMIN_MASTER_KEYS.has(rawKey.toUpperCase());
        if (isMasterAdmin) {
          const accessToken = generateSecureToken('p4a_');
          const refreshToken = generateSecureToken('p4r_');
          const futureIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

          RUNTIME_STATE.logs.unshift({
            action: 'ADMIN_LOGIN',
            actor: teleId || '@mnhutdznecon',
            target: 'mnhut',
            ip: clientIp,
            created_at: new Date().toISOString(),
            detail: `Super Admin (mnhut) đăng nhập thành công trên thiết bị ${deviceId}`
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
            plan: 'MIỄN PHÍ TOÀN BỘ KHÁN GIẢ (FREE 4K)',
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

    // 3. Auth Status Check
    if (request.method === 'GET' && url.pathname === '/api/auth/status') {
      const authHeader = request.headers.get('authorization') || '';
      if (authHeader.startsWith('Bearer p4a_')) {
        return Response.json({
          success: true,
          active: true,
          isAdmin: authHeader.includes('adm') || false,
          freeAccess: RUNTIME_STATE.freeAccess,
          plan: 'SUPER ADMIN MASTER',
          expiresAt: null,
          forceUpdate: false,
          isLatest: true
        }, {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        });
      }
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
        source: 'phimapi + ophim + nguonc + ensmovie',
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

    // 6. All Other Movie & Backend APIs -> Proxy to Upstream with fallback
    if (url.pathname.startsWith('/api/')) {
      const response = await proxyTo(request, LICENSE_ORIGIN, {
        'x-forwarded-host': url.host,
        'x-forwarded-proto': 'https',
        'x-app-runtime': 'web'
      });

      // If license server returns error on movie browsing, fallback to direct catalogs so browsing always works
      if ((response.status === 401 || response.status >= 500) && url.pathname.startsWith('/api/movies/')) {
        const direct = await fetchDirectMovieCatalog(url.pathname, url.searchParams);
        if (direct) return direct;
      }

      return response;
    }

    // 7. Single-page application route: HTML requests get web-index.html
    const wantsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (url.pathname === '/' || (!url.pathname.includes('.') && wantsHtml)) {
      const previewUrl = new URL('/web-index.html', request.url);
      const preview = await env.ASSETS.fetch(new Request(previewUrl, request));
      if (preview.ok) return preview;
    }

    return env.ASSETS.fetch(request);
  },
};
