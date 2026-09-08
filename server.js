const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BIND_HOST = String(process.env.BIND_HOST || '127.0.0.1');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
// This app only accepts flat query values. Avoid Express's extended qs parser;
// JSON is the only accepted request body format below.
app.set('query parser', 'simple');

// Browser hardening. Inline event handlers remain for backwards compatibility,
// while the server limits sensitive browser capabilities.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://phim4k-license-api.phim4k-pwdbhdz.workers.dev; media-src 'self' blob: https://phim4k-license-api.phim4k-pwdbhdz.workers.dev; connect-src 'self' https://phim4k-license-api.phim4k-pwdbhdz.workers.dev; worker-src 'self' blob:");
  next();
});

// Paths
const KEYS_PATH = path.join(__dirname, 'config', 'keys.json');
const BANS_PATH = path.join(__dirname, 'config', 'bans.json');
const LOGS_PATH = path.join(__dirname, 'config', 'logs.json');
const DOWNLOADS_PATH = path.join(__dirname, 'config', 'downloads.json');
// Local development also keeps privileged values outside source control.
// Production uses the Cloudflare Worker secrets/settings instead of this file.
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '').trim();
const ADMIN_MASTER_KEY = String(process.env.ADMIN_MASTER_KEY || process.env.ADMIN_LICENSE_KEY || '').trim();

function configuredHttpsOrigin(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.origin;
  } catch (_error) {
    return '';
  }
}

const MOVIE_CATALOG_ORIGIN = configuredHttpsOrigin('MOVIE_CATALOG_ORIGIN');
const MOVIE_BACKUP_ORIGIN = configuredHttpsOrigin('MOVIE_BACKUP_ORIGIN');

function movieUpstreamUrl(origin, pathname) {
  if (!origin) throw new Error('MOVIE_SOURCE_NOT_CONFIGURED');
  return new URL(pathname, `${origin}/`).href;
}

