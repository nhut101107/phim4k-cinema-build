const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, x-license-key, x-telegram-id, x-device-id, x-app-version",
  "access-control-expose-headers": "retry-after",
  "access-control-max-age": "86400",
};

const MAX_DURATION_DAYS = 3650;
const LICENSE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,63}$/;
const MASTER_KEY_MIN_LENGTH = 12;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const ADMIN_KEY_HASH_SETTING = "admin_key_hmac_v1";
const RATE_LIMITS = Object.freeze({
  authActivate: { limit: 20, windowSeconds: 60 },
  authStatus: { limit: 120, windowSeconds: 60 },
  admin: { limit: 30, windowSeconds: 60 },
  default: { limit: 240, windowSeconds: 60 },
});

// These are deliberately narrow catalog/media relays, not open proxies.
// Native WebViews cannot reliably call every catalog asset host directly.
// Only known public metadata routes and image paths on one exact host are
// allowed; video streams, arbitrary hosts and arbitrary paths are never
// forwarded.
const MOVIE_CATALOG_ORIGIN = "https://phimapi.com";
const MOVIE_IMAGE_HOSTS = new Set(["phimimg.com"]);
const MOVIE_CATALOG_CATEGORIES = new Set([
  "phim-moi-cap-nhat", "phim-le", "phim-bo", "hoat-hinh", "tv-shows",
]);
const MOVIE_FILTER_GENRES = new Set([
  "bi-an", "chien-tranh", "chinh-kich", "co-trang", "gia-dinh", "hai-huoc",
  "hanh-dong", "hinh-su", "hoc-duong", "khoa-hoc", "kinh-di", "kinh-dien",
  "lich-su", "mien-tay", "phim-18", "phim-ngan", "phieu-luu", "than-thoai",
  "the-thao", "tre-em", "tai-lieu", "tam-ly", "tinh-cam", "vien-tuong",
  "vo-thuat", "am-nhac", "hoat-hinh",
]);
const MOVIE_FILTER_COUNTRIES = new Set([
  "anh", "ba-lan", "brazil", "bo-dao-nha", "canada", "chau-phi", "ha-lan",
  "han-quoc", "hong-kong", "indonesia", "malaysia", "mexico", "na-uy",
  "nam-phi", "nga", "nhat-ban", "philippines", "phap", "quoc-gia-khac",
  "thai-lan", "tho-nhi-ky", "thuy-si", "thuy-dien", "trung-quoc",
  "tay-ban-nha", "uae", "ukraina", "viet-nam", "au-my", "uc", "y",
  "dan-mach", "dai-loan", "duc", "a-rap-xe-ut", "an-do",
]);

const now = () => new Date().toISOString();

export function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extraHeaders },
  });
}

