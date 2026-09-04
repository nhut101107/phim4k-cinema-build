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
  authActivate: { limit: 10, windowSeconds: 60 },
  authStatus: { limit: 60, windowSeconds: 60 },
  admin: { limit: 30, windowSeconds: 60 },
  default: { limit: 120, windowSeconds: 60 },
});

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
  if (pathname === "/api/auth/activate") return RATE_LIMITS.authActivate;
  if (pathname === "/api/auth/status") return RATE_LIMITS.authStatus;
  if (pathname.startsWith("/api/admin/")) return RATE_LIMITS.admin;
  return RATE_LIMITS.default;
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
    const forceUpdate = enabled && minVersion && String(version) < minVersion;
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
    return json({ success: true, active: true, isAdmin: true, plan: "MASTER", expiresAt: null, ...force });
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
  return json({ success: true, active: true, isAdmin: false, plan: record.plan, expiresAt: record.expires_at || null, ...force });
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      const retryAfter = rateLimit(request, pathname);
      if (retryAfter) {
        rateLimitBlocked += 1;
        return json({ success: false, active: false, code: "RATE_LIMITED", error: "Too many requests. Please retry later.", retryAfter }, 429, { "retry-after": String(retryAfter) });
      }
      if (request.method === "POST" && contentLengthTooLarge(request)) {
        return textError("Request body is too large.", 413, "REQUEST_TOO_LARGE");
      }
      if (request.method === "GET" && pathname === "/api/health") {
        return json({ ready: Boolean(env.DB), service: "phim4k-license-api" });
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
      if (request.method === "GET" && (pathname === "/api/app/check-update" || pathname === "/api/app/version")) {
        return json(await getForceUpdate(env.DB, url.searchParams.get("version") || appVersion(request)));
      }
      if ((request.method === "GET" || request.method === "POST") && pathname === "/api/app/downloads") return handleDownloads(request, env);
      if (request.method === "GET" && pathname === "/api/admin/keys") return listKeys(request, env);
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
      if (pathname.startsWith("/api/movies/") || pathname === "/api/stream/proxy" || pathname === "/api/admin/content-status" || pathname === "/api/admin/refresh-movies") return handleMovieFallback(request);
      return textError("Không tìm thấy endpoint.", 404, "NOT_FOUND");
    } catch (error) {
      return textError("Backend gặp lỗi nội bộ.", 500, "INTERNAL_ERROR");
    }
  },
};