function loadDownloadsConfig() {
  try {
    const raw = fs.readFileSync(DOWNLOADS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return {
      android: { name: 'Phim 4K Cinema Android (ADR / APK)', url: '/download/apk', version: '3.0.0', note: 'Điện thoại & TV Android' },
      ios: { name: 'Phim 4K Cinema iOS (IPA)', url: '/download/ipa', version: '3.0.0', note: 'iPhone & iPad' },
      windows: { name: 'Phim 4K Cinema Windows (EXE)', url: '/download/exe', version: '3.0.0', note: 'Máy tính Windows' }
    };
  }
}

function saveDownloadsConfig(cfg) {
  try {
    fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
}

function compareVersions(v1, v2) {
  const p1 = String(v1 || '0').split('.').map(s => parseInt(s, 10) || 0);
  const p2 = String(v2 || '0').split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

// ==========================================
// 1. DATA ACCESS & AUDIT LOG HELPERS
// ==========================================

function loadKeyConfig() {
  try {
    const raw = fs.readFileSync(KEYS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading keys:', err);
    return { keys: [] };
  }
}

function saveKeyConfig(config) {
  try {
    fs.writeFileSync(KEYS_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving keys:', err);
    return false;
  }
}

function loadBans() {
  try {
    const raw = fs.readFileSync(BANS_PATH, 'utf-8');
    return JSON.parse(raw).bannedUsers || [];
  } catch (err) {
    return [];
  }
}

function saveBans(bannedUsers) {
  try {
    fs.writeFileSync(BANS_PATH, JSON.stringify({ bannedUsers }, null, 2), 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
}

function normalizeIp(value) {
  const raw = value ? String(value).trim() : '';
  const unwrapped = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  return net.isIP(unwrapped) ? unwrapped : null;
}

function deviceHash(deviceId) {
  const clean = deviceId ? String(deviceId).trim() : '';
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean, 'utf8').digest('hex').slice(0, 24);
}

function keyHint(key) {
  const clean = key ? String(key).trim() : '';
  if (!clean) return null;
  return clean.length <= 4 ? '••••' : `••••${clean.slice(-4)}`;
}

function maskIp(ip) {
  const clean = normalizeIp(ip);
  if (!clean) return null;
  if (net.isIP(clean) === 4) {
    const octets = clean.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.*`;
  }
  const parts = clean.split(':').filter(Boolean);
  return `${parts.slice(0, 3).join(':')}::/48`;
}

function auditAccount({ telegramId = null, key = null, deviceId = null, ip = null } = {}) {
  const cleanTeleId = telegramId ? String(telegramId).trim() : null;
  const fingerprint = deviceHash(deviceId);
  const maskedIp = maskIp(ip);
  if (!cleanTeleId && !key && !fingerprint && !maskedIp) return null;
  return {
    telegramId: cleanTeleId || null,
    keyHint: keyHint(key),
    deviceHash: fingerprint,
    ip: maskedIp
  };
}

function redactAuditDetails(value) {
  return String(value || '')
    .replace(/\b(?:license\s*)?key\s*\[[^\]]+\]/gi, 'key [••••]')
    .replace(/\b(?:license\s*)?key\s+[A-Za-z0-9-]{4,}/gi, 'key ••••')
    .slice(0, 600);
}

function isBanned(telegramId, ip, deviceId = null) {
  const bans = loadBans();
  const cleanTeleId = telegramId ? String(telegramId).trim() : null;
  const cleanIp = normalizeIp(ip);
  const fingerprint = deviceHash(deviceId);
  return bans.find(b =>
    (cleanTeleId && b.telegramId === cleanTeleId) ||
    (cleanIp && b.ip === cleanIp) ||
    (fingerprint && b.deviceHash === fingerprint)
  );
}

function addLog(type, action, details, ip = 'unknown', account = null) {
  try {
    let logs = [];
    if (fs.existsSync(LOGS_PATH)) {
      const raw = fs.readFileSync(LOGS_PATH, 'utf-8');
      logs = JSON.parse(raw).logs || [];
    }

    const newEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      type, // 'AUTH', 'ADMIN', 'KEY', 'BAN', 'DDOS', 'STREAM'
      action,
      details: redactAuditDetails(details),
      ip: maskIp(ip) || 'unknown',
      account: account ? auditAccount({ ...account, ip: account.ip || ip }) : null
    };

    logs.unshift(newEntry);
    if (logs.length > 1000) logs = logs.slice(0, 1000); // Ring buffer 1000

    fs.writeFileSync(LOGS_PATH, JSON.stringify({ logs }, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error logging audit action:', err);
  }
}

// In-memory cache
const cache = new Map();
function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.data;
}
function setCache(key, data, ttlSeconds = 60) { // 60s cache for fast updates
  cache.set(key, { data, expiry: Date.now() + ttlSeconds * 1000 });
}

const movieFeedState = {
  lastSuccessfulRefreshAt: null,
  lastAdminRefreshAt: null,
  lastRefreshError: null
};

function invalidateMovieCaches() {
  for (const key of cache.keys()) {
    if (key === 'home_feed_v2' || key.startsWith('cat_')) cache.delete(key);
  }
}

// ==========================================
// 2. ANTI-DDOS FIREWALL & RATE LIMITING
// ==========================================

const rateLimitMap = new Map(); // ip -> { count, windowStart, rapidCount, lastRapidTime, jailedUntil }
const ddosStats = {
  totalBlocked: 0,
  jailedIPsCount: 0
};

const RATE_RECORD_MAX_AGE_MS = 20 * 60 * 1000;
const RATE_RECORD_MAX_SIZE = 10000;

function getClientIp(req) {
  // Trust X-Forwarded-For only if a reverse proxy is explicitly configured.
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return normalizeIp(String(forwarded).split(',')[0]) || 'unknown';
  }
  return normalizeIp(req.socket.remoteAddress) || 'unknown';
}

function getRatePolicy(pathname) {
  if (pathname.startsWith('/api/auth')) return { perMinute: 25, rapid: 20 };
  // HLS segments legitimately arrive in bursts, so they have an isolated cap.
  if (pathname.startsWith('/api/stream/proxy')) return { perMinute: 900, rapid: 180 };
  if (pathname.startsWith('/api/')) return { perMinute: 180, rapid: 60 };
  return { perMinute: 300, rapid: 100 };
}

function sendRateLimit(res, retryAfterSeconds, error, message) {
  res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
  return res.status(429).json({ error, message });
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (record.jailedUntil <= now && now - record.lastSeenAt > RATE_RECORD_MAX_AGE_MS) {
      rateLimitMap.delete(ip);
    }
  }
  while (rateLimitMap.size > RATE_RECORD_MAX_SIZE) {
    rateLimitMap.delete(rateLimitMap.keys().next().value);
  }
}, 5 * 60 * 1000).unref();

app.use((req, res, next) => {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 1024 * 1024) {
    return res.status(413).json({ error: 'REQUEST_TOO_LARGE', message: 'Yêu cầu vượt quá dung lượng cho phép.' });
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const policy = getRatePolicy(req.path);

  let record = rateLimitMap.get(ip);
  if (!record) {
    record = { count: 0, windowStart: now, rapidCount: 0, rapidWindowStart: now, jailedUntil: 0, lastSeenAt: now };
    rateLimitMap.set(ip, record);
  }
  record.lastSeenAt = now;

  // Check if IP is in jail
  if (record.jailedUntil > now) {
    ddosStats.totalBlocked++;
    const remainingSec = Math.ceil((record.jailedUntil - now) / 1000);
    return sendRateLimit(res, remainingSec, 'DDOS_JAILED', `🚫 IP của bạn đã bị tường lửa tạm khóa trong ${remainingSec}s do phát hiện hành vi spam requests!`);
  }

  // Rapid flood detector: policy threshold in a real rolling 3-second window.
  if (now - record.rapidWindowStart >= 3000) {
    record.rapidCount = 1;
    record.rapidWindowStart = now;
  } else {
    record.rapidCount++;
    if (record.rapidCount > policy.rapid) {
      record.jailedUntil = now + 15 * 60 * 1000; // 15 mins jail
      ddosStats.totalBlocked++;
      ddosStats.jailedIPsCount++;
      addLog('DDOS', 'IP_JAILED', `Phát hiện tấn công flood requests (${record.rapidCount} req/3s) từ IP: ${ip}`, ip);
      return sendRateLimit(res, 15 * 60, 'DDOS_BLOCKED', '🚫 Tường lửa đã chặn IP của bạn trong 15 phút do tần suất gửi yêu cầu bất thường!');
    }
  }

  // 1-minute window rate limit
  if (now - record.windowStart > 60000) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count++;
  }

  if (record.count > policy.perMinute) {
    ddosStats.totalBlocked++;
    return sendRateLimit(res, Math.ceil((60000 - (now - record.windowStart)) / 1000), 'RATE_LIMIT_EXCEEDED', '⚠️ Bạn đang gửi yêu cầu quá nhanh! Vui lòng chờ rồi thử lại.');
  }

  next();
});

// This legacy development server is same-origin only. Production clients use
// the Cloudflare Worker API and must never depend on a wildcard CORS proxy.
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));
app.get('/standalone.html', (_req, res) => {
  res.status(410).type('text/plain').send('This legacy page is no longer available.');
});
app.use(express.static(PUBLIC_DIR, {
  maxAge: '1h',
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(?:js|css|svg|jpg|jpeg|png|webp)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=600');
    }
  }
}));

// ==========================================
// 3. AUTHENTICATION & LICENSE VERIFICATION
// ==========================================

function validateKey(keyString, telegramId = null, deviceId = null, ip = null, autoBind = false) {
  if (!keyString || !keyString.trim()) {
    return { valid: false, code: 'NO_KEY', reason: 'Vui lòng nhập License Key!' };
  }
  if (!telegramId || !String(telegramId).trim()) {
    return { valid: false, code: 'NO_TELEGRAM_ID', reason: 'Vui lòng nhập Telegram ID của bạn!' };
  }

  const cleanKey = keyString.trim();
  const cleanTeleId = String(telegramId).trim();

  // 1. Check if user/IP is banned
  const banInfo = isBanned(cleanTeleId, ip, deviceId);
  if (banInfo) {
    return {
      valid: false,
      code: 'USER_BANNED',
      reason: `🚫 Tài khoản Telegram [${cleanTeleId}] đã bị Admin cấm! Lý do: ${banInfo.reason || 'Vi phạm điều khoản'}`
    };
  }

  const config = loadKeyConfig();
  const keys = config.keys || [];

  // 2. Strict Super Admin Check. Identity and key come from the environment.
  if (ADMIN_MASTER_KEY && cleanKey.toLowerCase() === ADMIN_MASTER_KEY.toLowerCase()) {
    if (cleanTeleId !== ADMIN_TELEGRAM_ID) {
      addLog('AUTH', 'ADMIN_FAILED', 'A license key was used with a non-authorized administrator account', ip, {
        telegramId: cleanTeleId,
        key: cleanKey,
        deviceId
      });
      return {
        valid: false,
        code: 'FORBIDDEN_NOT_ADMIN',
        reason: '❌ Tài khoản này không có quyền dùng key quản trị.'
      };
    }

    let adminEntry = keys.find(k => k.key.toLowerCase() === ADMIN_MASTER_KEY.toLowerCase());
    if (!adminEntry) {
      adminEntry = {
        key: ADMIN_MASTER_KEY,
        telegramId: ADMIN_TELEGRAM_ID,
        boundTelegramId: ADMIN_TELEGRAM_ID,
        plan: 'SUPER ADMIN MASTER',
        tier: 'admin',
        features: ['Toàn quyền quản trị Admin', 'Tạo và quản lý key', 'Chất Lượng Gốc 4K Cinema', '4K Ultra HD', 'Không giới hạn'],
        expiresAt: null,
        active: true,
        isAdmin: true
      };
    }
    return { valid: true, keyData: adminEntry, isAdmin: true };
  }

  // 3. Regular Client Key Verification
  const found = keys.find(k => k.key.toUpperCase() === cleanKey.toUpperCase());
  if (!found) {
    return { valid: false, code: 'INVALID_KEY', reason: 'License Key không tồn tại hoặc không chính xác!' };
  }
  if (!found.active) {
    return { valid: false, code: 'KEY_LOCKED', reason: 'License Key này đã bị tạm khóa bởi Admin!' };
  }

  // Strict Expiry Check
  if (found.expiresAt) {
    const exp = new Date(found.expiresAt).getTime();
    if (Date.now() > exp) {
      return {
        valid: false,
        code: 'KEY_EXPIRED',
        reason: 'Hạn sử dụng License Key của bạn đã kết thúc! Vui lòng liên hệ Admin để gia hạn.'
      };
    }
  }

  // Telegram ID Binding Check: 1 Key / 1 Telegram ID
  if (found.boundTelegramId && String(found.boundTelegramId).trim() !== cleanTeleId) {
    addLog('AUTH', 'TELE_MISMATCH', 'A license key was used by a different Telegram account', ip, {
      telegramId: cleanTeleId,
      key: cleanKey,
      deviceId
    });
    return {
      valid: false,
      code: 'TELEGRAM_ID_MISMATCH',
      reason: '❌ Key này đã được cấp cho một Telegram ID khác! Mỗi key chỉ dùng cho đúng 1 tài khoản Telegram.'
    };
  }

  // Device Binding Check: 1 Key / 1 Device
  if (deviceId && found.boundDeviceId && found.boundDeviceId !== deviceId) {
    addLog('AUTH', 'DEVICE_MISMATCH', 'A license key was used by a different device', ip, {
      telegramId: cleanTeleId,
      key: cleanKey,
      deviceId
    });
    return {
      valid: false,
      code: 'DEVICE_ALREADY_BOUND',
      reason: '❌ Key này đã được kích hoạt trên thiết bị khác! Mỗi key chỉ dùng cho 1 thiết bị.'
    };
  }

  // Auto-bind on first activation
  if (autoBind) {
    let changed = false;
    if (!found.boundTelegramId) {
      found.boundTelegramId = cleanTeleId;
      changed = true;
    }
    if (deviceId && !found.boundDeviceId) {
      found.boundDeviceId = deviceId;
      found.boundAt = new Date().toISOString();
      found.lastIp = ip || 'unknown';
      changed = true;
    }
    if (changed) {
      saveKeyConfig(config);
      addLog('KEY', 'KEY_ACTIVATED', 'License key activated and bound to an account', ip, {
        telegramId: cleanTeleId,
        key: found.key,
        deviceId
      });
    }
  }

  return { valid: true, keyData: found, isAdmin: false };
}

function recordLicenseSeen(keyData, ip) {
  if (!keyData?.key || keyData.isAdmin) return;

  const config = loadKeyConfig();
  const key = (config.keys || []).find(item => String(item.key || '').toUpperCase() === String(keyData.key).toUpperCase());
  if (!key) return;

  const now = Date.now();
  const lastSeen = new Date(key.lastSeenAt || 0).getTime();
  const cleanIp = normalizeIp(ip) || 'unknown';
  if (Number.isFinite(lastSeen) && now - lastSeen < 60 * 1000 && key.lastIp === cleanIp) return;

  key.lastSeenAt = new Date(now).toISOString();
  key.lastIp = cleanIp;
  saveKeyConfig(config);
}

// Middleware: Require valid license key & telegram ID
function requireLicenseKey(req, res, next) {
  const authHeader = req.headers['x-license-key'] || req.headers['authorization'];
  let key = authHeader;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.replace('Bearer ', '');
  }
  if (!key && req.query.key) key = req.query.key;

  const telegramId = req.headers['x-telegram-id'] || req.query.telegramId;
  const deviceId = req.headers['x-device-id'] || req.query.deviceId;
  const clientIp = getClientIp(req);

  const result = validateKey(key, telegramId, deviceId, clientIp, false);
  if (!result.valid) {
    return res.status(401).json({
      error: result.code || 'UNAUTHORIZED_KEY',
      message: result.reason
    });
  }

  req.license = result.keyData;
  req.isAdmin = result.isAdmin;
  next();
}

// Middleware: Require the server-configured Super Admin credentials.
function requireAdmin(req, res, next) {
  const authHeader = req.headers['x-license-key'] || req.headers['authorization'];
  let key = authHeader;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.replace('Bearer ', '');
  }
  if (!key && req.query.key) key = req.query.key;

  const telegramId = req.headers['x-telegram-id'] || req.query.telegramId;

  if (
    !key || key.trim().toLowerCase() !== ADMIN_MASTER_KEY.toLowerCase() ||
    !telegramId || String(telegramId).trim() !== ADMIN_TELEGRAM_ID
  ) {
    return res.status(403).json({
      error: 'FORBIDDEN_ADMIN_ONLY',
      message: 'Yêu cầu quyền Super Admin đã được máy chủ xác thực để vào Panel Quản Trị!'
    });
  }

  next();
}

// ==========================================
// 4. AUTH & STATUS ENDPOINTS
// ==========================================

app.post('/api/auth/activate', (req, res) => {
  const { key, telegramId, deviceId } = req.body;
  if (!key || !telegramId) {
    return res.status(400).json({
      success: false,
      message: 'Vui lòng nhập cả Telegram ID và License Key!'
    });
  }

  const clientIp = getClientIp(req);
  const result = validateKey(key, telegramId, deviceId, clientIp, true);

  if (!result.valid) {
    addLog('AUTH', 'ACTIVATION_DENIED', 'License activation was denied', clientIp, { telegramId, key, deviceId });
    const status = (result.code === 'DEVICE_ALREADY_BOUND' || result.code === 'TELEGRAM_ID_MISMATCH' || result.code === 'FORBIDDEN_NOT_ADMIN' || result.code === 'USER_BANNED') ? 403 : 401;
    return res.status(status).json({
      success: false,
      code: result.code,
      message: result.reason
    });
  }

  addLog('AUTH', 'ACTIVATION_SUCCEEDED', 'License activation succeeded', clientIp, {
    telegramId: result.keyData.boundTelegramId || telegramId,
    key: result.keyData.key,
    deviceId
  });

  res.json({
    success: true,
    message: result.isAdmin ? 'Đăng nhập Super Admin thành công!' : 'Xác thực thành công!',
    key: result.keyData.key,
    telegramId: result.keyData.boundTelegramId || telegramId,
    plan: result.keyData.plan,
    tier: result.keyData.tier,
    features: result.keyData.features,
    expiresAt: result.keyData.expiresAt,
    isAdmin: !!result.isAdmin,
    boundDeviceId: result.keyData.boundDeviceId
  });
});

app.get('/api/auth/status', (req, res) => {
  const key = req.headers['x-license-key'] || req.query.key;
  const telegramId = req.headers['x-telegram-id'] || req.query.telegramId;
  const deviceId = req.headers['x-device-id'] || req.query.deviceId;
  const clientIp = getClientIp(req);

  // Check Force Update (Block outdated versions if enabled by Admin)
  const clientVersion = req.headers['x-app-version'] || req.query.version || '3.0.0';
  const dlConfig = loadDownloadsConfig();
  if (dlConfig.forceUpdate && dlConfig.forceUpdate.enabled) {
    const minVer = dlConfig.forceUpdate.minVersion || '3.0.0';
    if (compareVersions(clientVersion, minVer) < 0) {
      return res.json({
        active: false,
        code: 'FORCE_UPDATE_REQUIRED',
        reason: dlConfig.forceUpdate.message || 'Phiên bản của bạn đã cũ, bắt buộc cập nhật lên bản mới nhất!',
        minVersion: minVer,
        latestVersion: dlConfig.forceUpdate.latestVersion || '3.0.0',
        downloads: dlConfig
      });
    }
  }

  const result = validateKey(key, telegramId, deviceId, clientIp, false);
  if (!result.valid) {
    return res.json({
      active: false,
      code: result.code,
      reason: result.reason
    });
  }

  recordLicenseSeen(result.keyData, clientIp);

  res.json({
    active: true,
    key: result.keyData.key,
    telegramId: result.keyData.boundTelegramId || telegramId,
    plan: result.keyData.plan,
    tier: result.keyData.tier,
    features: result.keyData.features,
    expiresAt: result.keyData.expiresAt,
    isAdmin: !!result.isAdmin,
    boundDeviceId: result.keyData.boundDeviceId
  });
});

// ==========================================
// 5. ADMIN PANEL API (KEYS, USERS, BANS, LOGS)
// ==========================================

// Set / Edit key expiration date or lifetime status
app.post('/api/admin/set-key-expiry', requireAdmin, (req, res) => {
  const { key, expiresAt, isLifetime, addDays, newPlan } = req.body;
  if (!key) return res.status(400).json({ error: 'Thiếu mã key!' });

  const config = loadKeyConfig();
  const keys = config.keys || [];
  const found = keys.find(k => k.key.toUpperCase() === key.trim().toUpperCase());
  if (!found) return res.status(404).json({ error: 'Không tìm thấy License Key này!' });

  if (isLifetime) {
    found.expiresAt = null;
    found.plan = newPlan || 'VIP Vĩnh Viễn';
    found.tier = 'lifetime';
    found.active = true;
    saveKeyConfig(config);
    addLog('ADMIN', 'KEY_TIME_EDIT', `Chuyển key [${found.key}] thành VIP Vĩnh Viễn`);
    return res.json({ success: true, message: `Đã chuyển key [${found.key}] thành VIP Vĩnh Viễn!`, expiresAt: null, plan: found.plan });
  }

  if (addDays && parseInt(addDays, 10) > 0) {
    const days = parseInt(addDays, 10);
    const now = Date.now();
    let baseTime = now;
    if (found.expiresAt) {
      const curExp = new Date(found.expiresAt).getTime();
      if (curExp > now) baseTime = curExp;
    }
    found.expiresAt = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();
    found.active = true;
    if (newPlan) found.plan = newPlan;
    saveKeyConfig(config);
    addLog('ADMIN', 'KEY_TIME_EDIT', `Gia hạn ${days} ngày cho key [${found.key}]. Hạn mới: ${found.expiresAt}`);
    return res.json({ success: true, message: `Đã cập nhật hạn dùng cho key [${found.key}]!`, expiresAt: found.expiresAt });
  }

  if (expiresAt) {
    const parsedDate = new Date(expiresAt);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Ngày giờ hết hạn không hợp lệ!' });
    }
    found.expiresAt = parsedDate.toISOString();
    found.active = true;
    if (newPlan) found.plan = newPlan;
    saveKeyConfig(config);
    addLog('ADMIN', 'KEY_TIME_EDIT', `Đặt lại hạn dùng cho key [${found.key}] đến: ${found.expiresAt}`);
    return res.json({ success: true, message: `Đã chỉnh sửa ngày hết hạn cho key [${found.key}]!`, expiresAt: found.expiresAt });
  }

  res.status(400).json({ error: 'Dữ liệu thời gian không hợp lệ!' });
});

// Get all keys + dashboard stats
app.get('/api/admin/keys', requireAdmin, (req, res) => {
  const config = loadKeyConfig();
  const keys = config.keys || [];
  const bans = loadBans();
  const now = Date.now();

  let activeCount = 0;
  let expiredCount = 0;
  let boundCount = 0;

  const enrichedKeys = keys.map(k => {
    let isExpired = false;
    if (k.expiresAt) {
      isExpired = now > new Date(k.expiresAt).getTime();
    }
    if (k.active && !isExpired) activeCount++;
    if (isExpired) expiredCount++;
    if (k.boundDeviceId || k.boundTelegramId) boundCount++;

    return {
      ...k,
      isExpired,
      statusLabel: !k.active ? 'Đã khóa' : (isExpired ? 'Hết hạn' : 'Đang hoạt động')
    };
  });

  res.json({
    adminTelegramId: ADMIN_TELEGRAM_ID,
    stats: {
      totalKeys: keys.length,
      activeKeys: activeCount,
      expiredKeys: expiredCount,
      boundDevices: boundCount,
      bannedUsersCount: bans.length,
      ddosBlockedCount: ddosStats.totalBlocked
    },
    keys: enrichedKeys
  });
});

// Create a new key
app.post('/api/admin/create-key', requireAdmin, (req, res) => {
  const { key, plan, durationDays, assignedTelegramId } = req.body;
  if (!key || !key.trim()) {
    return res.status(400).json({ error: 'Mã Key không được để trống!' });
  }

  const trimmedKey = key.trim().toUpperCase();
  const config = loadKeyConfig();
  const keys = config.keys || [];

  if (keys.some(k => k.key.toUpperCase() === trimmedKey)) {
    return res.status(400).json({ error: 'Mã Key này đã tồn tại trong hệ thống!' });
  }

  let expiresAt = null;
  const days = parseInt(durationDays, 10);
  if (!isNaN(days) && days > 0) {
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const newKey = {
    key: trimmedKey,
    boundTelegramId: assignedTelegramId ? String(assignedTelegramId).trim() : null,
    plan: plan || (days ? `VIP ${days} Ngày` : 'VIP Vĩnh Viễn'),
    tier: days ? (days >= 365 ? 'pro' : 'vip') : 'lifetime',
    features: [
      '4K Ultra HD & Full HD',
      'Chất Lượng Gốc 4K Cinema',
      '1 Tài khoản Telegram',
      '1 Thiết bị duy nhất'
    ],
    expiresAt,
    active: true,
    isAdmin: false,
    boundDeviceId: null,
    boundAt: null,
    lastIp: null,
    createdAt: new Date().toISOString()
  };

  keys.push(newKey);
  config.keys = keys;
  saveKeyConfig(config);

  addLog('ADMIN', 'KEY_CREATED', `Tạo key [${trimmedKey}] (${newKey.plan}) gán cho Tele: ${newKey.boundTelegramId || 'Tự do'}`);
  res.json({ success: true, message: `Đã tạo License Key [${trimmedKey}] thành công!`, keyData: newKey });
});

// Renew key
app.post('/api/admin/renew-key', requireAdmin, (req, res) => {
  const { key, addDays } = req.body;
  const days = parseInt(addDays, 10);
  if (!key || isNaN(days) || days <= 0) {
    return res.status(400).json({ error: 'Dữ liệu gia hạn không hợp lệ!' });
  }

  const config = loadKeyConfig();
  const keys = config.keys || [];
  const found = keys.find(k => k.key.toUpperCase() === key.trim().toUpperCase());
  if (!found) return res.status(404).json({ error: 'Không tìm thấy License Key này!' });

  const now = Date.now();
  let baseTime = now;
  if (found.expiresAt) {
    const currentExp = new Date(found.expiresAt).getTime();
    if (currentExp > now) baseTime = currentExp;
  }

  found.expiresAt = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();
  found.active = true;
  saveKeyConfig(config);

  addLog('ADMIN', 'KEY_RENEWED', `Gia hạn ${days} ngày cho key [${found.key}]`);
  res.json({ success: true, message: `Đã gia hạn thêm ${days} ngày cho key [${found.key}]!`, expiresAt: found.expiresAt });
});

// Reset device
app.post('/api/admin/reset-device', requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Thiếu mã key!' });

  const config = loadKeyConfig();
  const keys = config.keys || [];
  const found = keys.find(k => k.key.toUpperCase() === key.trim().toUpperCase());
  if (!found) return res.status(404).json({ error: 'Không tìm thấy License Key này!' });

  found.boundDeviceId = null;
  found.boundAt = null;
  found.lastIp = null;
  saveKeyConfig(config);

  addLog('ADMIN', 'DEVICE_RESET', `Xóa liên kết thiết bị cũ cho key [${found.key}]`);
  res.json({ success: true, message: `Đã xóa liên kết thiết bị cho key [${found.key}]!` });
});

// Reset Telegram
app.post('/api/admin/reset-telegram', requireAdmin, (req, res) => {
  const { key, newTelegramId } = req.body;
  if (!key) return res.status(400).json({ error: 'Thiếu mã key!' });

  const config = loadKeyConfig();
  const keys = config.keys || [];
  const found = keys.find(k => k.key.toUpperCase() === key.trim().toUpperCase());
  if (!found) return res.status(404).json({ error: 'Không tìm thấy License Key này!' });

  found.boundTelegramId = newTelegramId ? String(newTelegramId).trim() : null;
  saveKeyConfig(config);

  addLog('ADMIN', 'TELEGRAM_RESET', `Đổi Telegram ID cho key [${found.key}] thành [${found.boundTelegramId || 'Tự do'}]`);
  res.json({ success: true, message: `Đã cập nhật Telegram ID cho key [${found.key}]!` });
});

// Toggle key
app.post('/api/admin/toggle-key', requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Thiếu mã key!' });

  const config = loadKeyConfig();
  const keys = config.keys || [];
  const found = keys.find(k => k.key.toUpperCase() === key.trim().toUpperCase());
  if (!found) return res.status(404).json({ error: 'Không tìm thấy License Key này!' });
  if (found.key.toLowerCase() === ADMIN_MASTER_KEY.toLowerCase()) {
    return res.status(400).json({ error: 'Không thể khóa Master Admin Key!' });
  }

  found.active = !found.active;
  saveKeyConfig(config);

  addLog('ADMIN', 'KEY_TOGGLE', `${found.active ? 'Mở khóa' : 'Tạm khóa'} key [${found.key}]`);
  res.json({ success: true, message: `Đã ${found.active ? 'kích hoạt' : 'tạm khóa'} key [${found.key}]!`, active: found.active });
});

// Delete key
app.post('/api/admin/delete-key', requireAdmin, (req, res) => {
  const requestedKey = req.body?.key;
  const target = requestedKey ? String(requestedKey).trim() : '';
  if (!target || target.length > 128 || /[\u0000-\u001f]/.test(target)) {
    return res.status(400).json({ error: 'Mã key cần xoá không hợp lệ!' });
  }

  const config = loadKeyConfig();
  const keys = Array.isArray(config.keys) ? config.keys : [];
  const index = keys.findIndex(item => String(item.key || '').toUpperCase() === target.toUpperCase());
  if (index < 0) return res.status(404).json({ error: 'Không tìm thấy License Key cần xoá!' });
  const candidate = keys[index];
  if (candidate.isAdmin || String(candidate.key || '').toLowerCase() === ADMIN_MASTER_KEY.toLowerCase()) {
    return res.status(400).json({ error: 'Không thể xoá Master Admin Key!' });
  }
  const [removed] = keys.splice(index, 1);
  config.keys = keys;
  if (!saveKeyConfig(config)) {
    return res.status(500).json({ error: 'Không thể lưu thay đổi key. Key chưa bị xoá.' });
  }

  addLog('ADMIN', 'KEY_DELETED', 'Administrator removed a license key', 'unknown', {
    telegramId: removed.boundTelegramId,
    key: removed.key,
    deviceId: removed.boundDeviceId
  });
  return res.json({ success: true, message: 'Đã xoá key khỏi hệ thống.' });
});

// USER MANAGEMENT & BAN/UNBAN ROUTES
// A ban may target a Telegram account, the app-generated device identity, or
// the most recently recorded server IP. The device value is hashed before it
// enters bans.json; browser code never receives a hardware identifier.
function matchingBanRecords(bans, keyRecord) {
  const telegramId = keyRecord?.boundTelegramId ? String(keyRecord.boundTelegramId).trim() : null;
  const fingerprint = deviceHash(keyRecord?.boundDeviceId);
  const ip = normalizeIp(keyRecord?.lastIp);
  return bans.filter(ban =>
    (telegramId && ban.telegramId === telegramId) ||
    (fingerprint && ban.deviceHash === fingerprint) ||
    (ip && ban.ip === ip)
  );
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const config = loadKeyConfig();
  const keys = Array.isArray(config.keys) ? config.keys : [];
  const bans = loadBans();
  const users = keys
    .filter(key => key.boundTelegramId || key.boundDeviceId || key.lastIp)
    .map(key => {
      const matchedBans = matchingBanRecords(bans, key);
      return {
        telegramId: key.boundTelegramId || null,
        key: key.key,
        plan: key.plan,
        boundDeviceId: key.boundDeviceId ? `device:${deviceHash(key.boundDeviceId)}` : null,
        lastIp: maskIp(key.lastIp),
        boundAt: key.boundAt || null,
        lastSeenAt: key.lastSeenAt || key.boundAt || null,
        isAdmin: Boolean(key.isAdmin),
        isBanned: matchedBans.length > 0,
        bans: matchedBans.map(ban => ({ id: ban.id, scopes: ban.scopes || [], reason: ban.reason, bannedAt: ban.bannedAt })),
        status: matchedBans.length ? 'Đã bị cấm' : (key.active ? 'Hoạt động' : 'Tạm khóa')
      };
    });
  const knownTelegramIds = new Set(users.map(user => String(user.telegramId || '')).filter(Boolean));
  for (const ban of bans) {
    if (!ban.telegramId || knownTelegramIds.has(String(ban.telegramId))) continue;
    users.push({
      telegramId: ban.telegramId,
      key: 'Không còn key liên kết',
      plan: 'Banned',
      boundDeviceId: ban.deviceHash ? `device:${ban.deviceHash}` : null,
      lastIp: maskIp(ban.ip),
      boundAt: ban.bannedAt || null,
      lastSeenAt: null,
      isAdmin: false,
      isBanned: true,
      bans: [{ id: ban.id, scopes: ban.scopes || [], reason: ban.reason, bannedAt: ban.bannedAt }],
      status: 'Đã bị cấm'
    });
  }
  res.json({ users });
});

app.post('/api/admin/ban-user', requireAdmin, (req, res) => {
  const telegramId = req.body?.telegramId ? String(req.body.telegramId).trim() : '';
  const requestedScopes = Array.isArray(req.body?.scopes) ? req.body.scopes : ['telegram'];
  const scopes = [...new Set(requestedScopes.filter(scope => ['telegram', 'device', 'ip'].includes(scope)))];
  const reason = String(req.body?.reason || 'Vi phạm điều khoản sử dụng').trim().slice(0, 240);
  if (!telegramId || !/^\d{5,20}$/.test(telegramId) || !scopes.length) {
    return res.status(400).json({ error: 'Cần Telegram ID hợp lệ và ít nhất một phạm vi cấm.' });
  }
  if (telegramId === ADMIN_TELEGRAM_ID) {
    return res.status(400).json({ error: 'Không thể cấm tài khoản Admin.' });
  }

  const config = loadKeyConfig();
  const keys = Array.isArray(config.keys) ? config.keys : [];
  const account = keys.find(key => String(key.boundTelegramId || '').trim() === telegramId);
  const sourceDeviceId = account?.boundDeviceId || null;
  const sourceIp = normalizeIp(account?.lastIp);
  if (scopes.includes('device') && !sourceDeviceId) {
    return res.status(400).json({ error: 'Tài khoản này chưa có thiết bị đã bind để cấm.' });
  }
  if (scopes.includes('ip') && !sourceIp) {
    return res.status(400).json({ error: 'Tài khoản này chưa có IP hợp lệ để cấm.' });
  }

  const ban = {
    id: `ban_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    telegramId: scopes.includes('telegram') ? telegramId : null,
    deviceHash: scopes.includes('device') ? deviceHash(sourceDeviceId) : null,
    ip: scopes.includes('ip') ? sourceIp : null,
    scopes,
    reason,
    bannedAt: new Date().toISOString()
  };
  const bans = loadBans();
  const duplicate = bans.some(existing =>
    (ban.telegramId && existing.telegramId === ban.telegramId) ||
    (ban.deviceHash && existing.deviceHash === ban.deviceHash) ||
    (ban.ip && existing.ip === ban.ip)
  );
  if (duplicate) return res.status(409).json({ error: 'Đã có lệnh cấm tương ứng cho tài khoản này.' });
  bans.push(ban);
  if (!saveBans(bans)) return res.status(500).json({ error: 'Không thể lưu lệnh cấm.' });

  for (const key of keys) {
    if (key.isAdmin || String(key.boundTelegramId || '').trim() === ADMIN_TELEGRAM_ID) continue;
    const matched =
      (ban.telegramId && String(key.boundTelegramId || '').trim() === ban.telegramId) ||
      (ban.deviceHash && deviceHash(key.boundDeviceId) === ban.deviceHash) ||
      (ban.ip && normalizeIp(key.lastIp) === ban.ip);
    if (matched) key.active = false;
  }
  if (!saveKeyConfig(config)) return res.status(500).json({ error: 'Đã lưu lệnh cấm nhưng không thể khoá key liên quan.' });

  addLog('BAN', 'ACCOUNT_BANNED', `Administrator created ban scopes: ${scopes.join(', ')}`, sourceIp || 'unknown', {
    telegramId,
    key: account?.key,
    deviceId: sourceDeviceId
  });
  return res.json({ success: true, message: 'Đã cấm tài khoản theo phạm vi đã chọn.', ban: { id: ban.id, scopes: ban.scopes } });
});

app.post('/api/admin/unban-user', requireAdmin, (req, res) => {
  const banId = req.body?.banId ? String(req.body.banId).trim() : '';
  const telegramId = req.body?.telegramId ? String(req.body.telegramId).trim() : '';
  if (!banId && !telegramId) return res.status(400).json({ error: 'Cần mã lệnh cấm hoặc Telegram ID.' });
  const bans = loadBans();
  const removed = bans.filter(ban => (banId && ban.id === banId) || (telegramId && ban.telegramId === telegramId));
  if (!removed.length) return res.status(404).json({ error: 'Không tìm thấy lệnh cấm cần gỡ.' });
  const retained = bans.filter(ban => !removed.includes(ban));
  if (!saveBans(retained)) return res.status(500).json({ error: 'Không thể lưu thay đổi lệnh cấm.' });
  addLog('BAN', 'ACCOUNT_UNBANNED', 'Administrator removed account ban records', 'unknown', { telegramId });
  // Deliberately do not reactivate a key here: an administrator must explicitly
  // unlock it after reviewing the account.
  return res.json({ success: true, message: 'Đã gỡ lệnh cấm. Key vẫn giữ trạng thái hiện tại để admin tự mở khi cần.' });
});

// AUDIT LOGS ENDPOINTS
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  let logs = [];
  if (fs.existsSync(LOGS_PATH)) {
    try {
      logs = JSON.parse(fs.readFileSync(LOGS_PATH, 'utf-8')).logs || [];
    } catch (err) {}
  }
  const telegramId = req.query.telegramId ? String(req.query.telegramId).trim() : '';
  const rawLimit = Number.parseInt(String(req.query.limit || '200'), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const filtered = telegramId
    ? logs.filter(log => String(log.account?.telegramId || '').trim() === telegramId)
    : logs;
  const safeLogs = filtered.slice(0, limit).map(log => ({
    ...log,
    details: redactAuditDetails(log.details),
    ip: maskIp(log.ip) || 'unknown',
    account: log.account || null
  }));
  res.json({ logs: safeLogs, filter: telegramId || null });
});

app.delete('/api/admin/logs', requireAdmin, (req, res) => {
  fs.writeFileSync(LOGS_PATH, JSON.stringify({ logs: [] }, null, 2), 'utf-8');
  addLog('ADMIN', 'LOGS_CLEARED', 'Admin đã xóa sạch lịch sử nhật ký hệ thống.');
  res.json({ success: true, message: 'Đã xóa sạch lịch sử nhật ký!' });
});

// Content source status and an admin-only cache refresh. The next feed request
// obtains fresh film metadata and poster URLs from the configured public source.
app.get('/api/admin/content-status', requireAdmin, (req, res) => {
  const homeCache = cache.get('home_feed_v2');
  res.json({
    source: MOVIE_CATALOG_ORIGIN ? 'configured-primary' : 'not-configured',
    cacheActive: Boolean(getCache('home_feed_v2')),
    cacheExpiresAt: homeCache?.expiry ? new Date(homeCache.expiry).toISOString() : null,
    lastSuccessfulRefreshAt: movieFeedState.lastSuccessfulRefreshAt,
    lastAdminRefreshAt: movieFeedState.lastAdminRefreshAt,
    lastRefreshError: movieFeedState.lastRefreshError,
    refreshIntervalSeconds: 60
  });
});

app.post('/api/admin/refresh-movies', requireAdmin, (req, res) => {
  invalidateMovieCaches();
  movieFeedState.lastAdminRefreshAt = new Date().toISOString();
  addLog('ADMIN', 'MOVIE_CACHE_REFRESHED', 'Admin đã xóa cache phim và ảnh để lấy nguồn mới ở lần tải kế tiếp.', getClientIp(req));
  res.json({ success: true, message: 'Đã làm mới cache. Trang chủ sẽ lấy phim và poster mới ngay ở lần tải kế tiếp.' });
});

// ==========================================
// 6. REAL-TIME MOVIE AGGREGATION & PRIORITY
// ==========================================

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Phim4K-Pro/2.7.3 (Windows NT 10.0; Win64; x64)',
        ...(options.headers || {})
      }
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Home feed: Priority 1 is newly updated & hot movies, 60s cache TTL
app.get('/api/movies/home', requireLicenseKey, async (req, res) => {
  const cached = getCache('home_feed_v2');
  if (cached) return res.json(cached);

  try {
    const [latestRes, movieRes, seriesRes, animeRes] = await Promise.allSettled([
      fetchJson(movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, '/danh-sach/phim-moi-cap-nhat?page=1')),
      fetchJson(movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, '/v1/api/danh-sach/phim-le?page=1&limit=16')),
      fetchJson(movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, '/v1/api/danh-sach/phim-bo?page=1&limit=16')),
      fetchJson(movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, '/v1/api/danh-sach/hoat-hinh?page=1&limit=16'))
    ]);

    const latestItems = latestRes.status === 'fulfilled' ? latestRes.value.items || [] : [];
    const movieItems = movieRes.status === 'fulfilled' ? movieRes.value.data?.items || [] : [];
    const seriesItems = seriesRes.status === 'fulfilled' ? seriesRes.value.data?.items || [] : [];
    const animeItems = animeRes.status === 'fulfilled' ? animeRes.value.data?.items || [] : [];

    // Sort latestItems so the most recently updated are strictly first
    latestItems.sort((a, b) => {
      const ta = a.modified?.time ? new Date(a.modified.time).getTime() : 0;
      const tb = b.modified?.time ? new Date(b.modified.time).getTime() : 0;
      return tb - ta;
    });

    const hero = latestItems.slice(0, 6).map(m => ({
      name: m.name,
      slug: m.slug,
      origin_name: m.origin_name,
      poster_url: m.poster_url,
      thumb_url: m.thumb_url,
      year: m.year,
      quality: m.quality || '4K Ultra HD',
      episode_current: m.episode_current || 'Bản Chiếu Rạp'
    }));

    const updatedAt = new Date().toISOString();
    const responseData = {
      hero,
      updatedAt,
      sections: [
        { id: 'latest', title: '🔥 PHIM MỚI CẬP NHẬT HÔM NAY (HOT NHẤT)', items: latestItems.slice(0, 18) },
        { id: 'movies', title: '🎬 PHIM LẺ TUYỂN CHỌN (4K ULTRA HD)', items: movieItems },
        { id: 'series', title: '📺 PHIM BỘ ĐANG THỊNH HÀNH', items: seriesItems },
        { id: 'anime', title: '✨ ANIME & HOẠT HÌNH BOM TẤN', items: animeItems }
      ]
    };

    movieFeedState.lastSuccessfulRefreshAt = updatedAt;
    movieFeedState.lastRefreshError = null;
    setCache('home_feed_v2', responseData, 60); // 60s fast refresh
    res.json(responseData);
  } catch (err) {
    movieFeedState.lastRefreshError = new Date().toISOString();
    console.error('Home feed error:', err);
    res.status(500).json({ error: 'Failed to fetch home feed', details: err.message });
  }
});

