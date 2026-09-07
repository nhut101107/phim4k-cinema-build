import HomeCuration from '../../public/js/home-curation.js';

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
  "access-control-allow-headers": "content-type, range, x-license-key, x-telegram-id, x-device-id, x-app-version",
  "access-control-expose-headers": "accept-ranges, content-length, content-range, retry-after",
  "access-control-max-age": "86400",
};

const MAX_DURATION_DAYS = 3650;
const LICENSE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,63}$/;
const MASTER_KEY_MIN_LENGTH = 12;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const ADMIN_KEY_HASH_SETTING = "admin_key_hmac_v1";
const ANNOUNCEMENT_SETTING = "global_announcement_v1";
const MAX_ANNOUNCEMENT_MINUTES = 30 * 24 * 60;
const TELEMETRY_ACTIONS = new Set([
  "app_open", "tab_view", "category_view", "filter_applied", "search",
  "movie_open", "episode_open", "playback_start", "playback_ready",
  "playback_stop", "playback_complete", "playback_error", "server_change",
  "heartbeat", "app_visibility", "network_change", "client_error", "download_open",
]);
const TELEMETRY_FIELDS = new Set([
  "tab", "category", "genre", "country", "query", "results", "movie",
  "episode", "server", "quality", "seconds", "duration", "watched", "error", "entry",
  "session", "runtime", "screen", "language", "network",
  "viewport", "visibility", "uptime", "browser", "os", "buffered", "readyState", "eventAt",
]);
const RATE_LIMITS = Object.freeze({
  authActivate: { limit: 20, windowSeconds: 60 },
  authStatus: { limit: 120, windowSeconds: 60 },
  admin: { limit: 30, windowSeconds: 60 },
  default: { limit: 240, windowSeconds: 60 },
});

// Provider configuration belongs in encrypted Worker Secrets. The client only
// receives this Worker's origin plus short-lived, opaque AES-GCM capabilities.
const MEDIA_TICKET_AAD = new TextEncoder().encode("phim4k-media-ticket-v1");
const VPS_RELAY_SIGNATURE_CONTEXT = "phim4k-vps-relay-v1";
const IMAGE_TICKET_TTL_SECONDS = 90 * 24 * 60 * 60;
const STREAM_TICKET_TTL_SECONDS = 12 * 60 * 60;
const MAX_HLS_MANIFEST_BYTES = 2 * 1024 * 1024;
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

function configuredCatalogOrigin(env) {
  const raw = String(env?.MOVIE_CATALOG_ORIGIN || "").trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url;
  } catch (_error) {
    return null;
  }
}

function configuredImageHosts(env) {
  return new Set(String(env?.MOVIE_IMAGE_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+$/.test(value) && !value.startsWith(".") && !value.endsWith(".")));
}

function configuredRelayOrigin(env) {
  const raw = String(env?.VPS_RELAY_ORIGIN || "").trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    url.pathname = "";
    return url;
  } catch (_error) {
    return null;
  }
}

function relaySecret(env) {
  const secret = String(env?.VPS_RELAY_SECRET || "");
  if (secret.length < 32) throw new Error("VPS_RELAY_NOT_CONFIGURED");
  return secret;
}

function mediaTicketSecret(env) {
  const secret = String(env?.MEDIA_TICKET_SECRET || "");
  if (secret.length < 32) throw new Error("MEDIA_TICKET_NOT_CONFIGURED");
  return secret;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]{24,4096}$/.test(String(value || ""))) throw new Error("INVALID_MEDIA_TICKET");
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== String(value)) throw new Error("INVALID_MEDIA_TICKET");
  return bytes;
}

function decodeBase64UrlText(value) {
  if (!/^[A-Za-z0-9_-]{8,8192}$/.test(String(value || ""))) throw new Error("INVALID_RELAY_FINAL_URL");
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function signRelayRequest(payload, timestamp, nonce, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(relaySecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = new TextEncoder().encode(`${VPS_RELAY_SIGNATURE_CONTEXT}\n${timestamp}\n${nonce}\n${payload}`);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, message)));
}

async function mediaTicketKey(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mediaTicketSecret(env)));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealMediaTicket(payload, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cleartext = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: MEDIA_TICKET_AAD, tagLength: 128 },
    await mediaTicketKey(env),
    cleartext,
  ));
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv);
  packed.set(ciphertext, iv.byteLength);
  return bytesToBase64Url(packed);
}

export async function openMediaTicket(token, env, expectedKind) {
  try {
    const packed = base64UrlToBytes(token);
    if (packed.byteLength < 12 + 16 + 8) throw new Error("INVALID_MEDIA_TICKET");
    const cleartext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12), additionalData: MEDIA_TICKET_AAD, tagLength: 128 },
      await mediaTicketKey(env),
      packed.slice(12),
    );
    const payload = JSON.parse(new TextDecoder().decode(cleartext));
    if (payload?.v !== 1 || payload?.kind !== expectedKind || typeof payload?.url !== "string") throw new Error("INVALID_MEDIA_TICKET");
    const expiresAt = Number(payload.exp);
    if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("EXPIRED_MEDIA_TICKET");
    return { ...payload, exp: expiresAt };
  } catch (error) {
    if (error.message === "MEDIA_TICKET_NOT_CONFIGURED" || error.message === "EXPIRED_MEDIA_TICKET") throw error;
    throw new Error("INVALID_MEDIA_TICKET");
  }
}

function safePublicHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || !host) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) return null;
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) return null;
    url.hash = "";
    return url;
  } catch (_error) {
    return null;
  }
}

async function protectedMediaUrl(request, env, target, kind, expiresAt, extra = {}) {
  const safe = safePublicHttpsUrl(target);
  if (!safe) return "";
  const token = await sealMediaTicket({ ...extra, kind, url: safe.href, exp: expiresAt }, env);
  const path = kind === "image" ? "/api/media/image" : "/api/media/stream";
  return `${new URL(request.url).origin}${path}?t=${encodeURIComponent(token)}`;
}

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

function cleanTelemetryValue(value, maxLength = 160) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 10) / 10;
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  if (!clean || /(?:https?:\/\/|m3u8|cookie|token|authorization)/i.test(clean)) return undefined;
  return clean;
}

export function normalizeTelemetryEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    const action = String(item?.action || "").trim().toLowerCase();
    if (!TELEMETRY_ACTIONS.has(action)) return [];
    const context = {};
    const source = item?.context && typeof item.context === "object" ? item.context : {};
    for (const [key, fieldValue] of Object.entries(source)) {
      if (!TELEMETRY_FIELDS.has(key)) continue;
      const clean = cleanTelemetryValue(fieldValue);
      if (clean !== undefined) context[key] = clean;
    }
    return [{ action: `usage_${action}`, context }];
  });
}