function textError(message, status = 400, code = "BAD_REQUEST") {
  return json({ success: false, active: false, code, error: message, message }, status);
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeId(value) {
  return String(value || "").trim().slice(0, 128);
}

function validKey(value) {
  return LICENSE_PATTERN.test(value);
}

function validMasterKey(value) {
  return validKey(value) && value.length >= MASTER_KEY_MIN_LENGTH;
}

function validTelegramId(value) {
  return /^\d{5,20}$/.test(value);
}

function isExpired(expiresAt) {
  return Boolean(expiresAt) && Date.parse(expiresAt) <= Date.now();
}

function numericDays(value) {
  const days = Number.parseInt(String(value), 10);
  return Number.isInteger(days) && days > 0 && days <= MAX_DURATION_DAYS ? days : null;
}

function plusDays(iso, days) {
  const base = iso && Date.parse(iso) > Date.now() ? new Date(iso) : new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function appVersion(request) {
  return request.headers.get("x-app-version") || "unknown";
}

export function compareAppVersions(left, right) {
  const parse = (value) => String(value || "")
    .split(".")
    .slice(0, 4)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length, 1);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function requestKey(request) {
  return normalizeKey(request.headers.get("x-license-key"));
}

function requestTelegram(request) {
  return normalizeId(request.headers.get("x-telegram-id"));
}

function equalString(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function isMasterKey(key, env) {
  return Boolean(env.ADMIN_LICENSE_KEY) && equalString(key, String(env.ADMIN_LICENSE_KEY));
}

function isAdmin(request, env) {
  const key = requestKey(request);
  if (!isMasterKey(key, env)) return false;
  const configuredTelegram = normalizeId(env.ADMIN_TELEGRAM_ID);
  return !configuredTelegram || equalString(requestTelegram(request), configuredTelegram);
}

async function requireAdmin(request, env) {
  return isAdmin(request, env) ? null : textError("Không có quyền quản trị.", 403, "ADMIN_REQUIRED");
}

function getClientIp(request) {
  // Cloudflare supplies this header from the edge. Do not trust X-Forwarded-For.
  return String(request.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);
}

function ratePolicy(pathname) {
  if (pathname === "/api/auth/activate" || pathname === "/api/auth/request-device-access") return RATE_LIMITS.authActivate;
  if (pathname === "/api/auth/status" || pathname === "/api/auth/device-status") return RATE_LIMITS.authStatus;
  if (pathname.startsWith("/api/admin/")) return RATE_LIMITS.admin;
  return RATE_LIMITS.default;
}

function distributedRateBinding(pathname, env) {
  if (pathname === "/api/auth/activate" || pathname === "/api/auth/request-device-access") return env.ACTIVATION_RATE_LIMITER;
  if (pathname === "/api/auth/status" || pathname === "/api/auth/device-status") return env.STATUS_RATE_LIMITER;
  if (pathname.startsWith("/api/admin/")) return env.ADMIN_RATE_LIMITER;
  return env.PUBLIC_RATE_LIMITER;
}

function distributedRateKey(request, pathname) {
  const ip = getClientIp(request);
  // Activation and administrative attempts are limited by edge IP. Status
  // checks use a stable identity so carrier NATs do not throttle viewers.
  if (pathname === "/api/auth/status" || pathname === "/api/auth/device-status") {
    return `status:${requestKey(request) || requestTelegram(request) || ip}`;
  }
  return `${pathname}:${ip}`;
}

async function distributedRetryAfter(request, pathname, env) {
  const binding = distributedRateBinding(pathname, env);
  if (!binding || typeof binding.limit !== "function") return null;
  try {
    const result = await binding.limit({ key: distributedRateKey(request, pathname) });
    return result?.success === false ? ratePolicy(pathname).windowSeconds : null;
  } catch (_error) {
    // Keep the short-lived limiter active if the edge binding has a transient error.
    return null;
  }
}

export function createRateLimiter() {
  const buckets = new Map();
  let lastSweep = 0;
  return (request, pathname, timestamp = Date.now()) => {
    const policy = ratePolicy(pathname);
    const key = `${getClientIp(request)}:${pathname}`;
    const existing = buckets.get(key);
    const windowMs = policy.windowSeconds * 1000;
    const bucket = !existing || timestamp >= existing.resetAt
      ? { count: 0, resetAt: timestamp + windowMs }
      : existing;
    bucket.count += 1;
    buckets.set(key, bucket);

    if (timestamp - lastSweep > windowMs || buckets.size > 2048) {
      lastSweep = timestamp;
      for (const [bucketKey, value] of buckets) {
        if (timestamp >= value.resetAt) buckets.delete(bucketKey);
      }
    }

    if (bucket.count <= policy.limit) return null;
    return Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
  };
}

const rateLimit = createRateLimiter();
let rateLimitBlocked = 0;

function contentLengthTooLarge(request) {
  const length = Number.parseInt(request.headers.get("content-length") || "0", 10);
  return Number.isFinite(length) && length > MAX_JSON_BODY_BYTES;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function adminKeyDigest(key, env) {
  if (!env.ADMIN_KEY_PEPPER) return "";
  const encoded = new TextEncoder().encode(`${normalizeKey(key)}:${env.ADMIN_KEY_PEPPER}`);
  return toHex(await crypto.subtle.digest("SHA-256", encoded));
}

async function configuredAdminKeyHash(db) {
  const row = await queryOne(db, "SELECT setting_value FROM app_settings WHERE setting_key = ?", ADMIN_KEY_HASH_SETTING);
  return row ? String(row.setting_value || "") : "";
}

async function verifyMasterKey(key, env, db) {
  if (!key) return false;
  const storedHash = await configuredAdminKeyHash(db);
  if (storedHash) {
    const candidateHash = await adminKeyDigest(key, env);
    return Boolean(candidateHash) && equalString(candidateHash, storedHash);
  }
  return Boolean(env.ADMIN_LICENSE_KEY) && equalString(normalizeKey(key), normalizeKey(env.ADMIN_LICENSE_KEY));
}

async function verifyAdminIdentity(key, telegramId, env, db) {
  const configuredTelegram = normalizeId(env.ADMIN_TELEGRAM_ID);
  return Boolean(configuredTelegram)
    && equalString(normalizeId(telegramId), configuredTelegram)
    && await verifyMasterKey(normalizeKey(key), env, db);
}

async function verifyAdmin(request, env, db) {
  return verifyAdminIdentity(requestKey(request), requestTelegram(request), env, db);
}

async function requireVerifiedAdmin(request, env) {
  const missing = dbUnavailable(env);
  if (missing) return missing;
  return await verifyAdmin(request, env, env.DB) ? null : textError("Admin authorization required.", 403, "ADMIN_REQUIRED");
}

async function parseBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch (_error) {
    return {};
  }
}

async function queryOne(db, statement, ...values) {
  return db.prepare(statement).bind(...values).first();
}

async function logEvent(db, action, { actorTelegramId = "", targetKey = "", targetTelegramId = "", detail = "" } = {}) {
  try {
    await db.prepare(
      "INSERT INTO audit_logs (created_at, action, actor_telegram_id, target_key, target_telegram_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(now(), action, actorTelegramId, targetKey, targetTelegramId, String(detail).slice(0, 500)).run();
  } catch (_error) {
    // Audit logging must not turn an otherwise valid authorization result into a failure.
  }
}

function dbUnavailable(env) {
  return !env.DB ? textError("Backend chưa được gắn D1 database.", 503, "DATABASE_NOT_CONFIGURED") : null;
}

function keyPayload(record, isAdminUser = false) {
  if (!record) return null;
  const active = Boolean(record.active) && !isExpired(record.expires_at);
  return {
    key: record.license_key,
    plan: record.plan,
    active,
    isExpired: Boolean(record.expires_at) && isExpired(record.expires_at),
    isAdmin: false,
    expiresAt: record.expires_at || null,
    boundTelegramId: record.activated_telegram_id || record.assigned_telegram_id || "",
    boundDeviceId: isAdminUser ? (record.device_id || "") : undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function getForceUpdate(db, version) {
  const row = await queryOne(db, "SELECT setting_value FROM app_settings WHERE setting_key = ?", "force_update");
  if (!row) return { forceUpdate: false, isLatest: true, message: "Bạn đang dùng phiên bản mới nhất." };
  try {
    const setting = JSON.parse(row.setting_value);
    const enabled = Boolean(setting.enabled);
    const minVersion = String(setting.minVersion || "").trim();
    const forceUpdate = enabled && minVersion && compareAppVersions(version, minVersion) < 0;
    return {
      forceUpdate,
      isLatest: !forceUpdate,
      latestVersion: setting.latestVersion || "",
      minVersion,
      message: forceUpdate ? (setting.message || "Vui lòng cập nhật ứng dụng để tiếp tục.") : "Bạn đang dùng phiên bản mới nhất.",
    };
  } catch (_error) {
    return { forceUpdate: false, isLatest: true, message: "Bạn đang dùng phiên bản mới nhất." };
  }
}

async function activationStatus({ db, key, telegramId, deviceId, request, env, activation }) {
  if (!key || !telegramId || !deviceId) return textError("Thiếu key, Telegram ID hoặc mã thiết bị.", 400, "MISSING_LICENSE_DATA");
  if (!validTelegramId(telegramId)) return textError("Telegram ID is invalid.", 400, "INVALID_TELEGRAM_ID");
  if (await verifyMasterKey(key, env, db)) {
    if (!await verifyAdminIdentity(key, telegramId, env, db)) {
      return textError("Master key is restricted to the configured administrator Telegram ID.", 403, "ADMIN_TELEGRAM_REQUIRED");
    }
    const force = await getForceUpdate(db, appVersion(request));
    return json({ success: true, active: true, isAdmin: true, plan: "MASTER", expiresAt: null, ...(activation ? { key, telegramId } : {}), ...force });
  }
  if (!validKey(key)) return textError("Định dạng key không hợp lệ.", 400, "INVALID_KEY_FORMAT");

  const ban = await queryOne(db, "SELECT reason FROM bans WHERE telegram_id = ?", telegramId);
  if (ban) return textError(ban.reason || "Tài khoản Telegram này đã bị khóa.", 403, "USER_BANNED");

  const record = await queryOne(db, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record) return textError("Key không tồn tại.", 404, "KEY_NOT_FOUND");
  if (!record.active) return textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED");
  if (isExpired(record.expires_at)) return textError("Key đã hết hạn.", 403, "KEY_EXPIRED");
  if (record.assigned_telegram_id && record.assigned_telegram_id !== telegramId) {
    return textError("Key này được gán cho Telegram khác.", 403, "TELEGRAM_MISMATCH");
  }
  if (record.activated_telegram_id && record.activated_telegram_id !== telegramId) {
    return textError("Key đã được kích hoạt với Telegram khác.", 403, "TELEGRAM_MISMATCH");
  }
  if (record.device_id && record.device_id !== deviceId) {
    return textError("Key đã được khóa với thiết bị khác. Liên hệ quản trị để reset.", 403, "DEVICE_MISMATCH");
  }

  if (activation && (!record.activated_telegram_id || !record.device_id)) {
    await db.prepare(
      "UPDATE license_keys SET activated_telegram_id = COALESCE(activated_telegram_id, ?), device_id = COALESCE(device_id, ?), updated_at = ? WHERE license_key = ?",
    ).bind(telegramId, deviceId, now(), key).run();
    await logEvent(db, "license_activated", { targetKey: key, targetTelegramId: telegramId, detail: `version=${appVersion(request)}` });
  }

  const force = await getForceUpdate(db, appVersion(request));
  return json({ success: true, active: true, isAdmin: false, plan: record.plan, expiresAt: record.expires_at || null, ...(activation ? { key, telegramId } : {}), ...force });
}

async function ensureDeviceAccessTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS device_access_requests (license_key TEXT NOT NULL, device_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), requested_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, PRIMARY KEY (license_key, device_id), FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE)",
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_device_access_status ON device_access_requests(status, requested_at)").run();
}

function maskedValue(value, visible = 4) {
  const text = String(value || "");
  if (text.length <= visible * 2) return `${text.slice(0, 2)}••••`;
  return `${text.slice(0, visible)}••••${text.slice(-visible)}`;
}

async function notifyDeviceRequest(env, key, deviceId) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = normalizeId(env.ADMIN_TELEGRAM_ID);
  if (!token || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Phim4K: Có yêu cầu đăng nhập không Telegram.\nKey: ${maskedValue(key)}\nThiết bị: ${maskedValue(deviceId, 6)}\nMở Panel Admin > Yêu cầu thiết bị để duyệt.`,
      }),
    });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

async function requestDeviceAccess(request, env) {
  const body = await parseBody(request);
  const key = normalizeKey(body.key);
  const deviceId = normalizeId(body.deviceId);
  if (!validKey(key) || !deviceId) return textError("Nhập key hợp lệ để gửi yêu cầu cho Admin.", 400, "INVALID_DEVICE_REQUEST");
  if (await verifyMasterKey(key, env, env.DB)) return textError("Key Admin bắt buộc dùng Telegram ID quản trị.", 403, "ADMIN_TELEGRAM_REQUIRED");

  const record = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record) return textError("Key không tồn tại.", 404, "KEY_NOT_FOUND");
  if (!record.active) return textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED");
  if (isExpired(record.expires_at)) return textError("Key đã hết hạn.", 403, "KEY_EXPIRED");

  await ensureDeviceAccessTable(env.DB);
  await env.DB.prepare(
    "INSERT INTO device_access_requests (license_key, device_id, status, requested_at) VALUES (?, ?, 'pending', ?) ON CONFLICT(license_key, device_id) DO UPDATE SET status = CASE WHEN device_access_requests.status = 'approved' THEN 'approved' ELSE 'pending' END, requested_at = CASE WHEN device_access_requests.status = 'approved' THEN device_access_requests.requested_at ELSE excluded.requested_at END, decided_at = CASE WHEN device_access_requests.status = 'approved' THEN device_access_requests.decided_at ELSE NULL END, decided_by = CASE WHEN device_access_requests.status = 'approved' THEN device_access_requests.decided_by ELSE NULL END",
  ).bind(key, deviceId, now()).run();
  const existing = await queryOne(env.DB, "SELECT status FROM device_access_requests WHERE license_key = ? AND device_id = ?", key, deviceId);
  if (existing?.status === "approved" && record.device_id === deviceId) {
    return json({ success: true, status: "approved", message: "Thiết bị đã được Admin cấp phép." });
  }
  const notified = await notifyDeviceRequest(env, key, deviceId);
  await logEvent(env.DB, "device_access_requested", { targetKey: key, detail: `device=${maskedValue(deviceId, 6)} notified=${notified}` });
  return json({ success: true, status: "pending", notified, message: notified ? "Đã báo Admin. Ứng dụng sẽ tự kiểm tra trạng thái duyệt." : "Đã gửi yêu cầu vào Panel Admin. Ứng dụng sẽ tự kiểm tra trạng thái duyệt." });
}

async function deviceAccessStatus(request, env) {
  const url = new URL(request.url);
  const key = normalizeKey(url.searchParams.get("key"));
  const deviceId = normalizeId(url.searchParams.get("deviceId"));
  if (!validKey(key) || !deviceId) return textError("Thiếu key hoặc mã thiết bị.", 400, "MISSING_DEVICE_LICENSE_DATA");
  await ensureDeviceAccessTable(env.DB);
  const approval = await queryOne(env.DB, "SELECT status FROM device_access_requests WHERE license_key = ? AND device_id = ?", key, deviceId);
  if (!approval) return json({ success: true, active: false, status: "none", message: "Chưa gửi yêu cầu cấp phép." });
  if (approval.status !== "approved") {
    return json({ success: true, active: false, status: approval.status, message: approval.status === "rejected" ? "Admin đã từ chối yêu cầu." : "Đang chờ Admin duyệt." });
  }
  const record = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record) return textError("Key không tồn tại.", 404, "KEY_NOT_FOUND");
  if (!record.active) return textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED");
  if (isExpired(record.expires_at)) return textError("Key đã hết hạn.", 403, "KEY_EXPIRED");
  if (record.device_id !== deviceId) return textError("Quyền thiết bị đã thay đổi. Hãy gửi yêu cầu mới.", 403, "DEVICE_MISMATCH");
  const force = await getForceUpdate(env.DB, appVersion(request));
  return json({ success: true, active: true, status: "approved", deviceOnly: true, isAdmin: false, plan: record.plan, expiresAt: record.expires_at || null, key, ...force });
}

async function listDeviceAccessRequests(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  await ensureDeviceAccessTable(env.DB);
  const rows = await env.DB.prepare(
    "SELECT r.license_key, r.device_id, r.status, r.requested_at, r.decided_at, k.plan, k.expires_at, k.active FROM device_access_requests r JOIN license_keys k ON k.license_key = r.license_key ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.requested_at DESC LIMIT 100",
  ).all();
  return json({ requests: rows.results || [] });
}

async function decideDeviceAccess(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const body = await parseBody(request);
  const key = normalizeKey(body.key);
  const deviceId = normalizeId(body.deviceId);
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
  if (!validKey(key) || !deviceId || !decision) return textError("Yêu cầu duyệt không hợp lệ.", 400, "INVALID_DECISION");
  await ensureDeviceAccessTable(env.DB);
  const pending = await queryOne(env.DB, "SELECT status FROM device_access_requests WHERE license_key = ? AND device_id = ?", key, deviceId);
  if (!pending) return textError("Không tìm thấy yêu cầu thiết bị.", 404, "REQUEST_NOT_FOUND");
  const timestamp = now();
  if (decision === "approved") {
    const record = await queryOne(env.DB, "SELECT active, expires_at FROM license_keys WHERE license_key = ?", key);
    if (!record || !record.active || isExpired(record.expires_at)) return textError("Key không còn hoạt động.", 403, "KEY_INACTIVE");
    await env.DB.prepare("UPDATE license_keys SET device_id = ?, updated_at = ? WHERE license_key = ?").bind(deviceId, timestamp, key).run();
  }
  await env.DB.prepare("UPDATE device_access_requests SET status = ?, decided_at = ?, decided_by = ? WHERE license_key = ? AND device_id = ?").bind(decision, timestamp, requestTelegram(request), key, deviceId).run();
  await logEvent(env.DB, `device_access_${decision}`, { actorTelegramId: requestTelegram(request), targetKey: key, detail: `device=${maskedValue(deviceId, 6)}` });
  return json({ success: true, status: decision });
}

async function listKeys(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const rows = await env.DB.prepare("SELECT * FROM license_keys ORDER BY created_at DESC").all();
  const keys = (rows.results || []).map((item) => keyPayload(item, true));
  const banCount = await queryOne(env.DB, "SELECT COUNT(*) AS total FROM bans");
  return json({
    keys,
    stats: {
      totalKeys: keys.length,
      activeKeys: keys.filter((item) => item.active).length,
      boundDevices: keys.filter((item) => item.boundDeviceId).length,
      bannedUsersCount: Number(banCount?.total || 0),
      // This is per Worker isolate. Cloudflare's edge is the primary DDoS layer.
      ddosBlockedCount: rateLimitBlocked,
    },
  });
}

async function createKey(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const body = await parseBody(request);
  const key = normalizeKey(body.key);
  const durationDays = numericDays(body.durationDays);
  const assignedTelegramId = normalizeId(body.assignedTelegramId);
  if (!validKey(key)) return textError("Key phải gồm chữ in hoa, số hoặc dấu gạch ngang.", 400, "INVALID_KEY_FORMAT");
  if (!durationDays) return textError("Thời hạn key phải từ 1 đến 3650 ngày.", 400, "INVALID_DURATION");
  if (assignedTelegramId && !validTelegramId(assignedTelegramId)) return textError("Telegram ID is invalid.", 400, "INVALID_TELEGRAM_ID");
  const createdAt = now();
  try {
    await env.DB.prepare(
      "INSERT INTO license_keys (license_key, plan, expires_at, active, assigned_telegram_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    ).bind(key, String(body.plan || "STANDARD").trim().slice(0, 64) || "STANDARD", plusDays(null, durationDays), assignedTelegramId, createdAt, createdAt).run();
  } catch (_error) {
    return textError("Key đã tồn tại.", 409, "KEY_ALREADY_EXISTS");
  }
  await logEvent(env.DB, "key_created", { actorTelegramId: requestTelegram(request), targetKey: key, detail: `days=${durationDays}` });
  return json({ success: true, message: "Đã tạo key mới.", key }, 201);
}

async function updateKey(request, env, operation) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const body = await parseBody(request);
  const key = normalizeKey(body.key);
  if (!validKey(key)) return textError("Key không hợp lệ.", 400, "INVALID_KEY_FORMAT");
  const row = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!row) return textError("Không tìm thấy key.", 404, "KEY_NOT_FOUND");
  const timestamp = now();
  let message;
  if (operation === "renew") {
    const days = numericDays(body.addDays);
    if (!days) return textError("Số ngày gia hạn không hợp lệ.", 400, "INVALID_DURATION");
    await env.DB.prepare("UPDATE license_keys SET expires_at = ?, updated_at = ? WHERE license_key = ?").bind(plusDays(row.expires_at, days), timestamp, key).run();
    message = "Đã gia hạn key.";
  } else if (operation === "expiry") {
    let expiresAt = null;
    if (body.isLifetime) expiresAt = null;
    else if (body.addDays !== undefined) {
      const days = numericDays(body.addDays);
      if (!days) return textError("Số ngày gia hạn không hợp lệ.", 400, "INVALID_DURATION");
      expiresAt = plusDays(row.expires_at, days);
    } else {
      const parsed = Date.parse(String(body.expiresAt || ""));
      if (Number.isNaN(parsed) || parsed <= Date.now()) return textError("Ngày hết hạn không hợp lệ.", 400, "INVALID_EXPIRY");
      expiresAt = new Date(parsed).toISOString();
    }
    await env.DB.prepare("UPDATE license_keys SET expires_at = ?, updated_at = ? WHERE license_key = ?").bind(expiresAt, timestamp, key).run();
    message = "Đã cập nhật hạn key.";
  } else if (operation === "toggle") {
    await env.DB.prepare("UPDATE license_keys SET active = ?, updated_at = ? WHERE license_key = ?").bind(row.active ? 0 : 1, timestamp, key).run();
    message = "Đã đổi trạng thái key.";
  } else if (operation === "reset-device") {
    await env.DB.prepare("UPDATE license_keys SET device_id = NULL, updated_at = ? WHERE license_key = ?").bind(timestamp, key).run();
    message = "Đã reset thiết bị.";
  } else if (operation === "reset-telegram") {
    const newTelegramId = normalizeId(body.newTelegramId);
    if (newTelegramId && !validTelegramId(newTelegramId)) return textError("Telegram ID is invalid.", 400, "INVALID_TELEGRAM_ID");
    await env.DB.prepare("UPDATE license_keys SET assigned_telegram_id = ?, activated_telegram_id = NULL, updated_at = ? WHERE license_key = ?").bind(newTelegramId, timestamp, key).run();
    message = "Đã cập nhật Telegram cho key.";
  } else if (operation === "delete") {
    await env.DB.prepare("DELETE FROM license_keys WHERE license_key = ?").bind(key).run();
    message = "Đã xóa key.";
  } else {
    return textError("Thao tác key không được hỗ trợ.", 404, "UNKNOWN_KEY_OPERATION");
  }
  await logEvent(env.DB, `key_${operation}`, { actorTelegramId: requestTelegram(request), targetKey: key });
  return json({ success: true, message });
}

async function listUsers(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const rows = await env.DB.prepare(
    "SELECT license_keys.*, bans.telegram_id AS banned_telegram_id FROM license_keys LEFT JOIN bans ON bans.telegram_id = COALESCE(license_keys.activated_telegram_id, license_keys.assigned_telegram_id) WHERE license_keys.activated_telegram_id IS NOT NULL OR license_keys.assigned_telegram_id IS NOT NULL ORDER BY license_keys.updated_at DESC",
  ).all();
  return json({ users: (rows.results || []).map((record) => ({
    telegramId: record.activated_telegram_id || record.assigned_telegram_id || "",
    key: record.license_key,
    plan: record.plan,
    isBanned: Boolean(record.banned_telegram_id),
    active: Boolean(record.active) && !isExpired(record.expires_at),
    expiresAt: record.expires_at || null,
    boundDeviceId: record.device_id || "",
  })) });
}

async function setBan(request, env, banned) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const body = await parseBody(request);
  const telegramId = normalizeId(body.telegramId);
  if (!telegramId) return textError("Thiếu Telegram ID.", 400, "MISSING_TELEGRAM_ID");
  if (!validTelegramId(telegramId)) return textError("Telegram ID is invalid.", 400, "INVALID_TELEGRAM_ID");
  if (banned) {
    const timestamp = now();
    const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.slice(0, 8) : ["telegram"];
    await env.DB.prepare(
      "INSERT INTO bans (telegram_id, scopes_json, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET scopes_json = excluded.scopes_json, reason = excluded.reason, updated_at = excluded.updated_at",
    ).bind(telegramId, JSON.stringify(scopes), String(body.reason || "").slice(0, 300), timestamp, timestamp).run();
    await logEvent(env.DB, "user_banned", { actorTelegramId: requestTelegram(request), targetTelegramId: telegramId, detail: String(body.reason || "") });
    return json({ success: true, message: "Đã khóa người dùng." });
  }
  await env.DB.prepare("DELETE FROM bans WHERE telegram_id = ?").bind(telegramId).run();
  await logEvent(env.DB, "user_unbanned", { actorTelegramId: requestTelegram(request), targetTelegramId: telegramId });
  return json({ success: true, message: "Đã bỏ khóa người dùng." });
}

async function handleLogs(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM audit_logs").run();
    return json({ success: true, message: "Đã xóa nhật ký." });
  }
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);
  const telegramId = normalizeId(url.searchParams.get("telegramId"));
  const statement = telegramId
    ? env.DB.prepare("SELECT * FROM audit_logs WHERE actor_telegram_id = ? OR target_telegram_id = ? ORDER BY id DESC LIMIT ?").bind(telegramId, telegramId, limit)
    : env.DB.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?").bind(limit);
  const result = await statement.all();
  return json({ logs: (result.results || []).map((item) => ({
    id: item.id,
    timestamp: item.created_at,
    createdAt: item.created_at,
    action: item.action,
    actorTelegramId: item.actor_telegram_id || "",
    targetKey: item.target_key || "",
    telegramId: item.target_telegram_id || "",
    detail: item.detail || "",
  })) });
}

async function rotateMasterKey(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  if (!env.ADMIN_KEY_PEPPER) return textError("Admin key rotation is not configured.", 503, "ADMIN_ROTATION_NOT_CONFIGURED");

  const body = await parseBody(request);
  const newKey = normalizeKey(body.newKey);
  if (!validMasterKey(newKey)) {
    return textError(`Admin key must be ${MASTER_KEY_MIN_LENGTH}-64 characters using A-Z, numbers, or hyphens.`, 400, "WEAK_ADMIN_KEY");
  }

  const digest = await adminKeyDigest(newKey, env);
  await env.DB.prepare(
    "INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at",
  ).bind(ADMIN_KEY_HASH_SETTING, digest, now()).run();
  await logEvent(env.DB, "admin_key_rotated", { actorTelegramId: requestTelegram(request), detail: "master-key-hash-updated" });
  return json({ success: true, message: "Admin key updated. Use the new key for the next admin request." });
}

async function handleForceUpdate(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const body = await parseBody(request);
  const value = JSON.stringify({
    enabled: Boolean(body.enabled),
    minVersion: String(body.minVersion || "").trim().slice(0, 64),
    latestVersion: String(body.latestVersion || "").trim().slice(0, 64),
    message: String(body.message || "").trim().slice(0, 400),
  });
  await env.DB.prepare(
    "INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('force_update', ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at",
  ).bind(value, now()).run();
  return json({ success: true, message: "Đã cập nhật chính sách phiên bản." });
}

async function handleDownloads(request, env) {
  const missing = dbUnavailable(env);
  if (missing) return missing;
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM downloads").all();
    const output = {};
    for (const row of rows.results || []) output[row.platform] = { url: row.url, version: row.version };
    return json({
      androidUrl: output.android?.url || "", androidVersion: output.android?.version || "",
      iosUrl: output.ios?.url || "", iosVersion: output.ios?.version || "",
      windowsUrl: output.windows?.url || "", windowsVersion: output.windows?.version || "",
    });
  }
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const body = await parseBody(request);
  const entries = [
    ["android", body.androidUrl, body.androidVersion],
    ["ios", body.iosUrl, body.iosVersion],
    ["windows", body.windowsUrl, body.windowsVersion],
  ];
  const timestamp = now();
  for (const [platform, url, version] of entries) {
    const safeUrl = String(url || "").trim();
    if (safeUrl && !safeUrl.startsWith("https://")) return textError("Link tải phải dùng HTTPS.", 400, "INVALID_DOWNLOAD_URL");
    await env.DB.prepare(
      "INSERT INTO downloads (platform, url, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(platform) DO UPDATE SET url = excluded.url, version = excluded.version, updated_at = excluded.updated_at",
    ).bind(platform, safeUrl, String(version || "").trim().slice(0, 64), timestamp).run();
  }
  return json({ success: true, message: "Đã cập nhật link tải." });
}

async function handleMovieFallback(request) {
  // Movie data remains a client-side fallback. The licensing backend deliberately
  // does not implement an open proxy, which would otherwise allow SSRF abuse.
  return textError("Nguồn phim không được proxy bởi backend bản quyền.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
}

async function handleMovieImage(request) {
  const requestUrl = new URL(request.url);
  const rawTarget = String(requestUrl.searchParams.get("url") || "").trim();
  let target;
  try {
    target = new URL(rawTarget);
  } catch (_error) {
    return textError("URL anh khong hop le.", 400, "INVALID_IMAGE_URL");
  }

  const safePath = target.pathname.startsWith("/upload/") || target.pathname.startsWith("/uploads/");
  if (target.protocol !== "https:" || target.username || target.password || target.port || !MOVIE_IMAGE_HOSTS.has(target.hostname) || !safePath) {
    return textError("Nguon anh khong duoc phep.", 400, "IMAGE_HOST_NOT_ALLOWED");
  }
  target.hash = "";

  const upstream = await fetch(target.href, {
    headers: { accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
    redirect: "manual",
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!upstream.ok) return textError("Khong tai duoc anh phim.", 502, "IMAGE_UPSTREAM_ERROR");
  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) return textError("Nguon tra ve khong phai anh.", 502, "INVALID_IMAGE_RESPONSE");
  const contentLength = Number.parseInt(upstream.headers.get("content-length") || "0", 10) || 0;
  if (contentLength > 6 * 1024 * 1024) return textError("Anh vuot qua gioi han kich thuoc.", 413, "IMAGE_TOO_LARGE");

  const headers = new Headers(CORS_HEADERS);
  headers.set("content-type", contentType);
  headers.set("cache-control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
  headers.set("x-content-type-options", "nosniff");
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);
  return new Response(upstream.body, { status: 200, headers });
}

function catalogPage(value) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 1;
}

function catalogSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,159}$/.test(slug) ? slug : "";
}

function catalogItems(data) {
  return Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data?.items) ? data.data.items : []);
}

async function fetchCatalogJson(path) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://phim4k-license-api.phim4k-pwdbhdz.workers.dev/__catalog_cache${path}`);
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return await cached.json();
    } catch (_error) {
      // A cache miss must never prevent the catalog from loading.
    }
  }
  const response = await fetch(`${MOVIE_CATALOG_ORIGIN}${path}`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 120 },
  });
  if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("catalog returned non-JSON data");
  const payload = await response.json();
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=1200, s-maxage=1200",
        },
      }));
    } catch (_error) {
      // Cache is an optimization only; the successful upstream response stays valid.
    }
  }
  return payload;
}