// Category feed
app.get('/api/movies/category/:category', requireLicenseKey, async (req, res) => {
  const { category } = req.params;
  const page = req.query.page || 1;
  const cacheKey = `cat_${category}_p${page}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    let url = '';
    if (category === 'phim-moi-cap-nhat') {
      url = movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, `/danh-sach/phim-moi-cap-nhat?page=${page}`);
    } else {
      url = movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, `/v1/api/danh-sach/${category}?page=${page}&limit=24`);
    }

    const data = await fetchJson(url);
    const items = category === 'phim-moi-cap-nhat' ? (data.items || []) : (data.data?.items || []);
    const pagination = category === 'phim-moi-cap-nhat' ? (data.pagination || {}) : (data.data?.params?.pagination || {});

    const result = { category, page: Number(page), items, pagination };
    setCache(cacheKey, result, 60);
    res.json(result);
  } catch (err) {
    console.error(`Category ${category} error:`, err);
    res.status(500).json({ error: 'Failed to fetch category', details: err.message });
  }
});

// Search movies
app.get('/api/movies/search', requireLicenseKey, async (req, res) => {
  const query = req.query.q;
  const page = req.query.page || 1;
  if (!query) return res.json({ items: [], total: 0 });

  try {
    const encoded = encodeURIComponent(query.trim());
    const url = movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, `/v1/api/tim-kiem?keyword=${encoded}&page=${page}&limit=24`);
    const data = await fetchJson(url);
    const items = data.data?.items || [];
    const pagination = data.data?.params?.pagination || {};
    res.json({ query, items, pagination });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// Movie details & episodes
app.get('/api/movies/detail/:slug', requireLicenseKey, async (req, res) => {
  const { slug } = req.params;
  const cacheKey = `detail_${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [kkRes, nguoncRes] = await Promise.allSettled([
      fetchJson(movieUpstreamUrl(MOVIE_CATALOG_ORIGIN, `/phim/${slug}`)),
      MOVIE_BACKUP_ORIGIN
        ? fetchJson(movieUpstreamUrl(MOVIE_BACKUP_ORIGIN, `/api/film/${slug}`))
        : Promise.reject(new Error('MOVIE_BACKUP_NOT_CONFIGURED'))
    ]);

    if (kkRes.status !== 'fulfilled' || !kkRes.value.status) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const movie = kkRes.value.movie || {};
    const kkEpisodes = kkRes.value.episodes || [];

    const servers = [];
    kkEpisodes.forEach((server, sIdx) => {
      const serverLabel = server.server_name || `Server ${sIdx + 1}`;
      servers.push({
        id: `kk_${sIdx}`,
        server_name: `⚡ Server #${sIdx + 1} (${serverLabel} - HLS 4K)`,
        type: 'hls',
        server_data: (server.server_data || []).map(ep => ({
          name: ep.name,
          slug: ep.slug,
          filename: ep.filename,
          link_embed: ep.link_embed,
          link_m3u8: ep.link_m3u8
        }))
      });
    });

    if (nguoncRes.status === 'fulfilled' && nguoncRes.value?.status === 'success') {
      const ncEpisodes = nguoncRes.value.movie?.episodes || [];
      ncEpisodes.forEach((ncServer, ncIdx) => {
        const ncItems = ncServer.items || [];
        if (ncItems.length > 0) {
          servers.push({
            id: `nc_${ncIdx}`,
            server_name: `🛡️ Server Dự Phòng #${servers.length + 1} (${ncServer.server_name || 'NguonC Backup'})`,
            type: ncItems[0].m3u8 ? 'hls' : 'embed',
            server_data: ncItems.map(item => ({
              name: item.name,
              slug: item.slug,
              filename: item.filename,
              link_embed: item.embed,
              link_m3u8: item.m3u8 || item.embed
            }))
          });
        }
      });
    }

    const result = {
      movie: {
        id: movie._id || movie.id,
        name: movie.name,
        origin_name: movie.origin_name,
        slug: movie.slug,
        content: movie.content,
        type: movie.type,
        status: movie.status,
        thumb_url: movie.thumb_url,
        poster_url: movie.poster_url,
        trailer_url: movie.trailer_url,
        time: movie.time,
        episode_current: movie.episode_current,
        episode_total: movie.episode_total,
        quality: movie.quality || '4K Ultra HD',
        lang: movie.lang,
        year: movie.year,
        actor: movie.actor,
        director: movie.director,
        category: movie.category,
        country: movie.country
      },
      episodes: servers
    };

    setCache(cacheKey, result, 300);
    res.json(result);
  } catch (err) {
    console.error(`Detail error for ${slug}:`, err);
    res.status(500).json({ error: 'Failed to fetch details', details: err.message });
  }
});