export function auditTypeForAction(action) {
  const value = String(action || "");
  if (value.startsWith("usage_")) return "USER";
  if (value === "license_activated" || value.startsWith("device_access_")) return "AUTH";
  if (value.startsWith("user_")) return "BAN";
  if (value.startsWith("key_") || value.startsWith("admin_")) return "ADMIN";
  if (value.includes("rate") || value.includes("blocked")) return "SECURITY";
  return "SYSTEM";
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

function requestPlatform(request) {
  const userAgent = request.headers.get("user-agent") || "";
  if (/Phim4KTV/i.test(userAgent)) return "android_tv";
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Windows/i.test(userAgent)) return "windows";
  return "";
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
    const reader = request.body?.getReader();
    if (!reader) return {};
    let bytes = 0;
    const chunks = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new Error('REQUEST_TOO_LARGE');
      }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(buffer));
    return body && typeof body === "object" ? body : {};
  } catch (_error) {
    if (_error.message === 'REQUEST_TOO_LARGE') throw _error;
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

async function verifyTelemetryViewer(request, env) {
  const key = requestKey(request);
  const telegramId = requestTelegram(request);
  const deviceId = normalizeId(request.headers.get("x-device-id"));
  if (!deviceId) return { error: textError("Thiếu phiên người dùng hợp lệ.", 401, "VIEWER_SESSION_REQUIRED") };
  if (!key && await freeAccessEnabled(env.DB)) return {telegramId: '', deviceId, isAdmin: false};
  if (!key) return {error: textError('Vui lòng nhập key.', 401, 'KEY_REQUIRED')};

  if (await verifyMasterKey(key, env, env.DB)) {
    if (!await verifyAdminIdentity(key, telegramId, env, env.DB)) {
      return { error: textError("Phiên quản trị không hợp lệ.", 403, "ADMIN_TELEGRAM_REQUIRED") };
    }
    return { telegramId, deviceId, isAdmin: true };
  }
  if (!validKey(key)) return { error: textError("Key không hợp lệ.", 401, "INVALID_KEY_FORMAT") };
  const record = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record || !record.active || isExpired(record.expires_at)) {
    return { error: textError("Phiên người dùng đã hết hiệu lực.", 403, "VIEWER_SESSION_INACTIVE") };
  }
  if (!record.device_id || record.device_id !== deviceId) {
    return { error: textError("Thiết bị không khớp với phiên đã kích hoạt.", 403, "DEVICE_MISMATCH") };
  }
  const boundTelegram = normalizeId(record.activated_telegram_id || record.assigned_telegram_id);
  if (boundTelegram) {
    const ban = await queryOne(env.DB, "SELECT reason FROM bans WHERE telegram_id = ?", boundTelegram);
    if (ban) return { error: textError("Tài khoản đã bị khóa.", 403, "USER_BANNED") };
  }
  return { telegramId: boundTelegram, deviceId, isAdmin: false };
}

async function handleTelemetry(request, env) {
  const identity = await verifyTelemetryViewer(request, env);
  if (identity.error) return identity.error;
  const body = await parseBody(request);
  const events = normalizeTelemetryEvents(body.events);
  if (!events.length) return textError("Không có hoạt động hợp lệ để ghi.", 400, "INVALID_TELEMETRY");
  const device = maskedValue(identity.deviceId, 6);
  for (const event of events) {
    const context = { device, version: String(appVersion(request)).slice(0, 24), ...event.context };
    // Preserve valid JSON rather than slicing a serialized object mid-field.
    for (const key of Object.keys(event.context).reverse()) {
      if (JSON.stringify(context).length <= 490) break;
      delete context[key];
    }
    const detail = JSON.stringify(context);
    await logEvent(env.DB, event.action, {
      actorTelegramId: identity.telegramId,
      targetTelegramId: identity.telegramId,
      detail,
    });
  }
  return json({ success: true, accepted: events.length }, 202);
}

async function ensureWatchProgressTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS watch_progress (owner_id TEXT NOT NULL, movie_slug TEXT NOT NULL, episode_id TEXT NOT NULL, movie_name TEXT NOT NULL, episode_name TEXT NOT NULL, thumb_url TEXT NOT NULL DEFAULT '', current_seconds REAL NOT NULL, duration_seconds REAL NOT NULL, progress_percent INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, movie_slug, episode_id))",
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_watch_progress_owner_updated ON watch_progress(owner_id, updated_at DESC)",
  ).run();
}