async function handleMovieCatalog(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/movies/home") {
    // One upstream request avoids the catalog's rate limit during app startup.
    const latest = await fetchCatalogJson("/danh-sach/phim-moi-cap-nhat?page=1");
    const latestItems = catalogItems(latest);
    const movies = latestItems.filter((item) => item?.type === "single").slice(0, 16);
    const series = latestItems.filter((item) => item?.type === "series").slice(0, 16);
    const animation = latestItems.filter((item) => item?.type === "hoathinh").slice(0, 16);
    return json({
      updatedAt: now(),
      hero: latestItems.slice(0, 8),
      sections: [
        { id: "latest", title: "Phim moi cap nhat", items: latestItems.slice(0, 18) },
        { id: "movies", title: "Phim le", items: movies.length ? movies : latestItems.slice(0, 16) },
        { id: "series", title: "Phim bo", items: series.length ? series : latestItems.slice(8, 24) },
        { id: "animation", title: "Hoat hinh", items: animation.length ? animation : latestItems.slice(16, 32) },
      ],
    }, 200, { "cache-control": "public, max-age=120, s-maxage=120" });
  }

  if (pathname === "/api/movies/filter") {
    const genre = String(url.searchParams.get("genre") || "").trim().toLowerCase();
    const country = String(url.searchParams.get("country") || "").trim().toLowerCase();
    if (!genre && !country) return textError("Thieu bo loc phim.", 400, "MISSING_MOVIE_FILTER");
    if (genre && !MOVIE_FILTER_GENRES.has(genre)) return textError("The loai khong hop le.", 400, "INVALID_GENRE_FILTER");
    if (country && !MOVIE_FILTER_COUNTRIES.has(country)) return textError("Quoc gia khong hop le.", 400, "INVALID_COUNTRY_FILTER");

    const page = catalogPage(url.searchParams.get("page"));
    let target;
    if (genre === "hoat-hinh") {
      target = `/v1/api/danh-sach/hoat-hinh?page=${page}&limit=24`;
    } else if (genre) {
      target = `/v1/api/the-loai/${genre}?page=${page}&limit=24`;
    } else {
      target = `/v1/api/quoc-gia/${country}?page=${page}&limit=24`;
    }
    if (country && genre) target += `&country=${encodeURIComponent(country)}`;
    const data = await fetchCatalogJson(target);
    return json({
      filters: { genre, country },
      items: catalogItems(data),
      pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 1, totalItems: 0 },
    }, 200, { "cache-control": "public, max-age=300, s-maxage=300" });
  }

  const categoryMatch = pathname.match(/^\/api\/movies\/category\/([a-z0-9-]+)$/);
  if (categoryMatch) {
    const category = categoryMatch[1];
    if (!MOVIE_CATALOG_CATEGORIES.has(category)) return textError("Danh muc phim khong hop le.", 400, "INVALID_CATEGORY");
    const page = catalogPage(url.searchParams.get("page"));
    const target = category === "phim-moi-cap-nhat"
      ? `/danh-sach/phim-moi-cap-nhat?page=${page}`
      : `/v1/api/danh-sach/${category}?page=${page}&limit=24`;
    const data = await fetchCatalogJson(target);
    return json({
      title: category,
      items: catalogItems(data),
      pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 1 },
    }, 200, { "cache-control": "public, max-age=120, s-maxage=120" });
  }

  if (pathname === "/api/movies/search") {
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 100);
    if (!query) return textError("Thieu tu khoa tim kiem.", 400, "MISSING_QUERY");
    const page = catalogPage(url.searchParams.get("page"));
    const data = await fetchCatalogJson(`/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&page=${page}&limit=24`);
    return json({
      query,
      items: catalogItems(data),
      pagination: data.data?.params?.pagination || { currentPage: page, totalPages: 1 },
    }, 200, { "cache-control": "public, max-age=120, s-maxage=120" });
  }

  const detailMatch = pathname.match(/^\/api\/movies\/detail\/([^/]+)$/);
  if (detailMatch) {
    const slug = catalogSlug(detailMatch[1]);
    if (!slug) return textError("Ma phim khong hop le.", 400, "INVALID_MOVIE_SLUG");
    const data = await fetchCatalogJson(`/phim/${slug}`);
    return json(data, 200, { "cache-control": "public, max-age=120, s-maxage=120" });
  }

  return textError("Khong tim thay du lieu phim.", 404, "MOVIE_NOT_FOUND");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      const localRetryAfter = rateLimit(request, pathname);
      if (localRetryAfter) {
        rateLimitBlocked += 1;
        return json({ success: false, active: false, code: "RATE_LIMITED", error: "Too many requests. Please retry later.", retryAfter: localRetryAfter }, 429, { "retry-after": String(localRetryAfter) });
      }
      const edgeRetryAfter = await distributedRetryAfter(request, pathname, env);
      if (edgeRetryAfter) {
        rateLimitBlocked += 1;
        return json({ success: false, active: false, code: "RATE_LIMITED", error: "Too many requests. Please retry later.", retryAfter: edgeRetryAfter }, 429, { "retry-after": String(edgeRetryAfter) });
      }
      if (request.method === "POST" && contentLengthTooLarge(request)) {
        return textError("Request body is too large.", 413, "REQUEST_TOO_LARGE");
      }
      if (request.method === "GET" && pathname === "/api/health") {
        return json({ ready: Boolean(env.DB), service: "phim4k-license-api" });
      }
      if (request.method === "GET" && pathname === "/api/media/image") {
        return handleMovieImage(request);
      }
      if (request.method === "GET" && pathname.startsWith("/api/movies/")) {
        return handleMovieCatalog(request);
      }
      const missing = dbUnavailable(env);
      if (missing) return missing;

      if (request.method === "POST" && pathname === "/api/auth/activate") {
        const body = await parseBody(request);
        return activationStatus({ db: env.DB, key: normalizeKey(body.key), telegramId: normalizeId(body.telegramId), deviceId: normalizeId(body.deviceId), request, env, activation: true });
      }
      if (request.method === "GET" && pathname === "/api/auth/status") {
        return activationStatus({ db: env.DB, key: normalizeKey(url.searchParams.get("key")), telegramId: normalizeId(url.searchParams.get("telegramId")), deviceId: normalizeId(url.searchParams.get("deviceId")), request, env, activation: false });
      }
      if (request.method === "POST" && pathname === "/api/auth/request-device-access") return requestDeviceAccess(request, env);
      if (request.method === "GET" && pathname === "/api/auth/device-status") return deviceAccessStatus(request, env);
      if (request.method === "GET" && (pathname === "/api/app/check-update" || pathname === "/api/app/version")) {
        return json(await getForceUpdate(env.DB, url.searchParams.get("version") || appVersion(request)));
      }
      if ((request.method === "GET" || request.method === "POST") && pathname === "/api/app/downloads") return handleDownloads(request, env);
      if (request.method === "GET" && pathname === "/api/admin/keys") return listKeys(request, env);
      if (request.method === "GET" && pathname === "/api/admin/device-access-requests") return listDeviceAccessRequests(request, env);
      if (request.method === "POST" && pathname === "/api/admin/device-access-decision") return decideDeviceAccess(request, env);
      if (request.method === "POST" && pathname === "/api/admin/rotate-master-key") return rotateMasterKey(request, env);
      if (request.method === "POST" && pathname === "/api/admin/create-key") return createKey(request, env);
      if (request.method === "POST" && pathname === "/api/admin/renew-key") return updateKey(request, env, "renew");
      if (request.method === "POST" && pathname === "/api/admin/set-key-expiry") return updateKey(request, env, "expiry");
      if (request.method === "POST" && pathname === "/api/admin/toggle-key") return updateKey(request, env, "toggle");
      if (request.method === "POST" && pathname === "/api/admin/reset-device") return updateKey(request, env, "reset-device");
      if (request.method === "POST" && pathname === "/api/admin/reset-telegram") return updateKey(request, env, "reset-telegram");
      if (request.method === "POST" && pathname === "/api/admin/delete-key") return updateKey(request, env, "delete");
      if (request.method === "GET" && pathname === "/api/admin/users") return listUsers(request, env);
      if (request.method === "POST" && pathname === "/api/admin/ban-user") return setBan(request, env, true);
      if (request.method === "POST" && pathname === "/api/admin/unban-user") return setBan(request, env, false);
      if ((request.method === "GET" || request.method === "DELETE") && pathname === "/api/admin/logs") return handleLogs(request, env);
      if (request.method === "POST" && pathname === "/api/admin/set-force-update") return handleForceUpdate(request, env);
      if (pathname === "/api/stream/proxy" || pathname === "/api/admin/content-status" || pathname === "/api/admin/refresh-movies") return handleMovieFallback(request);
      return textError("Không tìm thấy endpoint.", 404, "NOT_FOUND");
    } catch (error) {
      return textError("Backend gặp lỗi nội bộ.", 500, "INTERNAL_ERROR");
    }
  },
};