// The old client-controlled stream proxy is permanently retired. Playback is
// resolved server-side and fetched only by the allowlisted, signed relay.
app.get('/api/stream/proxy', requireLicenseKey, async (req, res) => {
  return res.status(410).json({
    error: 'LEGACY_STREAM_PROXY_RETIRED',
    message: 'Use the authenticated media relay.'
  });
});

// ==========================================
// 7. APP DOWNLOAD & UPDATE ENDPOINTS (ADR, IPA, EXE)
// ==========================================

app.get('/api/app/downloads', (req, res) => {
  const cfg = loadDownloadsConfig();
  res.json(cfg);
});

app.post('/api/admin/update-downloads', requireAdmin, (req, res) => {
  const { androidUrl, iosUrl, windowsUrl, androidVersion, iosVersion, windowsVersion } = req.body;
  const cfg = loadDownloadsConfig();

  if (androidUrl !== undefined) cfg.android.url = androidUrl.trim();
  if (androidVersion !== undefined) cfg.android.version = androidVersion.trim();
  cfg.android.updatedAt = new Date().toISOString();

  if (iosUrl !== undefined) cfg.ios.url = iosUrl.trim();
  if (iosVersion !== undefined) cfg.ios.version = iosVersion.trim();
  cfg.ios.updatedAt = new Date().toISOString();

  if (windowsUrl !== undefined) cfg.windows.url = windowsUrl.trim();
  if (windowsVersion !== undefined) cfg.windows.version = windowsVersion.trim();
  cfg.windows.updatedAt = new Date().toISOString();

  saveDownloadsConfig(cfg);
  addLog('ADMIN', 'DOWNLOADS_UPDATED', `Cập nhật link tải: Android [${cfg.android.url}], iOS [${cfg.ios.url}], Windows [${cfg.windows.url}]`);

  res.json({ success: true, message: 'Đã cập nhật cấu hình link tải 3 phiên bản thành công!', downloads: cfg });
});