async function progressOwner(request, env) {
  const identity = await verifyTelemetryViewer(request, env);
  if (identity.error) return identity;
  const key = requestKey(request);
  const namespace = identity.isAdmin
    ? `admin:${normalizeId(env.ADMIN_TELEGRAM_ID)}`
    : key
      ? `license:${key}`
      : `guest-device:${identity.deviceId}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespace));
  return { ...identity, ownerId: toHex(digest) };
}

function cleanProgressText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanProgressThumb(value, requestOrigin) {
  const raw = cleanProgressText(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    if (url.origin !== requestOrigin || url.pathname !== "/api/media/image") return "";
    if (!/^[A-Za-z0-9_-]{24,4096}$/.test(url.searchParams.get("t") || "") || [...url.searchParams.keys()].some((key) => key !== "t")) return "";
    url.hash = "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function normalizeWatchProgressItem(value, requestOrigin) {
  const movieSlug = cleanProgressText(value?.slug, 160).toLowerCase();
  const movieName = cleanProgressText(value?.name, 160);
  const episodeName = cleanProgressText(value?.epName, 120);
  const episodeId = cleanProgressText(value?.episodeId || episodeName, 160);
  const currentSeconds = Math.round(Number(value?.currentTime) * 10) / 10;
  const durationSeconds = Math.round(Number(value?.duration) * 10) / 10;
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(movieSlug) || !movieName || !episodeName || !episodeId) return null;
  if (!Number.isFinite(currentSeconds) || !Number.isFinite(durationSeconds) || currentSeconds < 0 || durationSeconds < 5 || durationSeconds > 172800 || currentSeconds > durationSeconds + 5) return null;
  return {
    slug: movieSlug,
    name: movieName,
    epName: episodeName,
    episodeId,
    thumb: cleanProgressThumb(value?.thumb, requestOrigin),
    currentTime: Math.min(currentSeconds, durationSeconds),
    duration: durationSeconds,
    progressPercent: Math.max(0, Math.min(100, Math.round((currentSeconds / durationSeconds) * 100))),
  };
}

async function freshWatchProgressThumb(row, request, env, expiresAt) {
  const stored = String(row?.thumb_url || '').trim();
  const requestOrigin = new URL(request.url).origin;
  const slug = catalogSlug(row?.movie_slug);

  // A technically valid image URL is not enough: older builds could associate
  // the current hero poster with a different movie's watch-progress row. Only
  // reuse a Worker ticket that was minted for this exact movie slug.
  if (stored && slug) {
    try {
      const candidate = new URL(stored);
      if (candidate.origin === requestOrigin
        && candidate.pathname === '/api/media/image'
        && [...candidate.searchParams.keys()].every((key) => key === 't')) {
        const ticket = await openMediaTicket(candidate.searchParams.get('t'), env, 'image');
        if (catalogSlug(ticket.movieSlug) === slug) return { thumb: candidate.href, persist: false };
      }
    } catch (_error) {}
  }

  if (!slug) return { thumb: '', persist: false };
  try {
    const detail = await fetchProtectedCatalogJson(`/phim/${slug}`, env, { ttl: 300 });
    const resolved = resolveCatalogImageReferences(detail, catalogImageBase(detail, env));
    const source = resolved?.movie?.thumb_url || resolved?.movie?.poster_url || '';
    const upgraded = await protectImageValue(source, request, env, expiresAt, { movieSlug: slug });
    return { thumb: upgraded, persist: Boolean(upgraded) };
  } catch (_error) {
    // Clear a known-untrusted association so a stale local poster cannot keep
    // winning the timestamp merge. A later read retries catalogue recovery.
    return { thumb: '', persist: Boolean(stored) };
  }
}

async function handleWatchProgress(request, env) {
  const identity = await progressOwner(request, env);
  if (identity.error) return identity.error;
  await ensureWatchProgressTable(env.DB);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT movie_slug, episode_id, movie_name, episode_name, thumb_url, current_seconds, duration_seconds, progress_percent, updated_at FROM watch_progress WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 10",
    ).bind(identity.ownerId).all();
    const sourceRows = rows.results || [];
    const imageExpiresAt = Math.floor(Date.now() / 1000) + IMAGE_TICKET_TTL_SECONDS;
    const thumbStates = await Promise.all(sourceRows.map((row) => freshWatchProgressThumb(row, request, env, imageExpiresAt)));
    const upgradedAt = now();
    await Promise.all(sourceRows.map((row, index) => {
      const state = thumbStates[index];
      if (!state.persist) return Promise.resolve();
      return env.DB.prepare(
        "UPDATE watch_progress SET thumb_url = ?, updated_at = ? WHERE owner_id = ? AND movie_slug = ? AND episode_id = ?",
      ).bind(state.thumb, upgradedAt, identity.ownerId, row.movie_slug, row.episode_id).run();
    }));
    return json({
      success: true,
      items: sourceRows.map((row, index) => ({
        slug: row.movie_slug,
        episodeId: row.episode_id,
        name: row.movie_name,
        epName: row.episode_name,
        thumb: thumbStates[index].thumb,
        currentTime: Number(row.current_seconds),
        duration: Number(row.duration_seconds),
        progressPercent: Number(row.progress_percent),
        updatedAt: thumbStates[index].persist ? upgradedAt : row.updated_at,
      })),
    });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM watch_progress WHERE owner_id = ?").bind(identity.ownerId).run();
    return json({ success: true, cleared: true });
  }

  const body = await parseBody(request);
  const source = Array.isArray(body.items) ? body.items.slice(0, 10) : body.item ? [body.item] : [];
  const requestOrigin = new URL(request.url).origin;
  const items = source.map((item) => normalizeWatchProgressItem(item, requestOrigin));
  if (!items.length || items.some((item) => !item)) {
    return textError("Dữ liệu xem tiếp không hợp lệ.", 400, "INVALID_WATCH_PROGRESS");
  }
  const timestamp = now();
  for (const item of items) {
    await env.DB.prepare(
      "DELETE FROM watch_progress WHERE owner_id = ? AND movie_slug = ? AND episode_id <> ?",
    ).bind(identity.ownerId, item.slug, item.episodeId).run();
    if (item.progressPercent >= 98) {
      await env.DB.prepare(
        "DELETE FROM watch_progress WHERE owner_id = ? AND movie_slug = ?",
      ).bind(identity.ownerId, item.slug).run();
      continue;
    }
    await env.DB.prepare(
      "INSERT INTO watch_progress (owner_id, movie_slug, episode_id, movie_name, episode_name, thumb_url, current_seconds, duration_seconds, progress_percent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, movie_slug, episode_id) DO UPDATE SET movie_name = excluded.movie_name, episode_name = excluded.episode_name, thumb_url = CASE WHEN excluded.thumb_url = '' THEN watch_progress.thumb_url ELSE excluded.thumb_url END, current_seconds = excluded.current_seconds, duration_seconds = excluded.duration_seconds, progress_percent = excluded.progress_percent, updated_at = excluded.updated_at",
    ).bind(identity.ownerId, item.slug, item.episodeId, item.name, item.epName, item.thumb, item.currentTime, item.duration, item.progressPercent, timestamp).run();
  }
  await env.DB.prepare(
    "DELETE FROM watch_progress WHERE owner_id = ? AND rowid NOT IN (SELECT rowid FROM watch_progress WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 10)",
  ).bind(identity.ownerId, identity.ownerId).run();
  return json({ success: true, saved: items.length, updatedAt: timestamp }, 202);
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

async function getVerifiedAdminUpdate(db, request, forceStatus) {
  if (forceStatus.forceUpdate) return forceStatus;

  const platform = requestPlatform(request);
  const currentVersion = appVersion(request);
  if (!platform || !/^\d+(?:\.\d+){1,3}$/.test(currentVersion)) return forceStatus;

  const release = await queryOne(db, "SELECT url, version FROM downloads WHERE platform = ?", platform);
  const releaseVersion = String(release?.version || "").trim();
  if (!release || !validDownloadUrl(release.url) || !/^\d+(?:\.\d+){1,3}$/.test(releaseVersion)) return forceStatus;
  if (compareAppVersions(currentVersion, releaseVersion) >= 0) return forceStatus;

  return {
    ...forceStatus,
    forceUpdate: true,
    isLatest: false,
    latestVersion: releaseVersion,
    minVersion: releaseVersion,
    downloadUrl: release.url,
    message: `Có bản ${releaseVersion}. Hãy tải đúng bản dành cho thiết bị này để cập nhật.`,
  };
}

export function normalizeAnnouncementSetting(raw, timestamp = Date.now()) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch (_error) { return { active: false }; }
  }
  if (!value || typeof value !== "object" || !value.enabled) return { active: false };
  const message = String(value.message || "").trim().slice(0, 600);
  const title = String(value.title || "Thông báo từ Admin").trim().slice(0, 80) || "Thông báo từ Admin";
  const expiresAt = String(value.expiresAt || "");
  if (!message || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= timestamp) return { active: false };
  return {
    active: true,
    id: String(value.id || "").slice(0, 80),
    title,
    message,
    publishedAt: String(value.publishedAt || ""),
    expiresAt,
  };
}

async function getAnnouncement(db) {
  const row = await queryOne(db, "SELECT setting_value FROM app_settings WHERE setting_key = ?", ANNOUNCEMENT_SETTING);
  return normalizeAnnouncementSetting(row?.setting_value);
}

async function handleAnnouncementAdmin(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const body = await parseBody(request);
  const timestamp = now();
  if (String(body.action || "publish").toLowerCase() === "clear") {
    const value = JSON.stringify({ enabled: false, clearedAt: timestamp });
    await env.DB.prepare(
      "INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at",
    ).bind(ANNOUNCEMENT_SETTING, value, timestamp).run();
    await logEvent(env.DB, "admin_announcement_cleared", { actorTelegramId: requestTelegram(request) });
    return json({ success: true, active: false, message: "Đã gỡ thông báo khỏi ứng dụng." });
  }

  const title = String(body.title || "Thông báo từ Admin").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Thông báo từ Admin";
  const message = String(body.message || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
  const durationMinutes = Number.parseInt(String(body.durationMinutes || ""), 10);
  if (!message) return textError("Hãy nhập nội dung thông báo.", 400, "ANNOUNCEMENT_MESSAGE_REQUIRED");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_ANNOUNCEMENT_MINUTES) {
    return textError("Thời lượng thông báo phải từ 1 phút đến 30 ngày.", 400, "INVALID_ANNOUNCEMENT_DURATION");
  }
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  const announcement = {
    enabled: true,
    id: crypto.randomUUID(),
    title,
    message,
    publishedAt: timestamp,
    expiresAt,
  };
  await env.DB.prepare(
    "INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at",
  ).bind(ANNOUNCEMENT_SETTING, JSON.stringify(announcement), timestamp).run();
  await logEvent(env.DB, "admin_announcement_published", {
    actorTelegramId: requestTelegram(request),
    detail: JSON.stringify({ title, durationMinutes, expiresAt }),
  });
  return json({ success: true, message: "Đã ghim thông báo cho người dùng.", announcement: normalizeAnnouncementSetting(announcement) });
}

async function freeAccessEnabled(db) {
  const row = await queryOne(db, 'SELECT setting_value FROM app_settings WHERE setting_key = ?', 'free_access');
  return row?.setting_value === 'true';
}

async function accessPolicy(request, env) {
  if (request.method === 'POST') {
    const denied = await requireVerifiedAdmin(request, env);
    if (denied) return denied;
    const body = await parseBody(request);
    if (typeof body.freeAccess !== 'boolean') return textError('Trạng thái không hợp lệ.', 400, 'INVALID_ACCESS_POLICY');
    await env.DB.prepare('INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at').bind('free_access', String(body.freeAccess), now()).run();
    await logEvent(env.DB, 'admin_access_policy_updated', {actorTelegramId: requestTelegram(request), detail: `freeAccess=${body.freeAccess}`});
  }
  return json({success: true, freeAccess: await freeAccessEnabled(env.DB)});
}

async function activationStatus({ db, key, telegramId, deviceId, request, env, activation }) {
  if (!deviceId) return textError('Thiếu mã thiết bị.', 400, 'MISSING_LICENSE_DATA');
  if (!key) {
    if (!await freeAccessEnabled(db)) return textError('Vui lòng nhập key để tiếp tục.', 401, 'KEY_REQUIRED');
    return json({success: true, active: true, isAdmin: false, freeAccess: true, plan: 'MIỄN KEY', expiresAt: null, ...await getForceUpdate(db, appVersion(request))});
  }
  if (await verifyMasterKey(key, env, db)) {
    if (!await verifyAdminIdentity(key, telegramId, env, db)) {
      return textError("Master key is restricted to the configured administrator Telegram ID.", 403, "ADMIN_TELEGRAM_REQUIRED");
    }
    const force = await getVerifiedAdminUpdate(db, request, await getForceUpdate(db, appVersion(request)));
    // The client already supplied these credentials. Never echo the raw master
    // key or administrator identity back in an API response.
    return json({ success: true, active: !force.forceUpdate, isAdmin: true, plan: "MASTER", expiresAt: null, ...force });
  }
  if (!validKey(key)) return textError("Định dạng key không hợp lệ.", 400, "INVALID_KEY_FORMAT");

  const record = await queryOne(db, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record) return textError("Key không tồn tại.", 404, "KEY_NOT_FOUND");
  if (!record.active) return textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED");
  if (isExpired(record.expires_at)) return textError("Key đã hết hạn.", 403, "KEY_EXPIRED");
  const owner = record.activated_telegram_id || record.assigned_telegram_id;
  if (owner && await queryOne(db, 'SELECT reason FROM bans WHERE telegram_id = ?', owner)) return textError('Tài khoản đã bị khóa.', 403, 'USER_BANNED');
  if (record.device_id && record.device_id !== deviceId) {
    return textError("Key đã được khóa với thiết bị khác. Liên hệ quản trị để reset.", 403, "DEVICE_MISMATCH");
  }

  if (activation && !record.device_id) {
    await db.prepare(
      "UPDATE license_keys SET device_id = ?, updated_at = ? WHERE license_key = ? AND device_id IS NULL AND active = 1",
    ).bind(deviceId, now(), key).run();
    await logEvent(db, "license_activated", { detail: `key=${maskedValue(key)} version=${appVersion(request)}` });
  }

  const bound = await queryOne(db, 'SELECT * FROM license_keys WHERE license_key = ?', key);
  if (!bound?.active || isExpired(bound.expires_at)) return textError('Key không còn hiệu lực.', 403, 'KEY_DISABLED');
  if (bound.device_id !== deviceId) return textError('Key chưa kích hoạt trên máy này hoặc đã gắn máy khác.', 403, 'DEVICE_MISMATCH');

  const force = await getForceUpdate(db, appVersion(request));
  return json({ success: true, active: true, isAdmin: false, keyOnly: true, plan: bound.plan, expiresAt: bound.expires_at || null, ...force });
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
  const key = requestKey(request) || normalizeKey(url.searchParams.get("key"));
  const deviceId = normalizeId(request.headers.get('x-device-id')) || normalizeId(url.searchParams.get("deviceId"));
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
    "SELECT license_keys.*, bans.telegram_id AS banned_telegram_id, bans.reason AS ban_reason FROM license_keys LEFT JOIN bans ON bans.telegram_id = COALESCE(license_keys.activated_telegram_id, license_keys.assigned_telegram_id) WHERE license_keys.device_id IS NOT NULL OR license_keys.activated_telegram_id IS NOT NULL OR license_keys.assigned_telegram_id IS NOT NULL ORDER BY license_keys.updated_at DESC",
  ).bind().all();
  return json({ users: (rows.results || []).map((record) => ({
    telegramId: record.activated_telegram_id || record.assigned_telegram_id || "",
    key: record.license_key,
    plan: record.plan,
    isBanned: !Boolean(record.active) || Boolean(record.banned_telegram_id),
    banReason: record.ban_reason || "",
    active: Boolean(record.active) && !isExpired(record.expires_at),
    status: !record.active ? "Đã bị ban" : (isExpired(record.expires_at) ? "Hết hạn" : "Bình thường"),
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
  const key = normalizeKey(body.key || body.licenseKey);
  const deviceId = normalizeId(body.deviceId);
  const telegramId = normalizeId(body.telegramId);

  let license = null;
  if (key) {
    if (!validKey(key)) return textError("Mã key không hợp lệ.", 400, "INVALID_KEY_FORMAT");
    license = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  } else if (deviceId) {
    license = await queryOne(env.DB, "SELECT * FROM license_keys WHERE device_id = ?", deviceId);
  }

  // Current viewer accounts are identified by their license and bound device.
  // Keep the Telegram branch below only so old bans can still be removed.
  if (license) {
    const owner = license.activated_telegram_id || license.assigned_telegram_id || "";
    await env.DB.prepare("UPDATE license_keys SET active = ?, updated_at = ? WHERE license_key = ?")
      .bind(banned ? 0 : 1, now(), license.license_key).run();
    if (!banned && owner) await env.DB.prepare("DELETE FROM bans WHERE telegram_id = ?").bind(owner).run();
    await logEvent(env.DB, banned ? "user_banned" : "user_unbanned", {
      actorTelegramId: requestTelegram(request),
      targetKey: license.license_key,
      detail: `${banned ? "ban" : "unban"} device=${maskedValue(license.device_id || "unbound")} ${String(body.reason || "").slice(0, 300)}`.trim(),
    });
    return json({ success: true, message: banned ? "Đã khóa user theo key và thiết bị." : "Đã mở khóa user theo key." });
  }

  if (key || deviceId) return textError("Không tìm thấy user gắn với key hoặc thiết bị này.", 404, "USER_NOT_FOUND");
  if (!telegramId) return textError("Thiếu key hoặc mã thiết bị của user.", 400, "MISSING_USER_TARGET");
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
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);
  const identity = cleanTelemetryValue(url.searchParams.get("identity"), 128)
    || cleanTelemetryValue(url.searchParams.get("telegramId"), 128)
    || "";
  const cursor = Math.max(Number.parseInt(url.searchParams.get("before") || "0", 10) || 0, 0);
  const requestedType = String(url.searchParams.get("type") || "ALL").trim().toUpperCase();
  const type = new Set(["ALL", "USER", "AUTH", "ADMIN", "BAN", "SECURITY", "SYSTEM"]).has(requestedType) ? requestedType : "ALL";
  const clauses = [];
  const values = [];
  if (identity) {
    clauses.push("(actor_telegram_id = ? OR target_telegram_id = ? OR detail LIKE ?)");
    values.push(identity, identity, `%${identity.replace(/[\\%_]/g, "")}%`);
  }
  if (cursor) {
    clauses.push("id < ?");
    values.push(cursor);
  }
  const typeSql = {
    USER: "action LIKE 'usage_%'",
    AUTH: "(action = 'license_activated' OR action LIKE 'device_access_%')",
    ADMIN: "(action LIKE 'key_%' OR action LIKE 'admin_%')",
    BAN: "action LIKE 'user_%'",
    SECURITY: "(action LIKE '%rate%' OR action LIKE '%blocked%')",
    SYSTEM: "(action NOT LIKE 'usage_%' AND action <> 'license_activated' AND action NOT LIKE 'device_access_%' AND action NOT LIKE 'key_%' AND action NOT LIKE 'admin_%' AND action NOT LIKE 'user_%' AND action NOT LIKE '%rate%' AND action NOT LIKE '%blocked%')",
  }[type];
  if (typeSql) clauses.push(typeSql);
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const statement = env.DB.prepare(`SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ?`).bind(...values, limit + 1);
  const result = await statement.all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return json({ logs: page.map((item) => {
    let context = {};
    try { context = JSON.parse(item.detail || "{}"); } catch (_error) {}
    const actorTelegramId = item.actor_telegram_id || item.target_telegram_id || "";
    return {
      id: item.id,
      timestamp: item.created_at,
      createdAt: item.created_at,
      action: item.action,
      type: auditTypeForAction(item.action),
      details: item.detail || "",
      context: context && typeof context === "object" ? context : {},
      actorTelegramId,
      targetKey: item.target_key ? maskedValue(item.target_key) : "",
      telegramId: item.target_telegram_id || "",
      detail: item.detail || "",
      account: { telegramId: actorTelegramId, deviceHash: context?.device || "" },
    };
  }), hasMore, nextCursor: hasMore ? page.at(-1)?.id || null : null, type });
}

function configuredJellyfinOrigin(env) {
  const raw = String(env.JELLYFIN_BASE_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url;
  } catch (_error) {
    return null;
  }
}

async function probeJellyfin(env) {
  const origin = configuredJellyfinOrigin(env);
  if (!origin) {
    return {
      id: "jellyfin",
      label: "Jellyfin tự host",
      status: "NEEDS_CONFIGURATION",
      purpose: "Kho phim Full HD/4K do bạn sở hữu hoặc được cấp quyền",
    };
  }
  try {
    const basePath = origin.pathname === "/" ? "" : origin.pathname.replace(/\/+$/, "");
    const target = new URL(`${basePath}/System/Info/Public`, origin.origin);
    const response = await fetch(target.href, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    return {
      id: "jellyfin",
      label: "Jellyfin tự host",
      status: "READY",
      serverName: cleanTelemetryValue(info.ServerName, 80) || "Jellyfin",
      version: cleanTelemetryValue(info.Version, 32) || "unknown",
      purpose: "Kho phim Full HD/4K do bạn sở hữu hoặc được cấp quyền",
    };
  } catch (_error) {
    return {
      id: "jellyfin",
      label: "Jellyfin tự host",
      status: "UNREACHABLE",
      purpose: "Kho phim Full HD/4K do bạn sở hữu hoặc được cấp quyền",
    };
  }
}

async function handleContentStatus(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  let catalogStatus = "READY";
  let itemCount = 0;
  try {
    const data = await fetchProtectedCatalogJson("/danh-sach/phim-moi-cap-nhat?page=1", env);
    itemCount = catalogItems(data).length;
    if (!itemCount) catalogStatus = "EMPTY";
  } catch (_error) {
    catalogStatus = "UNREACHABLE";
  }
  const jellyfin = await probeJellyfin(env);
  return json({
    source: "Cloudflare protected catalog",
    status: catalogStatus,
    itemCount,
    checkedAt: now(),
    lastSuccessfulRefreshAt: catalogStatus === "READY" ? now() : null,
    cacheActive: true,
    cacheTtlSeconds: 30,
    providers: [
      { id: "catalog", label: "Kho phim được bảo vệ", status: catalogStatus, purpose: "Danh mục, mô tả và poster qua Cloudflare" },
      jellyfin,
    ],
    ads: { sdkEmbedded: false, mode: "NO_AD_SDK" },
  });
}

async function handleMovieRefresh(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const paths = homeCatalogPaths(new Date().getUTCFullYear());
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) await Promise.all(paths.map((path) => cache.delete(catalogCacheKey(path))));
  const results = await Promise.allSettled(paths.map((path) => fetchProtectedCatalogJson(path, env, { force: true, ttl: 30 })));
  const uniqueItems = new Set(results.flatMap((result) => result.status === "fulfilled" ? catalogItems(result.value).map((item) => item?.slug).filter(Boolean) : []));
  const itemCount = uniqueItems.size;
  if (!itemCount) return textError("Nguồn danh mục tạm thời không khả dụng.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
  await logEvent(env.DB, "admin_catalog_refreshed", {
    actorTelegramId: requestTelegram(request),
    detail: JSON.stringify({ itemCount }),
  });
  return json({ success: true, message: `Đã kiểm tra và làm mới ${itemCount} mục phim.`, itemCount, refreshedAt: now() });
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
    for (const row of rows.results || []) {
      if (['android', 'android_tv', 'ios', 'windows'].includes(row.platform)) output[row.platform] = { url: validDownloadUrl(row.url) ? row.url : '', version: row.version };
    }
    return json({
      ...output,
      androidUrl: output.android?.url || "", androidVersion: output.android?.version || "",
      iosUrl: output.ios?.url || "", iosVersion: output.ios?.version || "",
      windowsUrl: output.windows?.url || "", windowsVersion: output.windows?.version || "",
      android_tvUrl: output.android_tv?.url || "", android_tvVersion: output.android_tv?.version || "",
    });
  }
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const body = await parseBody(request);
  const entries = [
    ["android", body.androidUrl, body.androidVersion],
    ["ios", body.iosUrl, body.iosVersion],
    ["windows", body.windowsUrl, body.windowsVersion],
    ...(body.android_tvUrl !== undefined ? [["android_tv", body.android_tvUrl, body.android_tvVersion]] : []),
  ];
  const timestamp = now();
  const statements = [];
  for (const [platform, url, version] of entries) {
    const safeUrl = String(url || "").trim();
    if (safeUrl && !validDownloadUrl(safeUrl)) return textError("Link tải phải dùng HTTPS, không chứa tài khoản/mật khẩu.", 400, "INVALID_DOWNLOAD_URL");
    statements.push(env.DB.prepare(
      "INSERT INTO downloads (platform, url, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(platform) DO UPDATE SET url = excluded.url, version = excluded.version, updated_at = excluded.updated_at",
    ).bind(platform, safeUrl, String(version || "").trim().slice(0, 64), timestamp));
  }
  await env.DB.batch(statements);
  await logEvent(env.DB, 'admin_downloads_updated', { actorTelegramId: requestTelegram(request), detail: 'release-links-updated' });
  return json({ success: true, message: "Đã cập nhật link tải." });
}

export function validDownloadUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && value.length <= 2048; }
  catch (_) { return false; }
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

function catalogImageBase(data, env) {
  const hosts = configuredImageHosts(env);
  const candidates = [
    data?.data?.APP_DOMAIN_CDN_IMAGE,
    data?.APP_DOMAIN_CDN_IMAGE,
    data?.data?.pathImage,
    data?.pathImage,
  ];
  for (const value of candidates) {
    const target = safePublicHttpsUrl(value);
    if (!target || !hosts.has(target.hostname.toLowerCase())) continue;
    target.search = "";
    target.hash = "";
    if (!target.pathname.endsWith("/")) target.pathname += "/";
    return target.href;
  }
  return "";
}

function resolveCatalogImageReferences(value, base) {
  if (Array.isArray(value)) return value.map((item) => resolveCatalogImageReferences(item, base));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "poster_url" || key === "thumb_url") {
      const raw = String(child || "").trim();
      if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || !base) output[key] = raw;
      else {
        try { output[key] = new URL(raw.replace(/^\/+/, ""), base).href; }
        catch (_error) { output[key] = ""; }
      }
    } else output[key] = resolveCatalogImageReferences(child, base);
  }
  return output;
}

function normalizedCatalogItems(data, env) {
  return resolveCatalogImageReferences(catalogItems(data), catalogImageBase(data, env));
}

function homeCatalogPaths(year) {
  return [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((page) => `/danh-sach/phim-moi-cap-nhat?page=${page}`),
    ...['phim-chieu-rap', 'phim-le', 'phim-bo', 'hoat-hinh', 'tv-shows']
      .flatMap((category) => [1, 2, 3].map((page) =>
        `/v1/api/danh-sach/${category}?page=${page}&limit=64&year=${year}&sort_field=modified.time&sort_type=desc`)),
  ];
}

function catalogCacheKey(path) {
  return new Request(`https://phim4k-license-api.phim4k-pwdbhdz.workers.dev/__catalog_cache${path}`);
}

async function protectedImageCacheKey(request, target) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(target.href));
  return new Request(`${new URL(request.url).origin}/__image_cache/${toHex(digest)}`);
}

async function handleProtectedMovieImage(request, env, executionContext) {
  let ticket;
  try {
    ticket = await openMediaTicket(new URL(request.url).searchParams.get("t"), env, "image");
  } catch (error) {
    const expired = error.message === "EXPIRED_MEDIA_TICKET";
    return textError(expired ? "Vé ảnh đã hết hạn." : "Vé ảnh không hợp lệ.", expired ? 410 : 400, expired ? "IMAGE_TICKET_EXPIRED" : "INVALID_IMAGE_TICKET");
  }
  const target = safePublicHttpsUrl(ticket.url);
  const hosts = configuredImageHosts(env);
  const safePath = target && (target.pathname.startsWith("/upload/") || target.pathname.startsWith("/uploads/"));
  if (!target || !hosts.has(target.hostname.toLowerCase()) || !safePath) return textError("Nguồn ảnh không được phép.", 400, "IMAGE_HOST_NOT_ALLOWED");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = cache ? await protectedImageCacheKey(request, target) : null;
  if (cache && cacheKey) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch (_error) {}
  }

  let upstream;
  let finalTarget;
  try {
    ({ response: upstream, target: finalTarget } = await fetchProtectedUpstream(target.href, request, env, "media"));
  } catch (_error) {
    return textError("Không tải được ảnh phim.", 502, "IMAGE_UPSTREAM_ERROR");
  }
  const finalSafePath = finalTarget && (finalTarget.pathname.startsWith("/upload/") || finalTarget.pathname.startsWith("/uploads/"));
  if (!finalTarget || !hosts.has(finalTarget.hostname.toLowerCase()) || !finalSafePath) {
    try { await upstream.body?.cancel(); } catch (_error) {}
    return textError("Nguồn ảnh chuyển hướng không được phép.", 502, "IMAGE_REDIRECT_NOT_ALLOWED");
  }
  if (!upstream.ok) return textError("Không tải được ảnh phim.", 502, "IMAGE_UPSTREAM_ERROR");
  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) return textError("Nguồn trả về không phải ảnh.", 502, "INVALID_IMAGE_RESPONSE");
  const contentLength = Number.parseInt(upstream.headers.get("content-length") || "0", 10) || 0;
  if (contentLength > 6 * 1024 * 1024) return textError("Ảnh vượt quá giới hạn kích thước.", 413, "IMAGE_TOO_LARGE");
  const headers = new Headers(CORS_HEADERS);
  headers.set("content-type", contentType);
  headers.set("cache-control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
  headers.set("x-content-type-options", "nosniff");
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const response = new Response(upstream.body, { status: 200, headers });
  if (cache && cacheKey && executionContext?.waitUntil) {
    executionContext.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  }
  return response;
}