// Admin toggle / configure Force Update (Block outdated versions)
app.post('/api/admin/set-force-update', requireAdmin, (req, res) => {
  const { enabled, minVersion, latestVersion, message } = req.body;
  const cfg = loadDownloadsConfig();
  if (!cfg.forceUpdate) cfg.forceUpdate = {};

  if (enabled !== undefined) cfg.forceUpdate.enabled = Boolean(enabled);
  if (minVersion !== undefined) cfg.forceUpdate.minVersion = String(minVersion).trim();
  if (latestVersion !== undefined) cfg.forceUpdate.latestVersion = String(latestVersion).trim();
  if (message !== undefined) cfg.forceUpdate.message = String(message).trim();

  saveDownloadsConfig(cfg);
  addLog('ADMIN', 'FORCE_UPDATE_CONFIG', `Cập nhật Force Update: ${cfg.forceUpdate.enabled ? 'BẬT (Khóa bản cũ)' : 'TẮT'}, Bản tối thiểu: ${cfg.forceUpdate.minVersion}`);

  res.json({
    success: true,
    message: `Đã ${cfg.forceUpdate.enabled ? 'BẬT' : 'TẮT'} chế độ chặn phiên bản cũ thành công!`,
    forceUpdate: cfg.forceUpdate
  });
});