async function fetchProtectedCatalogJson(path, env, { force = false, ttl = 30 } = {}) {
  const origin = configuredCatalogOrigin(env);
  if (!origin || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) {
    throw new Error("CATALOG_NOT_CONFIGURED");
  }
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = catalogCacheKey(path);
  if (cache && !force) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return await cached.json();
    } catch (_error) {}
  }
  const response = await fetch(`${origin.href.replace(/\/$/, "")}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
    redirect: "manual",
    cf: { cacheEverything: true, cacheTtl: ttl },
  });
  if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error(`catalog HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}` },
      }));
    } catch (_error) {}
  }
  return payload;
}

async function protectImageValue(value, request, env, expiresAt, extra = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hosts = configuredImageHosts(env);
  let target = safePublicHttpsUrl(raw);
  if (!target && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const [host] = hosts;
    if (host) target = safePublicHttpsUrl(`https://${host}/${raw.replace(/^\/+/, "")}`);
  }
  if (!target || !hosts.has(target.hostname.toLowerCase())) return "";
  if (!target.pathname.startsWith("/upload/") && !target.pathname.startsWith("/uploads/")) return "";
  return protectedMediaUrl(request, env, target.href, "image", expiresAt, extra);
}

async function protectCatalogImages(value, request, env, expiresAt = Math.floor(Date.now() / 1000) + IMAGE_TICKET_TTL_SECONDS, ticketPromises = new Map()) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => protectCatalogImages(item, request, env, expiresAt, ticketPromises)));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "poster_url" || key === "thumb_url") {
      const source = String(child || "").trim();
      if (!ticketPromises.has(source)) ticketPromises.set(source, protectImageValue(source, request, env, expiresAt));
      output[key] = await ticketPromises.get(source);
    } else output[key] = await protectCatalogImages(child, request, env, expiresAt, ticketPromises);
  }
  return output;
}

async function protectMovieDetail(data, request, env, slug) {
  const resolved = resolveCatalogImageReferences(data, catalogImageBase(data, env));
  const output = await protectCatalogImages(resolved, request, env);
  if (output?.movie && typeof output.movie === "object") delete output.movie.trailer_url;
  const servers = Array.isArray(output?.episodes) ? output.episodes : [];
  output.episodes = servers.map((server, serverIndex) => ({
    server_name: cleanProgressText(server?.server_name, 100) || `Server ${serverIndex + 1}`,
    server_data: (Array.isArray(server?.server_data) ? server.server_data : []).map((episode, episodeIndex) => ({
      name: cleanProgressText(episode?.name, 120) || `Tập ${episodeIndex + 1}`,
      slug: cleanProgressText(episode?.slug, 160),
      filename: cleanProgressText(episode?.filename, 160),
      stream_ref: { movie: slug, server: serverIndex, episode: episodeIndex },
    })),
  }));
  return output;
}

async function handleProtectedMovieCatalog(request, env) {
  const identity = await verifyTelemetryViewer(request, env);
  if (identity.error) return identity.error;
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/movies/home") {
    const paths = homeCatalogPaths(new Date().getUTCFullYear());
    const results = await Promise.allSettled(paths.map((path, index) => fetchProtectedCatalogJson(path, env, { ttl: index ? 300 : 30 })));
    const items = results.flatMap((result) => result.status === "fulfilled" ? normalizedCatalogItems(result.value, env) : []);
    if (!items.length) return textError("Nguồn danh mục tạm thời không khả dụng.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
    return json(await protectCatalogImages(HomeCuration.build(items), request, env));
  }

  if (pathname === "/api/movies/filter") {
    const genre = String(url.searchParams.get("genre") || "").trim().toLowerCase();
    const country = String(url.searchParams.get("country") || "").trim().toLowerCase();
    if (!genre && !country) return textError("Thiếu bộ lọc phim.", 400, "MISSING_MOVIE_FILTER");
    if (genre && !MOVIE_FILTER_GENRES.has(genre)) return textError("Thể loại không hợp lệ.", 400, "INVALID_GENRE_FILTER");
    if (country && !MOVIE_FILTER_COUNTRIES.has(country)) return textError("Quốc gia không hợp lệ.", 400, "INVALID_COUNTRY_FILTER");
    const page = catalogPage(url.searchParams.get("page"));
    let target = genre === "hoat-hinh"
      ? `/v1/api/danh-sach/hoat-hinh?page=${page}&limit=48`
      : genre ? `/v1/api/the-loai/${genre}?page=${page}&limit=48` : `/v1/api/quoc-gia/${country}?page=${page}&limit=48`;
    if (country && genre) target += `&country=${encodeURIComponent(country)}`;
    const data = await fetchProtectedCatalogJson(target, env);
    return json({ filters: { genre, country }, items: await protectCatalogImages(normalizedCatalogItems(data, env), request, env), pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 1, totalItems: 0 } });
  }

  const categoryMatch = pathname.match(/^\/api\/movies\/category\/([a-z0-9-]+)$/);
  if (categoryMatch) {
    const category = categoryMatch[1];
    if (!MOVIE_CATALOG_CATEGORIES.has(category)) return textError("Danh mục phim không hợp lệ.", 400, "INVALID_CATEGORY");
    const page = catalogPage(url.searchParams.get("page"));
    const target = category === "phim-moi-cap-nhat" ? `/danh-sach/phim-moi-cap-nhat?page=${page}` : `/v1/api/danh-sach/${category}?page=${page}&limit=48`;
    const data = await fetchProtectedCatalogJson(target, env);
    return json({ title: category, items: await protectCatalogImages(normalizedCatalogItems(data, env), request, env), pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 1 } });
  }

  if (pathname === "/api/movies/search") {
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 100);
    if (!query) return textError("Thiếu từ khóa tìm kiếm.", 400, "MISSING_QUERY");
    const page = catalogPage(url.searchParams.get("page"));
    const data = await fetchProtectedCatalogJson(`/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&page=${page}&limit=48`, env);
    return json({ query, items: await protectCatalogImages(normalizedCatalogItems(data, env), request, env), pagination: data.data?.params?.pagination || { currentPage: page, totalPages: 1 } });
  }

  const detailMatch = pathname.match(/^\/api\/movies\/detail\/([^/]+)$/);
  if (detailMatch) {
    const slug = catalogSlug(detailMatch[1]);
    if (!slug) return textError("Mã phim không hợp lệ.", 400, "INVALID_MOVIE_SLUG");
    const data = await fetchProtectedCatalogJson(`/phim/${slug}`, env, { ttl: 120 });
    return json(await protectMovieDetail(data, request, env, slug));
  }
  return textError("Không tìm thấy dữ liệu phim.", 404, "MOVIE_NOT_FOUND");
}