// Check update endpoint for client
app.get('/api/app/check-update', (req, res) => {
  const clientVersion = req.query.version || req.headers['x-app-version'] || '3.0.0';
  const dlConfig = loadDownloadsConfig();
  const force = dlConfig.forceUpdate || { enabled: false, minVersion: '3.0.0', latestVersion: '3.0.0' };
  const latest = force.latestVersion || '3.0.0';
  const isLatest = compareVersions(clientVersion, latest) >= 0;
  const isBlocked = force.enabled && compareVersions(clientVersion, force.minVersion) < 0;

  res.json({
    clientVersion,
    latestVersion: latest,
    minVersion: force.minVersion,
    isLatest,
    forceUpdate: isBlocked,
    message: isBlocked ? (force.message || 'Phiên bản của bạn đã cũ, bắt buộc cập nhật!') : (isLatest ? 'Bạn đang sử dụng phiên bản mới nhất (v' + latest + '). Không có bản cập nhật nào mới hơn!' : 'Đã có bản cập nhật mới (v' + latest + ')! Vui lòng tải bản mới.'),
    downloads: dlConfig
  });
});

app.get('/api/app/version', (req, res) => {
  const cfg = loadDownloadsConfig();
  res.json({
    version: '3.1.0',
    build: 1000,
    channel: 'Cinema VIP',
    releaseDate: '2026-09-04',
    downloads: cfg
  });
});