async function handleMoviePlayback(request, env) {
  const identity = await verifyTelemetryViewer(request, env);
  if (identity.error) return identity.error;
  const body = await parseBody(request);
  const slug = catalogSlug(body?.movie);
  const serverIndex = Number(body?.server);
  const episodeIndex = Number(body?.episode);
  if (!slug || !Number.isInteger(serverIndex) || serverIndex < 0 || serverIndex > 50 || !Number.isInteger(episodeIndex) || episodeIndex < 0 || episodeIndex > 5000) {
    return textError("Tham chiếu tập phim không hợp lệ.", 400, "INVALID_STREAM_REFERENCE");
  }
  const data = await fetchProtectedCatalogJson(`/phim/${slug}`, env, { ttl: 120 });
  const episode = data?.episodes?.[serverIndex]?.server_data?.[episodeIndex];
  const hls = safePublicHttpsUrl(episode?.link_m3u8);
  const embedded = safePublicHttpsUrl(episode?.link_embed);
  const directEmbed = embedded && /\.(?:m3u8|mp4|m4v|mov)(?:$|[?#])/i.test(embedded.href) ? embedded : null;
  const target = hls || directEmbed;
  if (!target) return textError("Server này không có luồng phát trực tiếp tương thích.", 404, "STREAM_NOT_AVAILABLE");
  const expiresAt = Math.floor(Date.now() / 1000) + (env.MEDIA_RELAY_FALLBACK === "redirect" ? 15 * 60 : STREAM_TICKET_TTL_SECONDS);
  const isHls = Boolean(hls) || /\.m3u8(?:$|[?#])/i.test(target.href);
  return json({ success: true, streamUrl: await protectedMediaUrl(request, env, target.href, "stream", expiresAt, { format: isHls ? "hls" : "media" }), isHls, expiresAt: new Date(expiresAt * 1000).toISOString() });
}

async function fetchVpsRelay(initialUrl, request, env, mediaFormat = "media") {
  const target = safePublicHttpsUrl(initialUrl);
  const relay = configuredRelayOrigin(env);
  if (!target || !relay) throw new Error("VPS_RELAY_NOT_CONFIGURED");
  // AVPlayer may probe even an HLS manifest with Range: bytes=0-1. Forwarding
  // that range produces a two-byte partial playlist which can never begin with
  // #EXTM3U, so always fetch manifests in full. Media segments still preserve
  // Range for seeking and bandwidth efficiency.
  const format = mediaFormat === "hls" ? "hls" : "media";
  const range = format === "hls" ? "" : String(request.headers.get("range") || "");
  if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error("INVALID_MEDIA_RANGE");
  const catalogOrigin = configuredCatalogOrigin(env);
  const payload = JSON.stringify({
    v: 1,
    url: target.href,
    range,
    format,
    referer: catalogOrigin ? `${catalogOrigin.origin}/` : `${target.origin}/`,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const signature = await signRelayRequest(payload, timestamp, nonce, env);
  const response = await fetch(`${relay.origin}/v1/media`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-phim4k-relay-timestamp": timestamp,
      "x-phim4k-relay-nonce": nonce,
      "x-phim4k-relay-signature": signature,
    },
    body: payload,
    redirect: "manual",
  });
  let finalTarget = target;
  const encodedFinalUrl = response.headers.get("x-phim4k-relay-final");
  if (encodedFinalUrl) {
    const decoded = safePublicHttpsUrl(decodeBase64UrlText(encodedFinalUrl));
    if (!decoded) throw new Error("INVALID_RELAY_FINAL_URL");
    finalTarget = decoded;
  }
  return { response, target: finalTarget };
}

async function fetchProtectedUpstream(initialUrl, request, env, mediaFormat = "media", maxRedirects = 4) {
  const format = mediaFormat === "hls" ? "hls" : "media";
  if (configuredRelayOrigin(env)) return fetchVpsRelay(initialUrl, request, env, format);
  let target = safePublicHttpsUrl(initialUrl);
  if (!target) throw new Error("UNSAFE_MEDIA_TARGET");
  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const catalogOrigin = configuredCatalogOrigin(env);
    const headers = new Headers({
      accept: "*/*",
      "accept-language": "vi,en-US;q=0.8,en;q=0.6",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    });
    if (catalogOrigin) headers.set("referer", `${catalogOrigin.origin}/`);
    const range = format === "hls" ? "" : request.headers.get("range");
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
    const response = await fetch(target.href, { headers, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, target };
    if (attempt === maxRedirects) throw new Error("MEDIA_REDIRECT_LIMIT");
    const location = response.headers.get("location");
    target = location ? safePublicHttpsUrl(new URL(location, target).href) : null;
    if (!target) throw new Error("UNSAFE_MEDIA_REDIRECT");
  }
  throw new Error("MEDIA_REDIRECT_LIMIT");
}

async function protectHlsReference(reference, baseUrl, request, env, expiresAt) {
  const value = String(reference || "").trim();
  if (!value || value.startsWith("data:")) throw new Error("UNSAFE_HLS_REFERENCE");
  const target = safePublicHttpsUrl(new URL(value, baseUrl).href);
  if (!target) throw new Error("UNSAFE_HLS_REFERENCE");
  return protectedMediaUrl(request, env, target.href, "stream", expiresAt, { format: /\.m3u8(?:$|[?#])/i.test(target.href) ? "hls" : "media" });
}

async function rewriteHlsLine(line, baseUrl, request, env, expiresAt) {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (!trimmed.startsWith("#")) return protectHlsReference(trimmed, baseUrl, request, env, expiresAt);
  const matches = [...line.matchAll(/URI="([^"]+)"/g)];
  if (!matches.length) return line;
  let output = "";
  let offset = 0;
  for (const match of matches) {
    output += line.slice(offset, match.index);
    output += `URI="${await protectHlsReference(match[1], baseUrl, request, env, expiresAt)}"`;
    offset = match.index + match[0].length;
  }
  return output + line.slice(offset);
}

async function handleMovieStream(request, env) {
  let ticket;
  try {
    ticket = await openMediaTicket(new URL(request.url).searchParams.get("t"), env, "stream");
  } catch (error) {
    const expired = error.message === "EXPIRED_MEDIA_TICKET";
    return textError(expired ? "Vé phát đã hết hạn." : "Vé phát không hợp lệ.", expired ? 410 : 400, expired ? "STREAM_TICKET_EXPIRED" : "INVALID_STREAM_TICKET");
  }
  // Compatibility mode is retained only for emergency rollback. Production
  // uses the authenticated VPS relay, so the provider URL never reaches the
  // client or appears in a browser-visible redirect.
  if (env.MEDIA_RELAY_FALLBACK === "redirect") {
    return new Response(null, {
      status: 307,
      headers: { ...CORS_HEADERS, location: ticket.url, "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
    });
  }
  let upstream;
  let target;
  try {
    ({ response: upstream, target } = await fetchProtectedUpstream(ticket.url, request, env, ticket.format));
  } catch (_error) {
    return textError("Không kết nối được luồng phim.", 502, "STREAM_UPSTREAM_ERROR");
  }
  if (!upstream.ok && upstream.status !== 206) return textError("Luồng phim tạm thời không phản hồi.", 502, `STREAM_UPSTREAM_HTTP_${upstream.status}`);
  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  const isHls = ticket.format === "hls" || /(?:mpegurl|x-mpegurl)/.test(contentType) || /\.m3u8(?:$|[?#])/i.test(target.href);
  if (isHls) {
    const declaredLength = Number.parseInt(upstream.headers.get("content-length") || "0", 10) || 0;
    if (declaredLength > MAX_HLS_MANIFEST_BYTES) return textError("Danh sách phát vượt giới hạn.", 413, "HLS_MANIFEST_TOO_LARGE");
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_HLS_MANIFEST_BYTES) return textError("Danh sách phát vượt giới hạn.", 413, "HLS_MANIFEST_TOO_LARGE");
    const manifest = new TextDecoder().decode(bytes);
    if (!manifest.trimStart().startsWith("#EXTM3U")) return textError("Danh sách phát không hợp lệ.", 502, "INVALID_HLS_MANIFEST");
    try {
      const lines = await Promise.all(manifest.split(/\r?\n/).map((line) => rewriteHlsLine(line, target.href, request, env, ticket.exp)));
      return new Response(lines.join("\n"), { status: 200, headers: { ...CORS_HEADERS, "content-type": "application/vnd.apple.mpegurl; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    } catch (_error) {
      return textError("Danh sách phát chứa liên kết không an toàn.", 502, "UNSAFE_HLS_MANIFEST");
    }
  }
  if (!/^(?:video\/|audio\/|application\/(?:octet-stream|mp2t))/.test(contentType)) return textError("Nguồn phát trả về nội dung không hợp lệ.", 502, "INVALID_STREAM_RESPONSE");
  const headers = new Headers(CORS_HEADERS);
  headers.set("content-type", contentType || "application/octet-stream");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  for (const name of ["accept-ranges", "content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env, executionContext) {
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
      if (request.method === "GET" && pathname === "/api/media/image") return await handleProtectedMovieImage(request, env, executionContext);
      if (request.method === "GET" && pathname === "/api/media/stream") return await handleMovieStream(request, env);
      if (request.method === "POST" && pathname === "/api/movies/play") return await handleMoviePlayback(request, env);
      if (request.method === "GET" && pathname.startsWith("/api/movies/")) return await handleProtectedMovieCatalog(request, env);
      const missing = dbUnavailable(env);
      if (missing) return missing;

      if (request.method === 'GET' && pathname === '/api/app/access-policy') return await accessPolicy(request, env);
      if (request.method === 'POST' && pathname === '/api/admin/access-policy') return await accessPolicy(request, env);

      if (request.method === "POST" && pathname === "/api/auth/activate") {
        const body = await parseBody(request);
        return await activationStatus({ db: env.DB, key: normalizeKey(body.key), telegramId: normalizeId(body.telegramId), deviceId: normalizeId(body.deviceId), request, env, activation: true });
      }
      if (request.method === "GET" && pathname === "/api/auth/status") {
        return await activationStatus({ db: env.DB, key: requestKey(request) || normalizeKey(url.searchParams.get("key")), telegramId: requestTelegram(request) || normalizeId(url.searchParams.get("telegramId")), deviceId: normalizeId(request.headers.get('x-device-id')) || normalizeId(url.searchParams.get("deviceId")), request, env, activation: false });
      }
      if (request.method === "POST" && pathname === "/api/auth/request-device-access") return await requestDeviceAccess(request, env);
      if (request.method === "GET" && pathname === "/api/auth/device-status") return await deviceAccessStatus(request, env);
      if (request.method === "GET" && (pathname === "/api/app/check-update" || pathname === "/api/app/version")) {
        const version = url.searchParams.get('version') || appVersion(request);
        const status = await getForceUpdate(env.DB, version);
        const platform = url.searchParams.get('platform') || requestPlatform(request) || 'web';
        if (!status.forceUpdate && ['ios', 'android', 'android_tv', 'windows'].includes(platform)) {
          const release = await queryOne(env.DB, 'SELECT * FROM downloads WHERE platform = ?', platform);
          if (release && validDownloadUrl(release.url)) {
            status.latestVersion = release.version;
            status.isLatest = compareAppVersions(version, release.version) >= 0;
            status.message = status.isLatest ? 'Bạn đang dùng phiên bản mới nhất.' : `Có bản ${release.version}. Mở Tải ứng dụng để cập nhật.`;
          } else {
            status.isLatest = false;
            status.message = 'Chưa có bản phát hành phù hợp thiết bị này.';
          }
        }
        return json(status);
      }
      if (request.method === "GET" && pathname === "/api/app/announcement") return json(await getAnnouncement(env.DB));
      if (request.method === "POST" && pathname === "/api/telemetry") return await handleTelemetry(request, env);
      if (["GET", "POST", "DELETE"].includes(request.method) && pathname === "/api/watch-progress") return await handleWatchProgress(request, env);
      if ((request.method === "GET" || request.method === "POST") && pathname === "/api/app/downloads") return await handleDownloads(request, env);
      if (request.method === "POST" && pathname === "/api/admin/update-downloads") return await handleDownloads(request, env);
      if (request.method === "GET" && pathname === "/api/admin/keys") return await listKeys(request, env);
      if (request.method === "GET" && pathname === "/api/admin/device-access-requests") return await listDeviceAccessRequests(request, env);
      if (request.method === "POST" && pathname === "/api/admin/device-access-decision") return await decideDeviceAccess(request, env);
      if (request.method === "POST" && pathname === "/api/admin/rotate-master-key") return await rotateMasterKey(request, env);
      if (request.method === "POST" && pathname === "/api/admin/create-key") return await createKey(request, env);
      if (request.method === "POST" && pathname === "/api/admin/renew-key") return await updateKey(request, env, "renew");
      if (request.method === "POST" && pathname === "/api/admin/set-key-expiry") return await updateKey(request, env, "expiry");
      if (request.method === "POST" && pathname === "/api/admin/toggle-key") return await updateKey(request, env, "toggle");
      if (request.method === "POST" && pathname === "/api/admin/reset-device") return await updateKey(request, env, "reset-device");
      if (request.method === "POST" && pathname === "/api/admin/reset-telegram") return await updateKey(request, env, "reset-telegram");
      if (request.method === "POST" && pathname === "/api/admin/delete-key") return await updateKey(request, env, "delete");
      if (request.method === "GET" && pathname === "/api/admin/users") return await listUsers(request, env);
      if (request.method === "POST" && pathname === "/api/admin/ban-user") return await setBan(request, env, true);
      if (request.method === "POST" && pathname === "/api/admin/unban-user") return await setBan(request, env, false);
      if ((request.method === "GET" || request.method === "DELETE") && pathname === "/api/admin/logs") return await handleLogs(request, env);
      if (request.method === "GET" && pathname === "/api/admin/content-status") return await handleContentStatus(request, env);
      if (request.method === "POST" && pathname === "/api/admin/refresh-movies") return await handleMovieRefresh(request, env);
      if (request.method === "POST" && pathname === "/api/admin/announcement") return await handleAnnouncementAdmin(request, env);
      if (request.method === "POST" && pathname === "/api/admin/set-force-update") return await handleForceUpdate(request, env);
      return textError("Không tìm thấy endpoint.", 404, "NOT_FOUND");
    } catch (error) {
      if (error.message === 'REQUEST_TOO_LARGE') return textError('Request body is too large.', 413, 'REQUEST_TOO_LARGE');
      return textError("Backend gặp lỗi nội bộ.", 500, "INTERNAL_ERROR");
    }
  },
};