app.get('/download/apk', (req, res) => {
  const cfg = loadDownloadsConfig();
  const url = cfg.android?.url || '/download/apk';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return res.redirect(url);
  }

  const apkPath = path.join(__dirname, '..', 'Phim4K_Cinema_v3.1.0.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'Phim4K_Cinema_v3.1.0.apk');
  } else {
    res.status(404).send('Bản cài đặt Android (APK) chưa sẵn sàng.');
  }
});

app.get('/download/ipa', (req, res) => {
  const cfg = loadDownloadsConfig();
  const url = cfg.ios?.url || '/download/ipa';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return res.redirect(url);
  }

  const ipaPath = path.join(__dirname, '..', 'Phim4K_v3.1.0_VIP_Cinema.ipa');
  if (fs.existsSync(ipaPath)) {
    res.download(ipaPath, 'Phim4K_v3.1.0_VIP_Cinema.ipa');
  } else {
    res.status(404).send('Bản cài đặt iOS (IPA) chưa sẵn sàng.');
  }
});

app.get('/download/exe', (req, res) => {
  const cfg = loadDownloadsConfig();
  const url = cfg.windows?.url || '/download/exe';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return res.redirect(url);
  }

  const exePath = path.join(__dirname, '..', 'Phim4K_Cinema.exe');
  if (fs.existsSync(exePath)) {
    res.download(exePath, 'Phim4K_Cinema.exe');
  } else {
    res.status(404).send('Bản cài đặt Windows (EXE) chưa sẵn sàng.');
  }
});

app.get('/download/ios', (req, res) => {
  const configPath = path.join(__dirname, '..', 'Phim4K_iOS_Installer.mobileconfig');
  if (fs.existsSync(configPath)) {
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.download(configPath, 'Phim4K_iOS_Installer.mobileconfig');
  } else {
    res.status(404).send('Hồ sơ cấu hình iOS chưa sẵn sàng.');
  }
});

// Direct route for Admin Panel
app.get('/admin', (req, res) => {
  res.redirect('/?admin=1');
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Keep parser and application internals out of client responses.
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  const isMalformedJson = err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body');
  const status = isMalformedJson ? 400 : (Number.isInteger(err.status) ? err.status : 500);
  console.error(`[HTTP_ERROR] ${status} ${err.name}: ${err.message}`);
  res.status(status).json({
    error: isMalformedJson ? 'INVALID_JSON' : 'INTERNAL_ERROR',
    message: isMalformedJson ? 'Dữ liệu gửi lên không đúng định dạng JSON.' : 'Máy chủ gặp lỗi khi xử lý yêu cầu.'
  });
});

app.listen(PORT, BIND_HOST, () => {
  console.log(`=====================================================`);
  console.log(`🎬 Phim4K Ultra Engine running with Anti-DDoS & Logs!`);
  console.log(`🔗 Local Address: http://${BIND_HOST}:${PORT}`);
  console.log(`👑 Super Admin controls enabled`);
  console.log(`=====================================================`);
});
