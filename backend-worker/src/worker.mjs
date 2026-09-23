import HomeCuration from '../../public/js/home-curation.js';
import {
  authenticateSession,
  issueSession,
  mediaSession,
  revokeSession,
  rotateSession,
} from './session-security.mjs';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, range, x-license-key, x-telegram-id, x-device-id, x-app-version, x-device-time, x-device-nonce, x-device-proof, x-refresh-token",
  "access-control-expose-headers": "accept-ranges, content-length, content-range, retry-after",
  "access-control-max-age": "86400",
};

const MAX_DURATION_DAYS = 3650;
const LICENSE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,63}$/;
const MASTER_KEY_MIN_LENGTH = 12;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const ADMIN_KEY_HASH_SETTING = "admin_key_hmac_v1";
const ANNOUNCEMENT_SETTING = "global_announcement_v1";
const MAINTENANCE_SETTING = "maintenance_mode_v1";
const MAX_ANNOUNCEMENT_MINUTES = 30 * 24 * 60;
const MAX_MAINTENANCE_MINUTES = 7 * 24 * 60;
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
  media: { limit: 1200, windowSeconds: 60 },
  default: { limit: 240, windowSeconds: 60 },
});

const INSTALLER_RELEASES = Object.freeze({
  "/download/android": {
    filename: "4K-Cinema-Android-3.55.apk",
    contentType: "application/vnd.android.package-archive",
    url: "https://drive.usercontent.google.com/download?id=1CMxjT0LyFnrwD2T8N2-ggbwuZJ0zvy0A&export=download&confirm=t",
  },
  "/download/android-tv": {
    filename: "4K-Cinema-Android-TV-3.55.apk",
    contentType: "application/vnd.android.package-archive",
    url: "https://drive.usercontent.google.com/download?id=1C6ZxnWeEdEi3h1fTPYRnX8TRgHe1if8g&export=download&confirm=t",
  },
  "/download/ios": {
    filename: "4K-Cinema-iOS-3.55-unsigned.ipa",
    contentType: "application/octet-stream",
    url: "https://drive.usercontent.google.com/download?id=1Qv25YSevfJmhvBX3hYqbk5jGFH_VVVr_&export=download&confirm=t",
  },
  "/download/windows": {
    filename: "4K-Cinema-Windows-3.55-x64.exe",
    contentType: "application/vnd.microsoft.portable-executable",
    url: "https://drive.usercontent.google.com/download?id=1uOmdX9AwTPVHFYQsTlQp0ifyvNmSYU4_&export=download&confirm=t",
  },
});

const PUBLIC_RELEASES = Object.freeze({
  android: Object.freeze({
    url: INSTALLER_RELEASES["/download/android"].url,
    version: "3.55",
    sha256: "c1cc73cb504ab90c7c7d8cbedf73f00c0484e13ab3d499b02d6aa37a4e1d44b4",
    sizeBytes: 3959616,
    signer: "github-actions[bot]",
  }),
  android_tv: Object.freeze({
    url: INSTALLER_RELEASES["/download/android-tv"].url,
    version: "3.55",
    sha256: "db161b95b46b5728ad8a4cdf53b1a3f4bdb3ec14802fa65882ed3671336a1df0",
    sizeBytes: 3959616,
    signer: "github-actions[bot]",
  }),
  ios: Object.freeze({
    url: INSTALLER_RELEASES["/download/ios"].url,
    version: "3.55",
    sha256: "43b3b432d14f1a404cb5a840518c38a27212870de2242724672ae5e7cae932b7",
    sizeBytes: 4411895,
    signer: "github-actions[bot]",
  }),
  windows: Object.freeze({
    url: INSTALLER_RELEASES["/download/windows"].url,
    version: "3.55",
    sha256: "1b2721c02e442c4abb4c48da854b153df24876d85f3fae72920adb2ecdb49f31",
    sizeBytes: 120964411,
    signer: "github-actions[bot]",
  }),
});

// Provider configuration belongs in encrypted Worker Secrets. The client only
// receives this Worker's origin plus short-lived, opaque AES-GCM capabilities.
const MEDIA_TICKET_AAD = new TextEncoder().encode("phim4k-media-ticket-v1");
const VPS_RELAY_SIGNATURE_CONTEXT = "phim4k-vps-relay-v1";
const IMAGE_TICKET_TTL_SECONDS = 90 * 24 * 60 * 60;
const STREAM_TICKET_TTL_SECONDS = 12 * 60 * 60;
const MAX_HLS_MANIFEST_BYTES = 2 * 1024 * 1024;
const MOVIE_AVAILABILITY_AUDIT_LIMIT = 12;
const MOVIE_AVAILABILITY_RECHECK_MINUTES = 30;
const movieAvailabilitySchemaPromises = new WeakMap();
const streamCResolutionPromises = new Map();
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
  // Keep the catalogue available when a Worker secret is accidentally missing.
  // The fallback is the same public provider used by the audited route set below.
  const raw = String(env?.MOVIE_CATALOG_ORIGIN || "https://phimapi.com").trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    // OPhim retired ophim1.com; transparently migrate a stale Worker secret
    // so production does not keep serving cached titles with broken artwork.
    if (url.hostname.toLowerCase() === "ophim1.com") url.hostname = "phimapi.com";
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url;
  } catch (_error) {
    return null;
  }
}

function configuredBackupCatalogOrigin(env) {
  const raw = String(env?.MOVIE_BACKUP_CATALOG_ORIGIN || "https://phim.nguonc.com").trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url;
  } catch (_error) {
    return null;
  }
}

function configuredOphimOrigin(env) {
  // EnsMovie keeps OPhim and PhimAPI as separate gateway candidates. Mirror
  // that behaviour without depending on EnsMovie's private signed gateway.
  const raw = String(env?.MOVIE_OPHIM_ORIGIN || "").trim();
  if (!raw) return null;
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
  const configured = String(env?.MOVIE_IMAGE_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9.-]+$/.test(value) && !value.startsWith(".") && !value.endsWith("."));
  // Keep the current CDN plus the legacy hostname during provider migration.
  // Without phimimg.com the catalog succeeds but every protected poster is blank.
  return new Set([...configured, "phimimg.com", "img.ophim.live", "phim.nguonc.com"]);
}

function configuredRelayOrigin(env) {
  // A stale relay secret must never hold playback hostage. Relay use is
  // opt-in; installations without a currently managed VPS stay Cloudflare-only.
  if (String(env?.VPS_RELAY_ENABLED || "") !== "1") return null;
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

async function handleInstallerDownload(request, pathname) {
  const release = INSTALLER_RELEASES[pathname];
  if (!release || !["GET", "HEAD"].includes(request.method)) {
    return textError("Không tìm thấy bản cài đặt.", 404, "INSTALLER_NOT_FOUND");
  }
  const upstreamHeaders = new Headers({ "user-agent": "4K-Cinema-Release/3.55" });
  const range = request.headers.get("range");
  if (range && /^bytes=\d*-\d*$/.test(range)) upstreamHeaders.set("range", range);
  const upstream = await fetch(release.url, {
    method: request.method,
    headers: upstreamHeaders,
    redirect: "follow",
  });
  if (!upstream.ok && upstream.status !== 206) {
    try { await upstream.body?.cancel(); } catch (_error) {}
    return textError("Bản cài đặt tạm thời chưa tải được.", 502, "INSTALLER_UPSTREAM_ERROR");
  }
  const headers = new Headers(CORS_HEADERS);
  headers.set("content-type", release.contentType);
  headers.set("content-disposition", `attachment; filename="${release.filename}"`);
  headers.set("cache-control", "public, max-age=3600, immutable");
  headers.set("x-content-type-options", "nosniff");
  for (const name of ["accept-ranges", "content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

function normalizeDeviceId(value) {
  const clean = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{3,128}$/.test(clean) ? clean : "";
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
  if (pathname === "/api/media/stream") return RATE_LIMITS.media;
  return RATE_LIMITS.default;
}

function distributedRateBinding(pathname, env) {
  if (pathname === "/api/auth/activate" || pathname === "/api/auth/request-device-access") return env.ACTIVATION_RATE_LIMITER;
  if (pathname === "/api/auth/status" || pathname === "/api/auth/device-status") return env.STATUS_RATE_LIMITER;
  if (pathname.startsWith("/api/admin/")) return env.ADMIN_RATE_LIMITER;
  if (pathname === "/api/media/stream") return env.MEDIA_RATE_LIMITER;
  return env.PUBLIC_RATE_LIMITER;
}

function distributedRateKey(request, pathname) {
  const ip = getClientIp(request);
  // Activation and administrative attempts are limited by edge IP. Status
  // checks use a stable identity so carrier NATs do not throttle viewers.
  if (pathname === "/api/auth/status" || pathname === "/api/auth/device-status") {
    return `status:${normalizeDeviceId(request.headers.get("x-device-id")) || ip}`;
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
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(env.ADMIN_KEY_PEPPER)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(normalizeKey(key)));
  return `hmac-sha256:${toHex(signature)}`;
}

async function legacyAdminKeyDigest(key, env) {
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
    const candidateHash = storedHash.startsWith("hmac-sha256:")
      ? await adminKeyDigest(key, env)
      : await legacyAdminKeyDigest(key, env);
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
  if (env.ALLOW_LEGACY_TEST_AUTH === "1" && !request.headers.get("authorization")) {
    return await verifyAdmin(request, env, env.DB) ? null : textError("Admin authorization required.", 403, "ADMIN_REQUIRED");
  }
  const identity = await verifiedSessionIdentity(request, env);
  if (identity.error) return identity.error;
  return identity.isAdmin ? null : textError("Admin authorization required.", 403, "ADMIN_REQUIRED");
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

const multiDeviceSchemaReady = new WeakSet();

async function ensureMultiDeviceSchema(db) {
  if (!db || typeof db !== "object" || multiDeviceSchemaReady.has(db)) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS license_limits (license_key TEXT PRIMARY KEY, max_devices INTEGER NOT NULL DEFAULT 1 CHECK(max_devices BETWEEN 1 AND 20), updated_at TEXT NOT NULL, FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE)",
  ).bind().run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS license_devices (license_key TEXT NOT NULL, device_id TEXT NOT NULL, slot INTEGER NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, approved_by TEXT, PRIMARY KEY (license_key, device_id), UNIQUE (license_key, slot), FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE)",
  ).bind().run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_license_devices_device ON license_devices(device_id)").bind().run();
  await db.prepare(
    "INSERT OR IGNORE INTO license_limits (license_key, max_devices, updated_at) SELECT license_key, 1, updated_at FROM license_keys",
  ).bind().run();
  await db.prepare(
    "INSERT OR IGNORE INTO license_devices (license_key, device_id, slot, created_at, last_seen_at, approved_by) SELECT license_key, device_id, 1, created_at, updated_at, 'legacy' FROM license_keys WHERE device_id IS NOT NULL AND TRIM(device_id) <> ''",
  ).bind().run();
  await db.prepare("DROP INDEX IF EXISTS idx_auth_sessions_active_user").bind().run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_active_user_device ON auth_sessions(license_key, device_id) WHERE role = 'user' AND revoked_at IS NULL",
  ).bind().run();
  multiDeviceSchemaReady.add(db);
}

async function licenseDeviceState(db, key) {
  await ensureMultiDeviceSchema(db);
  const limit = await queryOne(db, "SELECT max_devices FROM license_limits WHERE license_key = ?", key);
  const rows = await db.prepare(
    "SELECT device_id, slot, created_at, last_seen_at, approved_by FROM license_devices WHERE license_key = ? ORDER BY slot ASC",
  ).bind(key).all();
  const maxDevices = Math.min(20, Math.max(1, Number(limit?.max_devices || 1)));
  const devices = (rows.results || []).map((item) => ({
    deviceId: item.device_id,
    slot: Number(item.slot || 0),
    createdAt: item.created_at || "",
    lastSeenAt: item.last_seen_at || "",
    approvedBy: item.approved_by || "",
  }));
  // Compatibility fallback for databases/tests upgrading from the original
  // one-device column before license_devices has been populated.
  if (!devices.length) {
    const legacy = await queryOne(db, "SELECT device_id, created_at, updated_at FROM license_keys WHERE license_key = ?", key);
    const legacyDeviceId = normalizeDeviceId(legacy?.device_id);
    if (legacyDeviceId) {
      devices.push({
        deviceId: legacyDeviceId,
        slot: 1,
        createdAt: legacy?.created_at || "",
        lastSeenAt: legacy?.updated_at || "",
        approvedBy: "legacy",
      });
    }
  }
  return { maxDevices, deviceCount: devices.length, devices };
}

async function registerLicenseDevice(db, key, deviceId, { approvedBy = "activation" } = {}) {
  const cleanDeviceId = normalizeDeviceId(deviceId);
  if (!cleanDeviceId) return { allowed: false, code: "INVALID_DEVICE_ID" };
  const state = await licenseDeviceState(db, key);
  const existing = state.devices.find((item) => item.deviceId === cleanDeviceId);
  if (existing) {
    await db.prepare("UPDATE license_devices SET last_seen_at = ? WHERE license_key = ? AND device_id = ?")
      .bind(now(), key, cleanDeviceId).run();
    return { allowed: true, ...state, existing: true };
  }
  if (state.deviceCount >= state.maxDevices) {
    return { allowed: false, code: "DEVICE_LIMIT_REACHED", ...state };
  }
  const timestamp = now();
  for (let slot = 1; slot <= state.maxDevices; slot += 1) {
    try {
      await db.prepare(
        "INSERT INTO license_devices (license_key, device_id, slot, created_at, last_seen_at, approved_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(key, cleanDeviceId, slot, timestamp, timestamp, String(approvedBy || "activation").slice(0, 80)).run();
      await db.prepare(
        "UPDATE license_keys SET device_id = COALESCE(device_id, ?), updated_at = ? WHERE license_key = ?",
      ).bind(cleanDeviceId, timestamp, key).run();
      const nextState = await licenseDeviceState(db, key);
      return { allowed: true, ...nextState, existing: false };
    } catch (_error) {
      const concurrent = await queryOne(db, "SELECT slot FROM license_devices WHERE license_key = ? AND device_id = ?", key, cleanDeviceId);
      if (concurrent) {
        const nextState = await licenseDeviceState(db, key);
        return { allowed: true, ...nextState, existing: true };
      }
    }
  }
  const latest = await licenseDeviceState(db, key);
  return { allowed: false, code: "DEVICE_LIMIT_REACHED", ...latest };
}

async function removeLicenseDevice(db, key, deviceId) {
  await ensureMultiDeviceSchema(db);
  const cleanDeviceId = normalizeDeviceId(deviceId);
  if (!cleanDeviceId) return;
  const timestamp = now();
  await db.prepare("DELETE FROM license_devices WHERE license_key = ? AND device_id = ?").bind(key, cleanDeviceId).run();
  await db.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE license_key = ? AND device_id = ? AND revoked_at IS NULL")
    .bind(timestamp, timestamp, key, cleanDeviceId).run();
  const replacement = await queryOne(db, "SELECT device_id FROM license_devices WHERE license_key = ? ORDER BY slot ASC LIMIT 1", key);
  await db.prepare("UPDATE license_keys SET device_id = ?, updated_at = ? WHERE license_key = ?")
    .bind(replacement?.device_id || null, timestamp, key).run();
}


function sessionError(code) {
  const values = {
    ACCESS_TOKEN_REQUIRED: ["Phiên đăng nhập là bắt buộc.", 401],
    ACCESS_TOKEN_EXPIRED: ["Phiên truy cập đã hết hạn.", 401],
    SESSION_EXPIRED: ["Phiên đăng nhập đã hết hạn.", 401],
    SESSION_REVOKED: ["Phiên đăng nhập đã bị thu hồi.", 401],
    REFRESH_TOKEN_REQUIRED: ["Thiếu mã làm mới phiên.", 401],
    REFRESH_TOKEN_INVALID: ["Mã làm mới phiên không hợp lệ.", 401],
    REFRESH_TOKEN_REUSED: ["Phát hiện mã làm mới đã được dùng lại; toàn bộ phiên đã bị thu hồi.", 401],
    DEVICE_MISMATCH: ["Thiết bị không khớp với phiên đã kích hoạt.", 403],
    DEVICE_PROOF_REQUIRED: ["Thiếu chữ ký xác thực thiết bị.", 401],
    DEVICE_PROOF_KEY_INVALID: ["Khóa xác thực thiết bị không hợp lệ.", 401],
    DEVICE_PROOF_INVALID: ["Chữ ký thiết bị không hợp lệ.", 401],
    DEVICE_PROOF_EXPIRED: ["Chữ ký thiết bị đã quá hạn.", 401],
    DEVICE_PROOF_REPLAYED: ["Yêu cầu đã được sử dụng trước đó.", 409],
  };
  const [message, status] = values[code] || ["Phiên đăng nhập không hợp lệ.", 401];
  return textError(message, status, code || "SESSION_INVALID");
}

async function authorizeSessionRecord(session, env) {
  if (!session) return { error: sessionError("SESSION_REVOKED") };
  if (session.role === "admin") {
    const configuredTelegram = normalizeId(env.ADMIN_TELEGRAM_ID);
    if (!configuredTelegram || !equalString(normalizeId(session.telegram_id), configuredTelegram)) {
      await revokeSession(env.DB, session.session_id);
      return { error: textError("Admin authorization required.", 403, "ADMIN_REQUIRED") };
    }
    return {
      session,
      sessionId: session.session_id,
      telegramId: configuredTelegram,
      deviceId: session.device_id,
      isAdmin: true,
      freeAccess: false,
      plan: "MASTER",
      keyHint: "ADMIN",
      expiresAt: null,
    };
  }

  const maintenance = await getMaintenance(env.DB);
  if (maintenance.active) return { error: maintenanceError(maintenance) };
  if (session.role === "guest") {
    if (!await freeAccessEnabled(env.DB)) {
      await revokeSession(env.DB, session.session_id);
      return { error: textError("Chế độ không cần key đã được tắt.", 401, "FREE_ACCESS_DISABLED") };
    }
    return {
      session,
      sessionId: session.session_id,
      telegramId: "",
      deviceId: session.device_id,
      isAdmin: false,
      freeAccess: true,
      plan: "MIỄN KEY",
      keyHint: "",
      expiresAt: null,
    };
  }

  if (session.role !== "user" || !validKey(normalizeKey(session.license_key))) {
    await revokeSession(env.DB, session.session_id);
    return { error: sessionError("SESSION_REVOKED") };
  }
  const record = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", normalizeKey(session.license_key));
  if (!record || !record.active) {
    await revokeSession(env.DB, session.session_id);
    return { error: textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED") };
  }
  if (isExpired(record.expires_at)) {
    await revokeSession(env.DB, session.session_id);
    return { error: textError("Key đã hết hạn.", 403, "KEY_EXPIRED") };
  }
  const deviceState = await licenseDeviceState(env.DB, record.license_key);
  if (!deviceState.devices.some((item) => item.deviceId === session.device_id)) {
    await revokeSession(env.DB, session.session_id);
    return { error: sessionError("DEVICE_MISMATCH") };
  }
  await env.DB.prepare("UPDATE license_devices SET last_seen_at = ? WHERE license_key = ? AND device_id = ?")
    .bind(now(), record.license_key, session.device_id).run();
  const owner = normalizeId(record.activated_telegram_id || record.assigned_telegram_id);
  if (owner && await queryOne(env.DB, "SELECT reason FROM bans WHERE telegram_id = ?", owner)) {
    await revokeSession(env.DB, session.session_id);
    return { error: textError("Tài khoản đã bị khóa.", 403, "USER_BANNED") };
  }
  return {
    session,
    sessionId: session.session_id,
    telegramId: owner,
    deviceId: session.device_id,
    isAdmin: false,
    freeAccess: false,
    plan: record.plan,
    keyHint: maskedValue(record.license_key),
    expiresAt: record.expires_at || null,
    licenseKey: record.license_key,
    maxDevices: deviceState.maxDevices,
    deviceCount: deviceState.deviceCount,
  };
}

async function verifiedSessionIdentity(request, env) {
  const authenticated = await authenticateSession(request, env.DB);
  if (authenticated.error) return { error: sessionError(authenticated.error) };
  return authorizeSessionRecord(authenticated.session, env);
}

async function logEvent(db, action, { actorTelegramId = "", targetKey = "", targetTelegramId = "", detail = "" } = {}) {
  try {
    await db.prepare(
      "INSERT INTO audit_logs (created_at, action, actor_telegram_id, target_key, target_telegram_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(now(), action, actorTelegramId, targetKey ? maskedValue(targetKey) : "", targetTelegramId, String(detail).slice(0, 500)).run();
  } catch (_error) {
    // Audit logging must not turn an otherwise valid authorization result into a failure.
  }
}

async function verifyLegacyTelemetryViewer(request, env) {
  const key = requestKey(request);
  const telegramId = requestTelegram(request);
  const deviceId = normalizeDeviceId(request.headers.get("x-device-id"));
  if (!deviceId) return { error: textError("Thiếu phiên người dùng hợp lệ.", 401, "VIEWER_SESSION_REQUIRED") };
  if (!key) {
    const maintenance = await getMaintenance(env.DB);
    if (maintenance.active) return { error: maintenanceError(maintenance) };
    if (await freeAccessEnabled(env.DB)) return {telegramId: '', deviceId, isAdmin: false};
  }
  if (!key) return {error: textError('Vui lòng nhập key.', 401, 'KEY_REQUIRED')};

  if (await verifyMasterKey(key, env, env.DB)) {
    if (!await verifyAdminIdentity(key, telegramId, env, env.DB)) {
      return { error: textError("Phiên quản trị không hợp lệ.", 403, "ADMIN_TELEGRAM_REQUIRED") };
    }
    return { telegramId, deviceId, isAdmin: true };
  }
  const maintenance = await getMaintenance(env.DB);
  if (maintenance.active) return { error: maintenanceError(maintenance) };
  if (!validKey(key)) return { error: textError("Key không hợp lệ.", 401, "INVALID_KEY_FORMAT") };
  const record = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record || !record.active || isExpired(record.expires_at)) {
    return { error: textError("Phiên người dùng đã hết hiệu lực.", 403, "VIEWER_SESSION_INACTIVE") };
  }
  const deviceState = await licenseDeviceState(env.DB, key);
  if (!deviceState.devices.some((item) => item.deviceId === deviceId)) {
    return { error: textError("Thiết bị không khớp với phiên đã kích hoạt.", 403, "DEVICE_MISMATCH") };
  }
  const boundTelegram = normalizeId(record.activated_telegram_id || record.assigned_telegram_id);
  if (boundTelegram) {
    const ban = await queryOne(env.DB, "SELECT reason FROM bans WHERE telegram_id = ?", boundTelegram);
    if (ban) return { error: textError("Tài khoản đã bị khóa.", 403, "USER_BANNED") };
  }
  return { telegramId: boundTelegram, deviceId, isAdmin: false };
}

async function verifyTelemetryViewer(request, env) {
  if (env.ALLOW_LEGACY_TEST_AUTH === "1" && !request.headers.get("authorization")) {
    return verifyLegacyTelemetryViewer(request, env);
  }
  return verifiedSessionIdentity(request, env);
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
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_watch_progress_owner_updated ON watch_progress(owner_id, updated_at DESC)",
  ).run();
}

async function progressOwner(request, env) {
  const identity = await verifyTelemetryViewer(request, env);
  if (identity.error) return identity;
  // In production the account namespace comes only from the verified server
  // session. A caller cannot switch another account's history by supplying an
  // x-license-key header. Legacy headers remain isolated to explicit tests.
  const key = env.ALLOW_LEGACY_TEST_AUTH === "1" ? requestKey(request) : identity.licenseKey;
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
    "DELETE FROM watch_progress WHERE owner_id = ? AND rowid NOT IN (SELECT rowid FROM watch_progress WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50)",
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

  const storedRelease = await queryOne(db, "SELECT url, version, sha256, size_bytes, signer FROM downloads WHERE platform = ?", platform);
  const release = preferredRelease(platform, storedRelease);
  const releaseVersion = String(release?.version || "").trim();
  if (!release || !validDownloadUrl(release.url) || !validReleaseSha256(release.sha256) || !/^\d+(?:\.\d+){1,3}$/.test(releaseVersion)) return forceStatus;
  if (compareAppVersions(currentVersion, releaseVersion) >= 0) return forceStatus;

  return {
    ...forceStatus,
    forceUpdate: true,
    isLatest: false,
    latestVersion: releaseVersion,
    minVersion: releaseVersion,
    downloadUrl: release.url,
    downloadSha256: String(release.sha256).toLowerCase(),
    downloadSizeBytes: validReleaseSize(release.sizeBytes) ? Number(release.sizeBytes) : 0,
    downloadSigner: cleanProgressText(release.signer, 200),
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

export function normalizeMaintenanceSetting(raw, timestamp = Date.now()) {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch (_error) { value = null; }
  }
  if (!value || typeof value !== "object" || !value.enabled) return { active: false };
  const message = String(value.message || "Hệ thống đang được nâng cấp. Vui lòng quay lại sau.")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
  const startedAt = String(value.startedAt || "");
  const expiresAt = String(value.expiresAt || "");
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= timestamp)) return { active: false };
  return { active: true, message, startedAt, expiresAt };
}

async function getMaintenance(db) {
  const row = await queryOne(db, "SELECT setting_value FROM app_settings WHERE setting_key = ?", MAINTENANCE_SETTING);
  return normalizeMaintenanceSetting(row?.setting_value);
}

function maintenanceError(maintenance) {
  const retryAfter = maintenance.expiresAt
    ? Math.max(30, Math.min(3600, Math.ceil((Date.parse(maintenance.expiresAt) - Date.now()) / 1000)))
    : 300;
  return json({
    success: false,
    active: false,
    code: "MAINTENANCE_MODE",
    error: maintenance.message,
    message: maintenance.message,
    maintenance,
  }, 503, { "retry-after": String(retryAfter) });
}

async function handleMaintenanceAdmin(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const body = await parseBody(request);
  if (typeof body.enabled !== "boolean") return textError("Trạng thái bảo trì không hợp lệ.", 400, "INVALID_MAINTENANCE_STATE");
  const timestamp = now();
  if (!body.enabled) {
    const value = JSON.stringify({ enabled: false, endedAt: timestamp });
    await env.DB.prepare(
      "INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at",
    ).bind(MAINTENANCE_SETTING, value, timestamp).run();
    await logEvent(env.DB, "admin_maintenance_disabled", { actorTelegramId: requestTelegram(request) });
    return json({ success: true, maintenance: { active: false }, message: "Đã mở lại ứng dụng cho người dùng." });
  }

  const message = String(body.message || "Hệ thống đang được nâng cấp. Vui lòng quay lại sau.")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
  const durationMinutes = Number.parseInt(String(body.durationMinutes || "0"), 10);
  if (!message) return textError("Hãy nhập nội dung bảo trì.", 400, "MAINTENANCE_MESSAGE_REQUIRED");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > MAX_MAINTENANCE_MINUTES) {
    return textError("Thời gian bảo trì phải từ 0 phút đến 7 ngày; chọn 0 để tự tắt thủ công.", 400, "INVALID_MAINTENANCE_DURATION");
  }
  const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString() : "";
  const value = { enabled: true, message, startedAt: timestamp, expiresAt };
  await env.DB.prepare(
    "INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at",
  ).bind(MAINTENANCE_SETTING, JSON.stringify(value), timestamp).run();
  await logEvent(env.DB, "admin_maintenance_enabled", {
    actorTelegramId: requestTelegram(request), detail: JSON.stringify({ durationMinutes, expiresAt }),
  });
  return json({ success: true, maintenance: normalizeMaintenanceSetting(value), message: "Đã bật chế độ bảo trì." });
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
  return json({success: true, freeAccess: await freeAccessEnabled(env.DB), maintenance: await getMaintenance(env.DB)});
}

async function activationStatus({ db, key, telegramId, deviceId, request, env, activation }) {
  if (!deviceId) return textError('Thiếu mã thiết bị.', 400, 'MISSING_LICENSE_DATA');
  if (!key) {
    const maintenance = await getMaintenance(db);
    if (maintenance.active) return maintenanceError(maintenance);
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
  const maintenance = await getMaintenance(db);
  if (maintenance.active) return maintenanceError(maintenance);
  if (!validKey(key)) return textError("Định dạng key không hợp lệ.", 400, "INVALID_KEY_FORMAT");

  const record = await queryOne(db, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record) return textError("Key không tồn tại.", 404, "KEY_NOT_FOUND");
  if (!record.active) return textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED");
  if (isExpired(record.expires_at)) return textError("Key đã hết hạn.", 403, "KEY_EXPIRED");
  const owner = record.activated_telegram_id || record.assigned_telegram_id;
  if (owner && await queryOne(db, 'SELECT reason FROM bans WHERE telegram_id = ?', owner)) return textError('Tài khoản đã bị khóa.', 403, 'USER_BANNED');

  let deviceState = await licenseDeviceState(db, key);
  let isBoundDevice = deviceState.devices.some((item) => item.deviceId === deviceId);
  if (!isBoundDevice && activation) {
    const registration = await registerLicenseDevice(db, key, deviceId);
    if (!registration.allowed) {
      return json({
        success: false,
        active: false,
        code: "DEVICE_LIMIT_REACHED",
        message: `Key này đã đủ ${registration.maxDevices || 1} thiết bị. Liên hệ Admin để tăng giới hạn hoặc gỡ thiết bị cũ.`,
        maxDevices: registration.maxDevices || 1,
        deviceCount: registration.deviceCount || 0,
      }, 403);
    }
    deviceState = registration;
    isBoundDevice = true;
    await logEvent(db, "license_activated", {
      detail: `key=${maskedValue(key)} device=${maskedValue(deviceId, 6)} slots=${registration.deviceCount}/${registration.maxDevices} version=${appVersion(request)}`,
    });
  }

  if (!isBoundDevice) {
    return json({
      success: false,
      active: false,
      code: "DEVICE_MISMATCH",
      message: "Thiết bị này chưa được gắn với key.",
      maxDevices: deviceState.maxDevices,
      deviceCount: deviceState.deviceCount,
    }, 403);
  }
  await db.prepare("UPDATE license_devices SET last_seen_at = ? WHERE license_key = ? AND device_id = ?")
    .bind(now(), key, deviceId).run();

  const bound = await queryOne(db, 'SELECT * FROM license_keys WHERE license_key = ?', key);
  if (!bound?.active || isExpired(bound.expires_at)) return textError('Key không còn hiệu lực.', 403, 'KEY_DISABLED');

  const force = await getForceUpdate(db, appVersion(request));
  return json({
    success: true,
    active: true,
    isAdmin: false,
    keyOnly: true,
    plan: bound.plan,
    expiresAt: bound.expires_at || null,
    maxDevices: deviceState.maxDevices,
    deviceCount: deviceState.deviceCount,
    ...force,
  });
}

function sessionClientPayload(identity, tokens = {}) {
  return {
    success: true,
    active: true,
    isAdmin: Boolean(identity.isAdmin),
    freeAccess: Boolean(identity.freeAccess),
    keyOnly: !identity.isAdmin && !identity.freeAccess,
    plan: identity.plan || "STANDARD",
    keyHint: identity.keyHint || "",
    expiresAt: identity.expiresAt || null,
    maxDevices: Number(identity.maxDevices || 0) || undefined,
    deviceCount: Number(identity.deviceCount || 0) || undefined,
    ...tokens,
  };
}

async function activateSession(request, env) {
  const body = await parseBody(request);
  const key = normalizeKey(body.key);
  const telegramId = normalizeId(body.telegramId);
  const deviceId = normalizeDeviceId(body.deviceId);
  const decision = await activationStatus({ db: env.DB, key, telegramId, deviceId, request, env, activation: true });
  if (env.ALLOW_LEGACY_TEST_AUTH === "1") return decision;
  if (!decision.ok) return decision;
  const payload = await decision.clone().json().catch(() => ({}));
  if (!payload.success || !payload.active || payload.forceUpdate) {
    return payload.forceUpdate ? json({ ...payload, active: false }) : decision;
  }

  let tokens;
  try {
    tokens = await issueSession({
      db: env.DB,
      role: payload.isAdmin ? "admin" : payload.freeAccess ? "guest" : "user",
      licenseKey: payload.isAdmin || payload.freeAccess ? "" : key,
      telegramId: payload.isAdmin ? telegramId : "",
      deviceId,
      plan: payload.plan || "STANDARD",
      devicePublicKey: body.devicePublicKey,
    });
  } catch (error) {
    if (error.message === "DEVICE_KEY_REQUIRED") {
      return textError("Thiết bị không tạo được khóa xác thực an toàn.", 400, "DEVICE_KEY_REQUIRED");
    }
    throw error;
  }
  await logEvent(env.DB, "session_issued", {
    actorTelegramId: payload.isAdmin ? telegramId : "",
    targetKey: key,
    detail: `role=${payload.isAdmin ? "admin" : payload.freeAccess ? "guest" : "user"} device=${maskedValue(deviceId, 6)}`,
  });
  return json({
    ...payload,
    keyHint: key ? maskedValue(key) : "",
    ...tokens,
  });
}

async function sessionStatus(request, env) {
  const identity = await verifiedSessionIdentity(request, env);
  if (identity.error) return identity.error;
  let force = await getForceUpdate(env.DB, appVersion(request));
  if (identity.isAdmin) force = await getVerifiedAdminUpdate(env.DB, request, force);
  return json({ ...sessionClientPayload(identity), active: !force.forceUpdate, ...force });
}

async function refreshSession(request, env) {
  const body = await parseBody(request);
  const rotated = await rotateSession(request, env.DB, body);
  if (rotated.error) return sessionError(rotated.error);
  const identity = await authorizeSessionRecord(rotated.session, env);
  if (identity.error) {
    await revokeSession(env.DB, rotated.session.session_id);
    return identity.error;
  }
  const force = identity.isAdmin
    ? await getVerifiedAdminUpdate(env.DB, request, await getForceUpdate(env.DB, appVersion(request)))
    : await getForceUpdate(env.DB, appVersion(request));
  if (force.forceUpdate) {
    await revokeSession(env.DB, rotated.session.session_id);
    return json({ ...sessionClientPayload(identity), active: false, ...force });
  }
  return json({
    ...sessionClientPayload(identity, {
      sessionId: rotated.sessionId,
      accessToken: rotated.accessToken,
      accessExpiresAt: rotated.accessExpiresAt,
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.refreshExpiresAt,
    }),
    ...force,
  });
}

async function logoutSession(request, env) {
  const authenticated = await authenticateSession(request, env.DB);
  if (authenticated.error) return sessionError(authenticated.error);
  await revokeSession(env.DB, authenticated.session.session_id);
  return json({ success: true, active: false, message: "Đã đăng xuất và thu hồi phiên trên máy chủ." });
}

async function ensureDeviceAccessTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS device_access_requests (license_key TEXT NOT NULL, device_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), requested_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, PRIMARY KEY (license_key, device_id), FOREIGN KEY (license_key) REFERENCES license_keys(license_key) ON DELETE CASCADE)",
  ).bind().run();
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
        text: `MNHUT: Có yêu cầu duyệt thiết bị.\nKey: ${maskedValue(key)}\nThiết bị: ${maskedValue(deviceId, 6)}\nMở Panel Admin > Yêu cầu thiết bị để xử lý.`,
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
  const deviceId = normalizeDeviceId(body.deviceId);
  if (!validKey(key) || !deviceId) return textError("Nhập key hợp lệ để gửi yêu cầu cho Admin.", 400, "INVALID_DEVICE_REQUEST");
  if (await verifyMasterKey(key, env, env.DB)) return textError("Key Admin bắt buộc dùng Telegram ID quản trị.", 403, "ADMIN_TELEGRAM_REQUIRED");
  const maintenance = await getMaintenance(env.DB);
  if (maintenance.active) return maintenanceError(maintenance);

  const record = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  if (!record) return textError("Key không tồn tại.", 404, "KEY_NOT_FOUND");
  if (!record.active) return textError("Key đã bị vô hiệu hóa.", 403, "KEY_DISABLED");
  if (isExpired(record.expires_at)) return textError("Key đã hết hạn.", 403, "KEY_EXPIRED");

  await ensureDeviceAccessTable(env.DB);
  await env.DB.prepare(
    "INSERT INTO device_access_requests (license_key, device_id, status, requested_at) VALUES (?, ?, 'pending', ?) ON CONFLICT(license_key, device_id) DO UPDATE SET status = CASE WHEN device_access_requests.status = 'approved' THEN 'approved' ELSE 'pending' END, requested_at = CASE WHEN device_access_requests.status = 'approved' THEN device_access_requests.requested_at ELSE excluded.requested_at END, decided_at = CASE WHEN device_access_requests.status = 'approved' THEN device_access_requests.decided_at ELSE NULL END, decided_by = CASE WHEN device_access_requests.status = 'approved' THEN device_access_requests.decided_by ELSE NULL END",
  ).bind(key, deviceId, now()).run();
  const existing = await queryOne(env.DB, "SELECT status FROM device_access_requests WHERE license_key = ? AND device_id = ?", key, deviceId);
  if (existing?.status === "approved") {
    const state = await licenseDeviceState(env.DB, key);
    if (state.devices.some((item) => item.deviceId === deviceId)) {
      return json({ success: true, status: "approved", message: "Thiết bị đã được Admin cấp phép.", maxDevices: state.maxDevices, deviceCount: state.deviceCount });
    }
    await env.DB.prepare(
      "UPDATE device_access_requests SET status = 'pending', requested_at = ?, decided_at = NULL, decided_by = NULL WHERE license_key = ? AND device_id = ?",
    ).bind(now(), key, deviceId).run();
  }
  const notified = await notifyDeviceRequest(env, key, deviceId);
  await logEvent(env.DB, "device_access_requested", { targetKey: key, detail: `device=${maskedValue(deviceId, 6)} notified=${notified}` });
  return json({ success: true, status: "pending", notified, message: notified ? "Đã báo Admin. Ứng dụng sẽ tự kiểm tra trạng thái duyệt." : "Đã gửi yêu cầu vào Panel Admin. Ứng dụng sẽ tự kiểm tra trạng thái duyệt." });
}

async function deviceAccessStatus(request, env) {
  // Authentication material is header-only. Query parameters are commonly
  // retained in browser history, CDN logs and support screenshots.
  const key = requestKey(request);
  const deviceId = normalizeDeviceId(request.headers.get('x-device-id'));
  if (!validKey(key) || !deviceId) return textError("Thiếu key hoặc mã thiết bị.", 400, "MISSING_DEVICE_LICENSE_DATA");
  const maintenance = await getMaintenance(env.DB);
  if (maintenance.active) return maintenanceError(maintenance);
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
  const state = await licenseDeviceState(env.DB, key);
  if (!state.devices.some((item) => item.deviceId === deviceId)) return textError("Quyền thiết bị đã thay đổi. Hãy gửi yêu cầu mới.", 403, "DEVICE_MISMATCH");
  const force = await getForceUpdate(env.DB, appVersion(request));
  return json({
    success: true,
    active: true,
    status: "approved",
    requiresActivation: true,
    isAdmin: false,
    plan: record.plan,
    keyHint: maskedValue(key),
    expiresAt: record.expires_at || null,
    maxDevices: state.maxDevices,
    deviceCount: state.deviceCount,
    ...force,
  });
}

async function listDeviceAccessRequests(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  await ensureDeviceAccessTable(env.DB);
  const rows = await env.DB.prepare(
    "SELECT r.license_key, r.device_id, r.status, r.requested_at, r.decided_at, k.plan, k.expires_at, k.active FROM device_access_requests r JOIN license_keys k ON k.license_key = r.license_key ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.requested_at DESC LIMIT 100",
  ).bind().all();
  return json({ requests: rows.results || [] });
}

async function decideDeviceAccess(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const body = await parseBody(request);
  const key = normalizeKey(body.key);
  const deviceId = normalizeDeviceId(body.deviceId);
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
  if (!validKey(key) || !deviceId || !decision) return textError("Yêu cầu duyệt không hợp lệ.", 400, "INVALID_DECISION");
  await ensureDeviceAccessTable(env.DB);
  const pending = await queryOne(env.DB, "SELECT status FROM device_access_requests WHERE license_key = ? AND device_id = ?", key, deviceId);
  if (!pending) return textError("Không tìm thấy yêu cầu thiết bị.", 404, "REQUEST_NOT_FOUND");
  const timestamp = now();
  if (decision === "approved") {
    const record = await queryOne(env.DB, "SELECT active, expires_at FROM license_keys WHERE license_key = ?", key);
    if (!record || !record.active || isExpired(record.expires_at)) return textError("Key không còn hoạt động.", 403, "KEY_INACTIVE");
    const registration = await registerLicenseDevice(env.DB, key, deviceId, { approvedBy: requestTelegram(request) || "admin" });
    if (!registration.allowed) {
      return json({
        success: false,
        code: "DEVICE_LIMIT_REACHED",
        message: `Key đã đủ ${registration.maxDevices || 1} thiết bị. Hãy tăng giới hạn thiết bị hoặc gỡ máy cũ trước.`,
        maxDevices: registration.maxDevices || 1,
        deviceCount: registration.deviceCount || 0,
      }, 409);
    }
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
  await ensureMultiDeviceSchema(env.DB);
  const rows = await env.DB.prepare("SELECT * FROM license_keys ORDER BY created_at DESC").bind().all();
  const deviceRows = await env.DB.prepare("SELECT license_key, device_id, slot, created_at, last_seen_at FROM license_devices ORDER BY license_key, slot").bind().all();
  const limitRows = await env.DB.prepare("SELECT license_key, max_devices FROM license_limits").bind().all();
  const devicesByKey = new Map();
  for (const item of (deviceRows.results || [])) {
    if (!devicesByKey.has(item.license_key)) devicesByKey.set(item.license_key, []);
    devicesByKey.get(item.license_key).push({
      deviceId: item.device_id,
      slot: Number(item.slot || 0),
      createdAt: item.created_at || "",
      lastSeenAt: item.last_seen_at || "",
    });
  }
  const limits = new Map((limitRows.results || []).map((item) => [item.license_key, Math.min(20, Math.max(1, Number(item.max_devices || 1)))]));
  const keys = (rows.results || []).map((item) => {
    const payload = keyPayload(item, true);
    const devices = devicesByKey.get(item.license_key) || [];
    payload.devices = devices;
    payload.deviceCount = devices.length;
    payload.maxDevices = limits.get(item.license_key) || 1;
    payload.boundDeviceId = devices[0]?.deviceId || item.device_id || "";
    return payload;
  });
  const banCount = await queryOne(env.DB, "SELECT COUNT(*) AS total FROM bans");
  return json({
    keys,
    stats: {
      totalKeys: keys.length,
      activeKeys: keys.filter((item) => item.active).length,
      boundDevices: keys.reduce((total, item) => total + Number(item.deviceCount || 0), 0),
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
  const requestedDurationDays = Number.parseInt(String(body.durationDays ?? ""), 10);
  const isLifetime = requestedDurationDays === 0;
  const durationDays = isLifetime ? 0 : numericDays(requestedDurationDays);
  const assignedTelegramId = normalizeId(body.assignedTelegramId);
  const maxDevices = Number.parseInt(String(body.maxDevices || "1"), 10);
  if (!validKey(key)) return textError("Key phải gồm chữ in hoa, số hoặc dấu gạch ngang.", 400, "INVALID_KEY_FORMAT");
  if (!isLifetime && !durationDays) return textError("Thời hạn key phải từ 1 đến 3650 ngày hoặc 0 để dùng vĩnh viễn.", 400, "INVALID_DURATION");
  if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) return textError("Giới hạn thiết bị phải từ 1 đến 20.", 400, "INVALID_DEVICE_LIMIT");
  if (assignedTelegramId && !validTelegramId(assignedTelegramId)) return textError("Telegram ID is invalid.", 400, "INVALID_TELEGRAM_ID");
  const createdAt = now();
  try {
    await ensureMultiDeviceSchema(env.DB);
    await env.DB.prepare(
      "INSERT INTO license_keys (license_key, plan, expires_at, active, assigned_telegram_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    ).bind(
      key,
      String(body.plan || "STANDARD").trim().slice(0, 64) || "STANDARD",
      isLifetime ? null : plusDays(null, durationDays),
      assignedTelegramId,
      createdAt,
      createdAt,
    ).run();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO license_limits (license_key, max_devices, updated_at) VALUES (?, ?, ?)",
    ).bind(key, maxDevices, createdAt).run();
  } catch (_error) {
    return textError("Key đã tồn tại.", 409, "KEY_ALREADY_EXISTS");
  }
  await logEvent(env.DB, "key_created", {
    actorTelegramId: requestTelegram(request),
    targetKey: key,
    detail: `days=${isLifetime ? "lifetime" : durationDays} maxDevices=${maxDevices}`,
  });
  return json({ success: true, message: `Đã tạo key · tối đa ${maxDevices} thiết bị.`, key, maxDevices }, 201);
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
    await ensureMultiDeviceSchema(env.DB);
    await env.DB.prepare("DELETE FROM license_devices WHERE license_key = ?").bind(key).run();
    await env.DB.prepare("UPDATE license_keys SET device_id = NULL, updated_at = ? WHERE license_key = ?").bind(timestamp, key).run();
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE license_key = ? AND revoked_at IS NULL").bind(timestamp, timestamp, key).run();
    message = "Đã gỡ toàn bộ thiết bị khỏi key.";
  } else if (operation === "max-devices") {
    await ensureMultiDeviceSchema(env.DB);
    const maxDevices = Number.parseInt(String(body.maxDevices || ""), 10);
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) {
      return textError("Giới hạn thiết bị phải từ 1 đến 20.", 400, "INVALID_DEVICE_LIMIT");
    }
    const state = await licenseDeviceState(env.DB, key);
    if (maxDevices < state.deviceCount) {
      return json({
        success: false,
        code: "DEVICE_LIMIT_BELOW_ACTIVE",
        message: `Key đang có ${state.deviceCount} thiết bị. Hãy gỡ bớt thiết bị trước khi giảm giới hạn xuống ${maxDevices}.`,
        deviceCount: state.deviceCount,
        maxDevices: state.maxDevices,
      }, 409);
    }
    await env.DB.prepare(
      "INSERT INTO license_limits (license_key, max_devices, updated_at) VALUES (?, ?, ?) ON CONFLICT(license_key) DO UPDATE SET max_devices = excluded.max_devices, updated_at = excluded.updated_at",
    ).bind(key, maxDevices, timestamp).run();
    message = `Đã đặt key dùng tối đa ${maxDevices} thiết bị.`;
  } else if (operation === "reset-telegram") {
    const newTelegramId = normalizeId(body.newTelegramId);
    if (newTelegramId && !validTelegramId(newTelegramId)) return textError("Telegram ID is invalid.", 400, "INVALID_TELEGRAM_ID");
    await env.DB.prepare("UPDATE license_keys SET assigned_telegram_id = ?, activated_telegram_id = NULL, updated_at = ? WHERE license_key = ?").bind(newTelegramId, timestamp, key).run();
    message = "Đã cập nhật Telegram cho key.";
  } else if (operation === "delete") {
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE license_key = ? AND revoked_at IS NULL").bind(timestamp, timestamp, key).run();
    await env.DB.prepare("DELETE FROM license_keys WHERE license_key = ?").bind(key).run();
    message = "Đã xóa key.";
  } else {
    return textError("Thao tác key không được hỗ trợ.", 404, "UNKNOWN_KEY_OPERATION");
  }
  if (operation === "toggle") {
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE license_key = ? AND revoked_at IS NULL")
      .bind(timestamp, timestamp, key).run();
  }
  await logEvent(env.DB, `key_${operation}`, { actorTelegramId: requestTelegram(request), targetKey: key });
  return json({ success: true, message });
}

async function listUsers(request, env) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  await ensureMultiDeviceSchema(env.DB);
  const [rows, deviceRows, limitRows] = await Promise.all([
    env.DB.prepare(
      "SELECT license_keys.*, bans.telegram_id AS banned_telegram_id, bans.reason AS ban_reason FROM license_keys LEFT JOIN bans ON bans.telegram_id = COALESCE(license_keys.activated_telegram_id, license_keys.assigned_telegram_id) ORDER BY license_keys.updated_at DESC",
    ).bind().all(),
    env.DB.prepare("SELECT license_key, device_id, slot, last_seen_at FROM license_devices ORDER BY license_key, slot").bind().all(),
    env.DB.prepare("SELECT license_key, max_devices FROM license_limits").bind().all(),
  ]);
  const devicesByKey = new Map();
  for (const item of (deviceRows.results || [])) {
    if (!devicesByKey.has(item.license_key)) devicesByKey.set(item.license_key, []);
    devicesByKey.get(item.license_key).push({
      deviceId: item.device_id,
      slot: Number(item.slot || 0),
      lastSeenAt: item.last_seen_at || "",
    });
  }
  const limits = new Map((limitRows.results || []).map((item) => [item.license_key, Number(item.max_devices || 1)]));
  const users = (rows.results || []).flatMap((record) => {
    const devices = devicesByKey.get(record.license_key) || [];
    const telegramId = record.activated_telegram_id || record.assigned_telegram_id || "";
    if (!telegramId && !devices.length) return [];
    return [{
      telegramId,
      key: record.license_key,
      plan: record.plan,
      isBanned: !Boolean(record.active) || Boolean(record.banned_telegram_id),
      banReason: record.ban_reason || "",
      active: Boolean(record.active) && !isExpired(record.expires_at),
      status: !record.active ? "Đã bị ban" : (isExpired(record.expires_at) ? "Hết hạn" : "Bình thường"),
      expiresAt: record.expires_at || null,
      boundDeviceId: devices[0]?.deviceId || record.device_id || "",
      devices,
      deviceCount: devices.length,
      maxDevices: Math.min(20, Math.max(1, limits.get(record.license_key) || 1)),
    }];
  });
  return json({ users });
}

async function setBan(request, env, banned) {
  const denied = await requireVerifiedAdmin(request, env);
  if (denied) return denied;
  const missing = dbUnavailable(env);
  if (missing) return missing;
  const body = await parseBody(request);
  const key = normalizeKey(body.key || body.licenseKey);
  const deviceId = normalizeDeviceId(body.deviceId);
  const telegramId = normalizeId(body.telegramId);

  let license = null;
  if (key && validKey(key)) {
    license = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", key);
  }
  // The account table submits both fields. Prefer the bound device when an
  // older imported key does not match today's key format instead of rejecting
  // a real user before the device lookup can run.
  if (!license && deviceId) {
    await ensureMultiDeviceSchema(env.DB);
    const linked = await queryOne(env.DB, "SELECT license_key FROM license_devices WHERE device_id = ? LIMIT 1", deviceId);
    if (linked?.license_key) {
      license = await queryOne(env.DB, "SELECT * FROM license_keys WHERE license_key = ?", linked.license_key);
    } else {
      license = await queryOne(env.DB, "SELECT * FROM license_keys WHERE device_id = ?", deviceId);
    }
  }

  // Current viewer accounts are identified by their license and bound device.
  // Keep the Telegram branch below only so old bans can still be removed.
  if (license) {
    const owner = license.activated_telegram_id || license.assigned_telegram_id || "";
    await env.DB.prepare("UPDATE license_keys SET active = ?, updated_at = ? WHERE license_key = ?")
      .bind(banned ? 0 : 1, now(), license.license_key).run();
    if (!banned && owner) await env.DB.prepare("DELETE FROM bans WHERE telegram_id = ?").bind(owner).run();
    if (banned) {
      const revokedAt = now();
      await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE license_key = ? AND revoked_at IS NULL")
        .bind(revokedAt, revokedAt, license.license_key).run();
    }
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
    const deviceIdentity = normalizeDeviceId(identity);
    const keyIdentity = normalizeKey(identity);
    const linkedLicense = deviceIdentity
      ? await queryOne(env.DB, "SELECT license_key, device_id, activated_telegram_id, assigned_telegram_id FROM license_keys WHERE device_id = ?", deviceIdentity)
      : validKey(keyIdentity)
        ? await queryOne(env.DB, "SELECT license_key, device_id, activated_telegram_id, assigned_telegram_id FROM license_keys WHERE license_key = ?", keyIdentity)
        : null;
    if (linkedLicense) {
      const owner = linkedLicense.activated_telegram_id || linkedLicense.assigned_telegram_id || "";
      const deviceMask = maskedValue(linkedLicense.device_id || "");
      const linkedClauses = ["actor_telegram_id = ?", "target_telegram_id = ?", "target_key = ?", "detail LIKE ?"];
      values.push(owner, owner, linkedLicense.license_key, `%${linkedLicense.license_key}%`);
      if (deviceMask) {
        linkedClauses.push("detail LIKE ?");
        values.push(`%${deviceMask}%`);
      }
      clauses.push(`(${linkedClauses.join(" OR ")})`);
    } else {
      clauses.push("(actor_telegram_id = ? OR target_telegram_id = ? OR detail LIKE ?)");
      values.push(identity, identity, `%${identity.replace(/[\\%_]/g, "")}%`);
    }
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
    cacheTtlSeconds: 15,
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
  const results = await Promise.allSettled(paths.map((path) => fetchProtectedCatalogJson(path, env, { force: true, ttl: 15 })));
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
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE role = 'admin' AND revoked_at IS NULL")
    .bind(now(), now()).run();
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
    const rows = await env.DB.prepare("SELECT * FROM downloads").bind().all();
    const stored = new Map((rows.results || []).map((row) => [row.platform, row]));
    const output = {};
    for (const platform of ['android', 'android_tv', 'ios', 'windows']) {
      output[platform] = preferredRelease(platform, stored.get(platform));
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
    ["android", body.androidUrl, body.androidVersion, body.androidSha256, body.androidSizeBytes, body.androidSigner],
    ["ios", body.iosUrl, body.iosVersion, body.iosSha256, body.iosSizeBytes, body.iosSigner],
    ["windows", body.windowsUrl, body.windowsVersion, body.windowsSha256, body.windowsSizeBytes, body.windowsSigner],
    ...(body.android_tvUrl !== undefined ? [["android_tv", body.android_tvUrl, body.android_tvVersion, body.android_tvSha256, body.android_tvSizeBytes, body.android_tvSigner]] : []),
  ];
  const timestamp = now();
  const statements = [];
  for (const [platform, url, version, sha256, sizeBytes, signer] of entries) {
    const safeUrl = String(url || "").trim();
    if (safeUrl && !validDownloadUrl(safeUrl)) return textError("Link tải phải dùng HTTPS, không chứa tài khoản/mật khẩu.", 400, "INVALID_DOWNLOAD_URL");
    const safeSha256 = String(sha256 || "").trim().toLowerCase();
    const safeSize = Number(sizeBytes || 0);
    if (safeUrl && env.ALLOW_LEGACY_TEST_AUTH !== "1" && !validReleaseSha256(safeSha256)) {
      return textError("Bản phát hành phải có SHA-256 hợp lệ.", 400, "RELEASE_SHA256_REQUIRED");
    }
    if (safeUrl && safeSize && !validReleaseSize(safeSize)) {
      return textError("Kích thước bản phát hành không hợp lệ.", 400, "INVALID_RELEASE_SIZE");
    }
    statements.push(env.DB.prepare(
      "INSERT INTO downloads (platform, url, version, sha256, size_bytes, signer, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(platform) DO UPDATE SET url = excluded.url, version = excluded.version, sha256 = excluded.sha256, size_bytes = excluded.size_bytes, signer = excluded.signer, updated_at = excluded.updated_at",
    ).bind(platform, safeUrl, String(version || "").trim().slice(0, 64), safeSha256, validReleaseSize(safeSize) ? safeSize : 0, cleanProgressText(signer, 200), timestamp));
  }
  await env.DB.batch(statements);
  await logEvent(env.DB, 'admin_downloads_updated', { actorTelegramId: requestTelegram(request), detail: 'release-links-updated' });
  return json({ success: true, message: "Đã cập nhật link tải." });
}

export function validDownloadUrl(value) {
  return String(value || '').length <= 2048 && Boolean(safePublicHttpsUrl(value));
}

export function validReleaseSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value || '').trim().toLowerCase());
}

function validReleaseSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 && size <= 2 * 1024 * 1024 * 1024;
}

function preferredRelease(platform, storedRelease) {
  const bundled = PUBLIC_RELEASES[platform] || null;
  const storedVersion = String(storedRelease?.version || '').trim();
  const stored = storedRelease
    && validDownloadUrl(storedRelease.url)
    && validReleaseSha256(storedRelease.sha256)
    && /^\d+(?:\.\d+){1,3}$/.test(storedVersion)
    ? {
        url: String(storedRelease.url).trim(),
        version: storedVersion,
        sha256: String(storedRelease.sha256).trim().toLowerCase(),
        sizeBytes: validReleaseSize(storedRelease.size_bytes) ? Number(storedRelease.size_bytes) : 0,
        signer: cleanProgressText(storedRelease.signer, 200),
      }
    : null;
  if (!bundled) return stored;
  return stored && compareAppVersions(stored.version, bundled.version) > 0 ? stored : { ...bundled };
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

async function ensureMovieAvailabilitySchema(env) {
  const db = env?.DB;
  if (!db || (typeof db !== "object" && typeof db !== "function")) return false;
  if (!movieAvailabilitySchemaPromises.has(db)) {
    movieAvailabilitySchemaPromises.set(db, (async () => {
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS movie_availability (movie_slug TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('online', 'offline')), failure_count INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', last_checked_at TEXT NOT NULL, next_check_at TEXT NOT NULL)",
      ).bind().run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_movie_availability_recheck ON movie_availability(status, next_check_at)",
      ).bind().run();
      return true;
    })().catch(() => false));
  }
  return movieAvailabilitySchemaPromises.get(db);
}

async function unavailableMovieSlugs(env, items) {
  if (!env?.DB || !Array.isArray(items) || !items.length) return new Set();
  try {
    if (!await ensureMovieAvailabilitySchema(env)) return new Set();
    const result = await env.DB.prepare(
      "SELECT movie_slug FROM movie_availability WHERE status = 'offline' LIMIT 5000",
    ).bind().all();
    return new Set((result?.results || []).map((row) => catalogSlug(row?.movie_slug)).filter(Boolean));
  } catch (_error) {
    return new Set();
  }
}

async function filterAvailableCatalogItems(items, env) {
  const list = Array.isArray(items) ? items : [];
  const unavailable = await unavailableMovieSlugs(env, list);
  return unavailable.size ? list.filter((item) => !unavailable.has(catalogSlug(item?.slug))) : list;
}

async function movieIsUnavailable(env, slug) {
  if (!env?.DB || !slug) return false;
  try {
    if (!await ensureMovieAvailabilitySchema(env)) return false;
    const row = await env.DB.prepare(
      "SELECT status FROM movie_availability WHERE movie_slug = ? LIMIT 1",
    ).bind(slug).first();
    return row?.status === "offline";
  } catch (_error) {
    return false;
  }
}

async function recordMovieAvailability(env, slug, status, reason = "", { insertOnline = false } = {}) {
  const safeSlug = catalogSlug(slug);
  if (!env?.DB || !safeSlug || !["online", "offline"].includes(status)) return;
  const checkedAt = now();
  const nextCheckAt = new Date(Date.now() + MOVIE_AVAILABILITY_RECHECK_MINUTES * 60 * 1000).toISOString();
  try {
    if (!await ensureMovieAvailabilitySchema(env)) return;
    if (status === "online" && !insertOnline) {
      await env.DB.prepare(
        "UPDATE movie_availability SET status = 'online', failure_count = 0, reason = '', last_checked_at = ?, next_check_at = ? WHERE movie_slug = ? AND status = 'offline'",
      ).bind(checkedAt, nextCheckAt, safeSlug).run();
      return;
    }
    await env.DB.prepare(
      "INSERT INTO movie_availability (movie_slug, status, failure_count, reason, last_checked_at, next_check_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(movie_slug) DO UPDATE SET status = excluded.status, failure_count = CASE WHEN excluded.status = 'offline' THEN movie_availability.failure_count + 1 ELSE 0 END, reason = excluded.reason, last_checked_at = excluded.last_checked_at, next_check_at = excluded.next_check_at",
    ).bind(safeSlug, status, status === "offline" ? 1 : 0, String(reason || "").slice(0, 120), checkedAt, nextCheckAt).run();
  } catch (_error) {}
}

function directStreamTarget(episode) {
  const hls = safePublicHttpsUrl(episode?.link_m3u8);
  const embedded = safePublicHttpsUrl(episode?.link_embed);
  const directEmbed = embedded && /\.(?:m3u8|mp4|m4v|mov)(?:$|[?#])/i.test(embedded.href) ? embedded : null;
  const target = hls || directEmbed;
  return target ? { target, isHls: Boolean(hls) || /\.m3u8(?:$|[?#])/i.test(target.href) } : null;
}

function streamCEmbedTarget(value) {
  const target = safePublicHttpsUrl(value);
  if (!target || !/^embed(?:\d{1,3})?\.streamc\.xyz$/i.test(target.hostname) || target.pathname !== "/embed.php") return null;
  if (!/^[a-f0-9]{32}$/i.test(target.searchParams.get("hash") || "") || [...target.searchParams.keys()].some((key) => key !== "hash")) return null;
  return target;
}

function normalizedEpisodeIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function episodeOrdinalHint(episode) {
  for (const value of [episode?.slug, episode?.filename, episode?.name]) {
    const text = normalizedEpisodeIdentity(value);
    if (!text) continue;
    const prefixed = text.match(/(?:^|\s)(?:tap|episode|ep|e)\s*0*(\d{1,4})(?:\s|$)/);
    if (prefixed) return Number(prefixed[1]);
    const standalone = text.match(/^0*(\d{1,4})$/);
    if (standalone) return Number(standalone[1]);
  }
  return null;
}

export function equivalentProviderEpisode(serverEpisodes, episode, episodeIndex) {
  const list = Array.isArray(serverEpisodes) ? serverEpisodes : [];
  const identity = [episode?.slug, episode?.name, episode?.filename]
    .map(normalizedEpisodeIdentity)
    .filter(Boolean);
  let candidate = list.find((item) => identity.some((value) =>
    [item?.slug, item?.name, item?.filename].some((field) => normalizedEpisodeIdentity(field) === value)));
  if (candidate) return candidate;

  // Providers use different labels for the same episode. Resolve "Tap 03",
  // "Episode 3", "EP03", etc. before falling back to array position.
  const ordinal = episodeOrdinalHint(episode);
  if (ordinal !== null) {
    candidate = list.find((item) => episodeOrdinalHint(item) === ordinal);
    if (candidate) return candidate;
  }
  return list[episodeIndex] || null;
}

function equivalentStreamTargets(data, episode, episodeIndex) {
  const output = new Map();
  for (const [serverIndex, server] of (Array.isArray(data?.episodes) ? data.episodes : []).entries()) {
    const serverEpisodes = Array.isArray(server?.server_data) ? server.server_data : [];
    const candidate = equivalentProviderEpisode(serverEpisodes, episode, episodeIndex);
    const resolved = directStreamTarget(candidate);
    const embed = streamCEmbedTarget(candidate?.link_embed);
    const key = resolved?.target?.href || embed?.href;
    if (key) output.set(key, {
      ...(resolved || { embed, isHls: true }),
      serverIndex,
      episodeIndex: Math.max(0, serverEpisodes.indexOf(candidate)),
      serverName: cleanProgressText(server?.server_name, 100) || `Server ${serverIndex + 1}`,
    });
  }
  return [...output.values()].slice(0, 8);
}

async function resolveStreamCPlaylistUncached(embed, slug) {
  const target = streamCEmbedTarget(embed?.href || embed);
  if (!target) return null;
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://streamc-cache.phim4k.invalid/${target.hostname}/${target.searchParams.get("hash")}`);
  if (cache) try {
    const cached = await cache.match(cacheKey);
    const payload = cached ? await cached.json() : null;
    const playlist = safePublicHttpsUrl(payload?.playlist);
    if (playlist && playlist.origin === target.origin && Number(payload?.expiresAt) > Math.floor(Date.now() / 1000) + 60) {
      return { target: playlist, isHls: true, referer: `${target.origin}/`, streamC: true };
    }
  } catch (_error) {}
  const moviePage = `https://phim.nguonc.com/phim/${encodeURIComponent(slug)}`;
  const browserHeaders = {
    accept: "application/json, text/plain, */*",
    "accept-language": "vi,en-US;q=0.8,en;q=0.6",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  };
  try {
    const response = await fetch(target.href, {
      method: "POST",
      headers: { ...browserHeaders, "content-type": "application/json", origin: target.origin, referer: target.href },
      body: JSON.stringify({
        action: "bootstrap",
        referrer: moviePage,
        frame_origins: ["https://phim.nguonc.com"],
        request_grant: true,
        playlist_format: "hls",
        pretty_url: true,
        path_chunks: true,
        bootstrap_format: "json",
      }),
      redirect: "manual",
      // StreamC commonly needs 8-12 seconds to issue a signed playlist. The
      // previous 6.5 second cutoff rejected healthy Rick & Morty episodes.
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return null;
    const payload = await response.json();
    const playlist = safePublicHttpsUrl(payload?.preissued?.playlist);
    const issuedAt = Number(payload?.preissued?.issuedAt);
    const expiresAt = Number(payload?.preissued?.expiresAt);
    if (!playlist || playlist.origin !== target.origin || payload?.preissued?.playlistFormat !== "hls") return null;
    if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > 86400) return null;
    const epochSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt <= epochSeconds + 60 || issuedAt > epochSeconds + 60) return null;
    if (cache) try {
      const ttl = Math.max(60, Math.min(3 * 60 * 60, expiresAt - epochSeconds - 60));
      await cache.put(cacheKey, new Response(JSON.stringify({ playlist: playlist.href, expiresAt }), {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
      }));
    } catch (_error) {}
    return { target: playlist, isHls: true, referer: `${target.origin}/`, streamC: true };
  } catch (_error) {
    return null;
  }
}

async function resolveStreamCPlaylist(embed, slug) {
  const target = streamCEmbedTarget(embed?.href || embed);
  if (!target) return null;
  const key = target.href;
  if (streamCResolutionPromises.has(key)) return streamCResolutionPromises.get(key);
  const pending = resolveStreamCPlaylistUncached(target, slug).finally(() => streamCResolutionPromises.delete(key));
  streamCResolutionPromises.set(key, pending);
  return pending;
}

async function probeAvailabilitySource(source, request, env) {
  try {
    const probeRequest = new Request(request.url, { method: "GET", headers: request.headers });
    const { response } = await fetchProtectedUpstream(
      source.target.href,
      probeRequest,
      env,
      source.isHls ? "hls" : "media",
      4,
      true,
      2500,
    );
    const state = response.ok || response.status === 206
      ? "online"
      : (response.status === 404 || response.status === 410 ? "offline" : "unknown");
    try { await response.body?.cancel(); } catch (_error) {}
    return state;
  } catch (_error) {
    return "unknown";
  }
}

async function allEquivalentSourcesOffline(data, episode, episodeIndex, selectedUrl, request, env) {
  const alternatives = equivalentStreamTargets(data, episode, episodeIndex)
    .filter((source) => source.target.href !== selectedUrl);
  if (!alternatives.length) return true;
  const states = await Promise.all(alternatives.map((source) => probeAvailabilitySource(source, request, env)));
  return states.every((state) => state === "offline");
}

async function auditMovieAvailability(slug, env) {
  try {
    const data = await fetchProtectedCatalogJson(`/phim/${slug}`, env, { force: true, ttl: 15 });
    const firstServer = Array.isArray(data?.episodes) ? data.episodes.find((server) => server?.server_data?.length) : null;
    const episodeIndex = Math.max(0, (firstServer?.server_data?.length || 1) - 1);
    const episode = firstServer?.server_data?.[episodeIndex];
    const sources = equivalentStreamTargets(data, episode, episodeIndex);
    if (!sources.length) {
      await recordMovieAvailability(env, slug, "offline", "NO_DIRECT_STREAM", { insertOnline: true });
      return "offline";
    }
    const request = new Request("https://phim4k-license-api.invalid/availability-audit");
    const states = await Promise.all(sources.map((source) => probeAvailabilitySource(source, request, env)));
    if (states.some((state) => state === "online")) {
      await recordMovieAvailability(env, slug, "online", "", { insertOnline: true });
      return "online";
    }
    if (states.every((state) => state === "offline")) {
      await recordMovieAvailability(env, slug, "offline", "ALL_SOURCES_GONE", { insertOnline: true });
      return "offline";
    }
    return "unknown";
  } catch (_error) {
    return "unknown";
  }
}

async function runMovieAvailabilityAudit(env) {
  if (!env?.DB) return;
  if (!await ensureMovieAvailabilitySchema(env)) return;
  const due = [];
  try {
    const rows = await env.DB.prepare(
      "SELECT movie_slug FROM movie_availability WHERE status = 'offline' AND next_check_at <= ? ORDER BY next_check_at ASC LIMIT ?",
    ).bind(now(), MOVIE_AVAILABILITY_AUDIT_LIMIT).all();
    due.push(...(rows?.results || []).map((row) => catalogSlug(row?.movie_slug)).filter(Boolean));
  } catch (_error) {}
  try {
    const latest = await fetchProtectedCatalogJson(
      `/v1/api/danh-sach/phim-moi-cap-nhat?page=1&limit=${MOVIE_AVAILABILITY_AUDIT_LIMIT}&sort_field=modified.time&sort_type=desc`,
      env,
      { force: true, ttl: 15 },
    );
    due.push(...catalogItems(latest).map((item) => catalogSlug(item?.slug)).filter(Boolean));
  } catch (_error) {}
  const slugs = [...new Set(due)].slice(0, MOVIE_AVAILABILITY_AUDIT_LIMIT);
  for (const slug of slugs) await auditMovieAvailability(slug, env);
}

function homeCatalogPaths(year) {
  return [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((page) => `/v1/api/danh-sach/phim-moi-cap-nhat?page=${page}&limit=64&sort_field=modified.time&sort_type=desc`),
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
  if (!target || !hosts.has(target.hostname.toLowerCase())) return textError("Nguồn ảnh không được phép.", 400, "IMAGE_HOST_NOT_ALLOWED");
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
    ({ response: upstream, target: finalTarget } = await fetchProtectedUpstream(target.href, request, env, "media", 4, false));
  } catch (_error) {
    return textError("Không tải được ảnh phim.", 502, "IMAGE_UPSTREAM_ERROR");
  }
  if (!finalTarget || !hosts.has(finalTarget.hostname.toLowerCase())) {
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

async function fetchProtectedCatalogJson(path, env, { force = false, ttl = 15 } = {}) {
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
    // The catalog occasionally needs 10-13 seconds even when healthy. A five
    // second cutoff discarded the metadata that is required to discover a
    // renamed backup title, turning a slow response into "all servers down".
    signal: AbortSignal.timeout(15000),
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

async function fetchJsonFromOrigin(origin, path, { ttl = 30, timeoutMs = 12000 } = {}) {
  if (!origin || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) return null;
  try {
    const response = await fetch(`${origin.href.replace(/\/$/, "")}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      cf: { cacheEverything: true, cacheTtl: ttl },
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return null;
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function absoluteProviderAsset(value, origin, fallbackPath = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = safePublicHttpsUrl(raw);
  if (direct) return direct.href;
  if (!origin || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  try {
    return new URL(raw.replace(/^\/+/, ""), fallbackPath ? new URL(fallbackPath, `${origin.origin}/`) : `${origin.origin}/`).href;
  } catch (_error) {
    return "";
  }
}

function normalizeNguonCListItem(item, origin) {
  if (!item || typeof item !== "object") return null;
  const slug = catalogSlug(item.slug);
  if (!slug) return null;
  return {
    _id: String(item.id || item._id || slug),
    name: cleanProgressText(item.name, 200),
    slug,
    origin_name: cleanProgressText(item.original_name || item.origin_name, 200),
    thumb_url: absoluteProviderAsset(item.thumb_url, origin),
    poster_url: absoluteProviderAsset(item.poster_url || item.thumb_url, origin),
    year: Number(item.year || 0) || undefined,
    quality: cleanProgressText(item.quality, 40),
    lang: cleanProgressText(item.language || item.lang, 80),
    time: cleanProgressText(item.time, 80),
    episode_current: cleanProgressText(item.current_episode || item.episode_current, 80),
    episode_total: cleanProgressText(item.total_episodes || item.episode_total, 80),
    modified: typeof item.modified === "object" ? item.modified : { time: item.modified || item.updated_at || "" },
    _source_candidates: [{ id: "nguonphim", slug, name: "Nguồn Phim" }],
  };
}

function sourceCandidateTag(id, name, slug) {
  const safeSlug = catalogSlug(slug);
  return safeSlug ? { id, name, slug: safeSlug } : null;
}

function mergeSourceCandidateTags(...values) {
  const output = [];
  const seen = new Set();
  for (const value of values.flat()) {
    if (!value || typeof value !== "object") continue;
    const id = String(value.id || "").trim().toLowerCase();
    const slug = catalogSlug(value.slug);
    if (!id || !slug) continue;
    const key = `${id}|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ id, slug, name: cleanProgressText(value.name, 80) || id });
  }
  return output;
}

function movieListIdentity(item) {
  const tmdbId = Number(item?.tmdb?.id || item?.tmdb_id || 0);
  const tmdbType = String(item?.tmdb?.type || item?.type || "").toLowerCase();
  if (tmdbId > 0) return `tmdb|${tmdbType}|${tmdbId}|${Number(item?.tmdb?.season || 0)}`;
  const original = normalizedMovieIdentity(item?.origin_name || item?.original_name);
  const name = normalizedMovieIdentity(item?.name);
  const year = Number(item?.year || 0) || 0;
  return `name|${original || name}|${year}`;
}

function mergeCatalogMovieItems(sourceLists) {
  const output = [];
  const byIdentity = new Map();
  for (const entry of sourceLists) {
    const sourceId = String(entry?.id || "").trim();
    const sourceName = String(entry?.name || sourceId).trim();
    for (const raw of (Array.isArray(entry?.items) ? entry.items : [])) {
      if (!raw || typeof raw !== "object" || !catalogSlug(raw.slug)) continue;
      const tagged = {
        ...raw,
        _source_candidates: mergeSourceCandidateTags(
          raw._source_candidates || [],
          sourceCandidateTag(sourceId, sourceName, raw.slug),
        ),
      };
      const identity = movieListIdentity(tagged);
      const existingIndex = byIdentity.get(identity);
      if (existingIndex === undefined) {
        byIdentity.set(identity, output.length);
        output.push(tagged);
        continue;
      }
      const existing = output[existingIndex];
      output[existingIndex] = {
        ...existing,
        thumb_url: existing.thumb_url || tagged.thumb_url,
        poster_url: existing.poster_url || tagged.poster_url,
        origin_name: existing.origin_name || tagged.origin_name,
        _source_candidates: mergeSourceCandidateTags(existing._source_candidates || [], tagged._source_candidates || []),
      };
    }
  }
  return output;
}

async function fetchOphimMovieBySlug(slug, env) {
  const origin = configuredOphimOrigin(env);
  if (!origin || !slug) return null;
  for (const path of [`/phim/${encodeURIComponent(slug)}`, `/v1/api/phim/${encodeURIComponent(slug)}`]) {
    const payload = await fetchJsonFromOrigin(origin, path, { ttl: 120, timeoutMs: 12000 });
    const movie = payload?.movie || payload?.data?.item;
    if (!movie || typeof movie !== "object") continue;
    const episodes = Array.isArray(payload?.episodes) ? payload.episodes : (Array.isArray(payload?.data?.episodes) ? payload.data.episodes : []);
    const imageBaseRaw = payload?.data?.APP_DOMAIN_CDN_IMAGE || payload?.APP_DOMAIN_CDN_IMAGE || "https://img.ophim.live/uploads/movies/";
    const imageBase = safePublicHttpsUrl(imageBaseRaw);
    return {
      ...payload,
      movie: {
        ...movie,
        thumb_url: absoluteProviderAsset(movie.thumb_url, imageBase || origin),
        poster_url: absoluteProviderAsset(movie.poster_url || movie.thumb_url, imageBase || origin),
        _source_candidates: mergeSourceCandidateTags(movie._source_candidates || [], sourceCandidateTag("ophim", "OPhim", movie.slug || slug)),
      },
      episodes,
    };
  }
  return null;
}

async function fetchOphimMovieDetail(slug, env, primaryMovie = null) {
  const exact = await fetchOphimMovieBySlug(slug, env);
  if (exact) return exact;
  const origin = configuredOphimOrigin(env);
  if (!origin || !primaryMovie) return null;
  const query = String(primaryMovie.origin_name || primaryMovie.name || slug).trim().slice(0, 100);
  const payload = await fetchJsonFromOrigin(origin, `/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&page=1&limit=12`, { ttl: 60 });
  const items = catalogItems(payload);
  const primarySeason = Number(primaryMovie?.tmdb?.season || 0)
    || movieSeason(primaryMovie?.slug)
    || movieSeason(primaryMovie?.origin_name)
    || movieSeason(primaryMovie?.name);
  const primaryOriginal = normalizedMovieIdentity(primaryMovie?.origin_name);
  const primaryName = normalizedMovieIdentity(primaryMovie?.name);
  const ranked = items.map((item) => {
    const candidateSeason = movieSeason(item?.slug) || movieSeason(item?.origin_name) || movieSeason(item?.name);
    if (primarySeason && candidateSeason && primarySeason !== candidateSeason) return { item, score: -1 };
    const candidateOriginal = normalizedMovieIdentity(item?.origin_name);
    const candidateName = normalizedMovieIdentity(item?.name);
    let score = 0;
    if (primarySeason && candidateSeason === primarySeason) score += 12;
    if (primaryOriginal && candidateOriginal === primaryOriginal) score += 10;
    if (primaryName && candidateName === primaryName) score += 8;
    if (primaryOriginal && candidateOriginal && (primaryOriginal.includes(candidateOriginal) || candidateOriginal.includes(primaryOriginal))) score += 4;
    if (primaryName && candidateName && (primaryName.includes(candidateName) || candidateName.includes(primaryName))) score += 3;
    return { item, score };
  }).filter((candidate) => candidate.score >= 4 && candidate.item?.slug)
    .sort((left, right) => right.score - left.score);
  return ranked[0] ? fetchOphimMovieBySlug(ranked[0].item.slug, env) : null;
}

function countPlayableEpisodes(data) {
  return (Array.isArray(data?.episodes) ? data.episodes : []).reduce((total, server) => total + (Array.isArray(server?.server_data) ? server.server_data.length : 0), 0);
}

function sourceDetailScore(entry) {
  if (!entry?.data?.movie) return -1;
  const movie = entry.data.movie;
  const sourceBonus = entry.id === "phimapi" ? 6 : entry.id === "ophim" ? 4 : 2;
  const metadata = ["name", "origin_name", "poster_url", "thumb_url", "content", "year"].reduce((score, key) => score + (movie[key] ? 1 : 0), 0);
  return sourceBonus + metadata + Math.min(40, countPlayableEpisodes(entry.data));
}

function tagMovieSource(data, id, name, requestedSlug) {
  if (!data?.movie) return null;
  const movieSlug = catalogSlug(data.movie.slug || requestedSlug) || requestedSlug;
  return {
    ...data,
    movie: {
      ...data.movie,
      slug: movieSlug,
      _source_candidates: mergeSourceCandidateTags(
        data.movie._source_candidates || [],
        sourceCandidateTag(id, name, movieSlug),
      ),
    },
    episodes: (Array.isArray(data.episodes) ? data.episodes : []).map((server, index) => ({
      ...server,
      _source_id: id,
      _source_name: name,
      server_name: cleanProgressText(server?.server_name, 90) || `Server ${index + 1}`,
    })),
  };
}

async function resolveEnsMovieStyleSources(slug, env) {
  const primaryPromise = fetchProtectedCatalogJson(`/phim/${slug}`, env, { ttl: 120 })
    .then((data) => tagMovieSource(data, "phimapi", "PhimAPI", slug))
    .catch(() => null);
  const ophimPromise = fetchOphimMovieDetail(slug, env).then((data) => tagMovieSource(data, "ophim", "OPhim", slug)).catch(() => null);
  const nguonExactPromise = fetchBackupMovieDetail(slug, env).then((data) => tagMovieSource(data, "nguonphim", "Nguồn Phim", slug)).catch(() => null);

  let [primary, ophim, nguon] = await Promise.all([primaryPromise, ophimPromise, nguonExactPromise]);
  const seedMovie = primary?.movie || ophim?.movie || nguon?.movie || null;
  const fallbacks = [];
  if (!ophim && seedMovie) fallbacks.push(fetchOphimMovieDetail(slug, env, seedMovie).then((data) => tagMovieSource(data, "ophim", "OPhim", slug)).catch(() => null));
  if (!nguon && seedMovie) fallbacks.push(fetchBackupMovieDetail(slug, env, seedMovie, { skipExact: true }).then((data) => tagMovieSource(data, "nguonphim", "Nguồn Phim", slug)).catch(() => null));
  if (fallbacks.length) {
    const resolved = await Promise.all(fallbacks);
    for (const item of resolved) {
      if (!item) continue;
      const sourceId = item.episodes?.[0]?._source_id;
      if (sourceId === "ophim") ophim = item;
      if (sourceId === "nguonphim") nguon = item;
    }
  }
  // Keep server groups in a stable provider order so a stream_ref created by
  // the detail response still resolves to the same source if another provider
  // is temporarily slower on the next request. Metadata selection is scored
  // independently inside mergeResolvedMovieSources.
  return [
    { id: "phimapi", name: "PhimAPI", data: primary },
    { id: "ophim", name: "OPhim", data: ophim },
    { id: "nguonphim", name: "Nguồn Phim", data: nguon },
  ].filter((entry) => entry.data?.movie);
}

function normalizeBackupMovieDetail(payload, origin = null) {
  const movie = payload?.movie && typeof payload.movie === "object" ? payload.movie : null;
  if (!movie) return null;
  const episodes = (Array.isArray(movie.episodes) ? movie.episodes : []).map((server, serverIndex) => ({
    server_name: cleanProgressText(server?.server_name, 100) || `Nguồn phụ ${serverIndex + 1}`,
    server_data: (Array.isArray(server?.items) ? server.items : []).flatMap((item, episodeIndex) => {
      const target = safePublicHttpsUrl(item?.link_m3u8 || item?.m3u8 || item?.link || item?.embed);
      const embed = streamCEmbedTarget(item?.embed);
      if (!target || (!/\.(?:m3u8|mp4|m4v|mov)(?:$|[?#])/i.test(target.href) && !embed)) return [];
      const isHls = /\.m3u8(?:$|[?#])/i.test(target.href);
      return [{
        name: item?.name || `Tập ${episodeIndex + 1}`,
        slug: item?.slug || `tap-${episodeIndex + 1}`,
        filename: item?.filename || item?.name || "",
        link_m3u8: isHls ? target.href : "",
        link_embed: isHls ? "" : (embed?.href || target.href),
      }];
    }),
  })).filter((server) => server.server_data.length);
  const { episodes: _ignored, ...movieMetadata } = movie;
  movieMetadata.thumb_url = absoluteProviderAsset(movieMetadata.thumb_url, origin);
  movieMetadata.poster_url = absoluteProviderAsset(movieMetadata.poster_url || movieMetadata.thumb_url, origin);
  return { movie: movieMetadata, episodes };
}

function normalizedMovieIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function movieSeason(value) {
  const text = normalizedMovieIdentity(value);
  const match = text.match(/(?:phan|season)\s*(\d{1,3})/) || text.match(/\bs(\d{1,3})\b/);
  return match ? Number(match[1]) : 0;
}

function providerSlug(value) {
  return normalizedMovieIdentity(value).replace(/\s+/g, "-").slice(0, 80);
}

async function fetchBackupMovieBySlug(origin, slug) {
  try {
    const response = await fetch(`${origin.href.replace(/\/$/, "")}/api/film/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12000),
      redirect: "manual",
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return null;
    return normalizeBackupMovieDetail(await response.json(), origin);
  } catch (_error) {
    return null;
  }
}

async function fetchBackupMovieDetail(slug, env, primaryMovie = null, { skipExact = false } = {}) {
  const origin = configuredBackupCatalogOrigin(env);
  if (!origin || !slug) return null;
  if (!skipExact) {
    const exact = await fetchBackupMovieBySlug(origin, slug);
    if (exact) return exact;
  }
  if (!primaryMovie) return null;
  const originalPrefix = providerSlug(primaryMovie.origin_name);
  const guessedSlug = originalPrefix && !slug.startsWith(`${originalPrefix}-`)
    ? `${originalPrefix}-${slug}`.slice(0, 180)
    : "";
  const guessedPromise = guessedSlug
    ? fetchBackupMovieBySlug(origin, guessedSlug)
    : Promise.resolve(null);
  const searchPromise = (async () => {
    const query = String(primaryMovie.origin_name || primaryMovie.name || slug).trim().slice(0, 100);
    const response = await fetch(`${origin.href.replace(/\/$/, "")}/api/films/search?keyword=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12000),
      redirect: "manual",
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return null;
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const primarySeason = Number(primaryMovie?.tmdb?.season || 0)
      || movieSeason(primaryMovie?.slug)
      || movieSeason(primaryMovie?.origin_name)
      || movieSeason(primaryMovie?.name);
    const primaryOriginal = normalizedMovieIdentity(primaryMovie?.origin_name);
    const primaryName = normalizedMovieIdentity(primaryMovie?.name);
    const ranked = items.map((item) => {
      const candidateSeason = movieSeason(item?.slug) || movieSeason(item?.original_name) || movieSeason(item?.name);
      if (primarySeason && candidateSeason && primarySeason !== candidateSeason) return { item, score: -1 };
      const candidateOriginal = normalizedMovieIdentity(item?.original_name);
      const candidateName = normalizedMovieIdentity(item?.name);
      let score = 0;
      if (primarySeason && candidateSeason === primarySeason) score += 12;
      if (primaryOriginal && candidateOriginal === primaryOriginal) score += 10;
      if (primaryName && candidateName === primaryName) score += 8;
      if (primaryOriginal && candidateOriginal && (primaryOriginal.includes(candidateOriginal) || candidateOriginal.includes(primaryOriginal))) score += 4;
      if (primaryName && candidateName && (primaryName.includes(candidateName) || candidateName.includes(primaryName))) score += 3;
      return { item, score };
    }).filter((candidate) => candidate.score >= 4 && candidate.item?.slug)
      .sort((left, right) => right.score - left.score);
    return ranked[0] ? fetchBackupMovieBySlug(origin, ranked[0].item.slug) : null;
  })().catch(() => null);
  try {
    return await Promise.any([guessedPromise, searchPromise].map((promise) => promise.then((result) => {
      if (!result) throw new Error("BACKUP_NOT_FOUND");
      return result;
    })));
  } catch (_error) { return null; }
}

function prewarmBackupStreams(data, slug, executionContext) {
  if (!executionContext?.waitUntil) return;
  const embeds = [...new Set((data?.episodes || []).flatMap((server) =>
    (server?.server_data || []).map((episode) => streamCEmbedTarget(episode?.link_embed)?.href).filter(Boolean)))].slice(0, 2);
  if (!embeds.length) return;
  executionContext.waitUntil((async () => {
    for (const embed of embeds) await resolveStreamCPlaylist(embed, slug);
  })().catch(() => {}));
}

function mergeResolvedMovieSources(entries) {
  const available = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.data?.movie);
  if (!available.length) return null;
  const primaryEntry = [...available].sort((left, right) => sourceDetailScore(right) - sourceDetailScore(left))[0];
  const primary = primaryEntry.data;
  const seen = new Set();
  const episodes = [];
  const candidates = [];
  for (const entry of available) {
    candidates.push(...(entry.data?.movie?._source_candidates || []));
    for (const server of (entry.data?.episodes || [])) {
      const links = (server?.server_data || []).map((episode) =>
        directStreamTarget(episode)?.target?.href || streamCEmbedTarget(episode?.link_embed)?.href).filter(Boolean);
      const identity = links.length
        ? links.join("|")
        : `${entry.id}|${normalizedMovieIdentity(server?.server_name)}|${(server?.server_data || []).length}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const sourceName = cleanProgressText(server?._source_name || entry.name, 40) || "Nguồn";
      const rawName = cleanProgressText(server?.server_name, 80) || `Server ${episodes.length + 1}`;
      const decoratedName = rawName.toLowerCase().includes(sourceName.toLowerCase())
        ? rawName
        : `[${sourceName}] ${rawName}`;
      episodes.push({
        ...server,
        _source_id: server?._source_id || entry.id,
        _source_name: sourceName,
        _source_movie_slug: catalogSlug(entry.data?.movie?.slug) || "",
        _source_server_name: rawName,
        server_name: decoratedName,
      });
    }
  }
  return {
    ...primary,
    movie: {
      ...primary.movie,
      _source_candidates: mergeSourceCandidateTags(candidates),
    },
    episodes,
  };
}

function mergeMovieSources(primary, backup) {
  const entries = [];
  if (primary) entries.push({ id: "phimapi", name: "PhimAPI", data: tagMovieSource(primary, "phimapi", "PhimAPI", primary?.movie?.slug || "") });
  if (backup) entries.push({ id: "nguonphim", name: "Nguồn Phim", data: tagMovieSource(backup, "nguonphim", "Nguồn Phim", backup?.movie?.slug || "") });
  return mergeResolvedMovieSources(entries);
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
  output.episodes = servers.map((server, serverIndex) => {
    const sourceId = cleanProgressText(server?._source_id, 40).toLowerCase();
    const sourceMovieSlug = catalogSlug(server?._source_movie_slug) || slug;
    const sourceServerName = cleanProgressText(server?._source_server_name || server?.server_name, 100) || `Server ${serverIndex + 1}`;
    return {
      server_name: cleanProgressText(server?.server_name, 100) || `Server ${serverIndex + 1}`,
      source_id: sourceId,
      source_name: cleanProgressText(server?._source_name, 80),
      server_data: (Array.isArray(server?.server_data) ? server.server_data : []).map((episode, episodeIndex) => ({
        name: cleanProgressText(episode?.name, 120) || `Tập ${episodeIndex + 1}`,
        slug: cleanProgressText(episode?.slug, 160),
        filename: cleanProgressText(episode?.filename, 160),
        stream_ref: {
          movie: slug,
          server: serverIndex,
          episode: episodeIndex,
          source: sourceId,
          sourceMovieSlug,
          serverName: sourceServerName,
          episodeSlug: cleanProgressText(episode?.slug, 160),
          episodeName: cleanProgressText(episode?.name, 120),
          episodeNumber: episodeOrdinalHint(episode),
        },
      })),
    };
  });
  return output;
}

async function fetchEnsMovieStyleCatalog(mode, env, { page = 1, query = "", category = "" } = {}) {
  const sourceRequests = [];
  const primaryPath = mode === "search"
    ? `/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&page=${page}&limit=48`
    : mode === "category"
      ? `/v1/api/danh-sach/${category}?page=${page}&limit=48&sort_field=modified.time&sort_type=desc`
      : `/v1/api/danh-sach/phim-moi-cap-nhat?page=${page}&limit=48&sort_field=modified.time&sort_type=desc`;

  sourceRequests.push(fetchProtectedCatalogJson(primaryPath, env, { ttl: page === 1 ? 15 : 120 })
    .then((data) => ({ id: "phimapi", name: "PhimAPI", items: normalizedCatalogItems(data, env), raw: data }))
    .catch(() => null));

  const ophimOrigin = configuredOphimOrigin(env);
  if (ophimOrigin) {
    sourceRequests.push(fetchJsonFromOrigin(ophimOrigin, primaryPath, { ttl: page === 1 ? 15 : 120 })
      .then((data) => data ? ({ id: "ophim", name: "OPhim", items: normalizedCatalogItems(data, env), raw: data }) : null)
      .catch(() => null));
  }

  const nguonOrigin = env?.MOVIE_BACKUP_CATALOG_ORIGIN ? configuredBackupCatalogOrigin(env) : null;
  if (nguonOrigin) {
    const nguonPath = mode === "search"
      ? `/api/films/search?keyword=${encodeURIComponent(query)}&page=${page}`
      : mode === "category"
        ? `/api/films/danh-sach/${category}?page=${page}`
        : `/api/films/phim-moi-cap-nhat?page=${page}`;
    sourceRequests.push(fetchJsonFromOrigin(nguonOrigin, nguonPath, { ttl: page === 1 ? 15 : 120 })
      .then((data) => data ? ({
        id: "nguonphim",
        name: "Nguồn Phim",
        items: (Array.isArray(data?.items) ? data.items : []).map((item) => normalizeNguonCListItem(item, nguonOrigin)).filter(Boolean),
        raw: data,
      }) : null)
      .catch(() => null));
  }

  const settled = (await Promise.all(sourceRequests)).filter(Boolean);
  return {
    sources: settled.map((entry) => ({ id: entry.id, name: entry.name, count: entry.items.length })),
    items: mergeCatalogMovieItems(settled),
    primaryRaw: settled.find((entry) => entry.id === "phimapi")?.raw || settled[0]?.raw || null,
  };
}

async function fetchEnsMovieStyleHomeCatalog(env) {
  const primaryPaths = homeCatalogPaths(new Date().getUTCFullYear());
  const primaryResults = await Promise.allSettled(
    primaryPaths.map((path, index) => fetchProtectedCatalogJson(path, env, { ttl: index ? 60 : 15 })),
  );
  const sourceEntries = [{
    id: "phimapi",
    name: "PhimAPI",
    items: primaryResults.flatMap((result) => result.status === "fulfilled" ? normalizedCatalogItems(result.value, env) : []),
  }];

  const ophimOrigin = configuredOphimOrigin(env);
  if (ophimOrigin) {
    const data = await fetchJsonFromOrigin(ophimOrigin, "/v1/api/danh-sach/phim-moi-cap-nhat?page=1&limit=48&sort_field=modified.time&sort_type=desc", { ttl: 15 });
    if (data) sourceEntries.push({ id: "ophim", name: "OPhim", items: normalizedCatalogItems(data, env) });
  }

  const nguonOrigin = env?.MOVIE_BACKUP_CATALOG_ORIGIN ? configuredBackupCatalogOrigin(env) : null;
  if (nguonOrigin) {
    const data = await fetchJsonFromOrigin(nguonOrigin, "/api/films/phim-moi-cap-nhat?page=1", { ttl: 15 });
    if (data) sourceEntries.push({
      id: "nguonphim",
      name: "Nguồn Phim",
      items: (Array.isArray(data?.items) ? data.items : []).map((item) => normalizeNguonCListItem(item, nguonOrigin)).filter(Boolean),
    });
  }

  return {
    sources: sourceEntries.map((entry) => ({ id: entry.id, name: entry.name, count: entry.items.length })),
    items: mergeCatalogMovieItems(sourceEntries),
  };
}

async function handleProtectedMovieCatalog(request, env, executionContext) {
  const identity = await verifyTelemetryViewer(request, env);
  if (identity.error) return identity.error;
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/movies/home") {
    const resolved = await fetchEnsMovieStyleHomeCatalog(env);
    if (!resolved.items.length) return textError("Nguồn danh mục tạm thời không khả dụng.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
    const payload = HomeCuration.build(resolved.items);
    payload.sources = resolved.sources;
    return json(await protectCatalogImages(payload, request, env));
  }

  if (pathname === "/api/movies/catalog") {
    const page = catalogPage(url.searchParams.get("page"));
    const resolved = await fetchEnsMovieStyleCatalog("latest", env, { page });
    if (!resolved.items.length) return textError("Chưa tải được kho phim từ các nguồn.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
    const data = resolved.primaryRaw || {};
    const pagination = data.pagination || data.data?.params?.pagination || {
      currentPage: page,
      totalPages: 1,
      totalItems: resolved.items.length,
    };
    return json({
      title: "Toàn bộ kho phim",
      sources: resolved.sources,
      items: await protectCatalogImages(resolved.items, request, env),
      pagination,
    });
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
    const resolved = await fetchEnsMovieStyleCatalog("category", env, { page, category });
    if (!resolved.items.length) return textError("Danh mục này chưa tải được từ các nguồn.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
    const data = resolved.primaryRaw || {};
    return json({
      title: category,
      sources: resolved.sources,
      items: await protectCatalogImages(resolved.items, request, env),
      pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 1 },
    });
  }

  if (pathname === "/api/movies/search") {
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 100);
    if (!query) return textError("Thiếu từ khóa tìm kiếm.", 400, "MISSING_QUERY");
    const page = catalogPage(url.searchParams.get("page"));
    const resolved = await fetchEnsMovieStyleCatalog("search", env, { page, query });
    const data = resolved.primaryRaw || {};
    return json({
      query,
      sources: resolved.sources,
      items: await protectCatalogImages(resolved.items, request, env),
      pagination: data.data?.params?.pagination || data.pagination || { currentPage: page, totalPages: 1 },
    });
  }

  const detailMatch = pathname.match(/^\/api\/movies\/detail\/([^/]+)$/);
  if (detailMatch) {
    const slug = catalogSlug(detailMatch[1]);
    if (!slug) return textError("Mã phim không hợp lệ.", 400, "INVALID_MOVIE_SLUG");
    const entries = await resolveEnsMovieStyleSources(slug, env);
    const data = mergeResolvedMovieSources(entries);
    if (!data) return textError("Chưa tải được thông tin phim từ các nguồn.", 502, "MOVIE_UPSTREAM_UNAVAILABLE");
    prewarmBackupStreams(data, slug, executionContext);
    const output = await protectMovieDetail(data, request, env, slug);
    output.sources = entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      servers: Array.isArray(entry.data?.episodes) ? entry.data.episodes.length : 0,
      episodes: countPlayableEpisodes(entry.data),
    }));
    return json(output);
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
  const entries = await resolveEnsMovieStyleSources(slug, env);
  const data = mergeResolvedMovieSources(entries);
  if (!data) return textError("Chưa kết nối được các nguồn phim. Vui lòng thử lại.", 503, "MOVIE_UPSTREAM_UNAVAILABLE");

  // Mirror EnsMovie's resolveEpisodePlayback contract: source gateway, source
  // movie slug, server name and episode identity are authoritative. Numeric
  // indexes remain only as a backwards-compatible fallback.
  const requestedSource = String(body?.source || "").trim().toLowerCase();
  const requestedSourceMovieSlug = catalogSlug(body?.sourceMovieSlug);
  const requestedServerName = normalizedMovieIdentity(body?.serverName);
  const requestedEpisode = {
    slug: cleanProgressText(body?.episodeSlug, 160),
    name: cleanProgressText(body?.episodeName, 120),
    filename: cleanProgressText(body?.episodeFilename, 160),
  };
  const requestedEpisodeNumber = Number.isInteger(Number(body?.episodeNumber))
    ? Number(body.episodeNumber)
    : episodeOrdinalHint(requestedEpisode);

  let resolvedServerIndex = serverIndex;
  if (requestedSource) {
    const sourceMatches = (data.episodes || []).map((server, index) => ({ server, index }))
      .filter(({ server }) => String(server?._source_id || "").toLowerCase() === requestedSource);
    if (sourceMatches.length) {
      const ranked = sourceMatches.map((candidate) => {
        let score = 0;
        if (requestedSourceMovieSlug && catalogSlug(candidate.server?._source_movie_slug) === requestedSourceMovieSlug) score += 12;
        const candidateServerName = normalizedMovieIdentity(candidate.server?._source_server_name || candidate.server?.server_name);
        if (requestedServerName && candidateServerName === requestedServerName) score += 10;
        else if (requestedServerName && candidateServerName && (candidateServerName.includes(requestedServerName) || requestedServerName.includes(candidateServerName))) score += 4;
        return { ...candidate, score };
      }).sort((left, right) => right.score - left.score || left.index - right.index);
      resolvedServerIndex = ranked[0].index;
    }
  }

  const resolvedServer = data?.episodes?.[resolvedServerIndex];
  const serverEpisodes = Array.isArray(resolvedServer?.server_data) ? resolvedServer.server_data : [];
  let resolvedEpisodeIndex = episodeIndex;
  if (serverEpisodes.length) {
    const equivalent = equivalentProviderEpisode(serverEpisodes, requestedEpisode, episodeIndex);
    const equivalentIndex = equivalent ? serverEpisodes.indexOf(equivalent) : -1;
    if (equivalentIndex >= 0) resolvedEpisodeIndex = equivalentIndex;
    if (requestedEpisodeNumber !== null && requestedEpisodeNumber !== undefined) {
      const numberedIndex = serverEpisodes.findIndex((item) => episodeOrdinalHint(item) === requestedEpisodeNumber);
      if (numberedIndex >= 0) resolvedEpisodeIndex = numberedIndex;
    }
  }

  const episode = serverEpisodes[resolvedEpisodeIndex] || data?.episodes?.[serverIndex]?.server_data?.[episodeIndex];
  if (!episode) return textError("Không tìm thấy đúng tập phim trên các nguồn hiện tại.", 404, "EPISODE_NOT_FOUND");
  const selected = directStreamTarget(episode);
  const candidates = equivalentStreamTargets(data, episode, resolvedEpisodeIndex);
  if (!candidates.length) {
    await recordMovieAvailability(env, slug, "offline", "NO_DIRECT_STREAM");
    return textError("Server này không có luồng phát trực tiếp tương thích.", 404, "STREAM_NOT_AVAILABLE");
  }
  // Start every StreamC bootstrap immediately while direct sources are
  // probed. This keeps healthy direct streams fast, but a slow (8-12 second)
  // signed backup is already in flight when a stale primary returns 404.
  const streamChoicePromise = Promise.any(candidates.filter((source) => source.embed).map(async (source) => {
    const resolvedSource = await resolveStreamCPlaylist(source.embed, slug);
    if (!resolvedSource) throw new Error("STREAMC_UNAVAILABLE");
    return { ...source, ...resolvedSource, clientDirectFallback: false };
  })).catch(() => null);
  const nativeBootstrapCandidate = candidates.find((source) => source.embed) || null;
  const directCandidates = candidates.filter((source) => !source.embed);
  directCandidates.sort((a, b) =>
    Number(b.target?.href === selected?.target?.href) - Number(a.target?.href === selected?.target?.href));
  let chosen = null;
  let clientFallbackCandidate = null;
  // Catalog entries can outlive their provider files. Verify the selected
  // stream before issuing a ticket so the client can immediately try another
  // server instead of remaining at 00:00 with a native-player error.
  for (const source of directCandidates) try {
    const resolvedSource = source;
    const { target, isHls, referer = "", streamC = false } = resolvedSource;
    let clientDirectFallback = false;
    const probeRequest = new Request(request.url, { method: "GET", headers: request.headers });
    // This is only an availability probe. Keep movie startup responsive; the
    // actual stream request still gets the normal, longer media timeout.
    const { response: probe } = await fetchProtectedUpstream(target.href, probeRequest, env, isHls ? "hls" : "media", 4, !streamC, 2500, referer);
    if (!probe.ok && probe.status !== 206) {
      const sourceIsGone = probe.status === 404 || probe.status === 410;
      probe.body?.cancel?.().catch?.(() => {});
      // A definitive 404/410 is not an edge/CORS problem. Redirecting the
      // viewer to the same dead URL only makes every client retry it several
      // times before moving to another server. Fail this source immediately
      // so the shared player can select another catalogue server.
      if (sourceIsGone) {
        continue;
      }
      // Let the entrypoint retry a failed VPS response through Cloudflare
      // first. When the direct Cloudflare fetch is also blocked (or no VPS is
      // configured), issue a short-lived authenticated redirect so playback
      // can continue entirely on the viewer device. A dead source will simply
      // fail in the player, which can then try the next catalog server.
      if (streamC) continue;
      if (!configuredRelayOrigin(env)) clientDirectFallback = true;
      else continue;
    }
    if (!clientDirectFallback && isHls) {
      const declaredLength = Number.parseInt(probe.headers.get("content-length") || "0", 10) || 0;
      if (declaredLength > MAX_HLS_MANIFEST_BYTES) continue;
      const bytes = new Uint8Array(await probe.arrayBuffer());
      if (bytes.byteLength > MAX_HLS_MANIFEST_BYTES || !new TextDecoder().decode(bytes).trimStart().startsWith("#EXTM3U")) {
        // Some providers serve an anti-bot HTML page to Cloudflare but serve
        // the exact same URL normally to the viewer's device.
        if (streamC) continue;
        if (!configuredRelayOrigin(env)) clientDirectFallback = true;
        else continue;
      }
    } else if (!clientDirectFallback) {
      const contentType = String(probe.headers.get("content-type") || "").toLowerCase();
      probe.body?.cancel?.().catch?.(() => {});
      if (!/^(?:video\/|audio\/|application\/(?:octet-stream|mp2t))/.test(contentType)) {
        if (streamC) continue;
        if (!configuredRelayOrigin(env)) clientDirectFallback = true;
        else continue;
      }
    }
    if (clientDirectFallback) {
      // A timeout or anti-bot response is not proof that the source works on
      // the viewer device. Keep it only as the final emergency fallback and
      // give the verified backup resolver a chance to finish first.
      clientFallbackCandidate ||= { ...source, ...resolvedSource, streamC, referer, clientDirectFallback: true };
      continue;
    }
    chosen = { ...source, ...resolvedSource, streamC, referer, clientDirectFallback: false };
    break;
  } catch (_error) {
    if (!configuredRelayOrigin(env) && source.target) {
      clientFallbackCandidate ||= { ...source, clientDirectFallback: true };
    }
  }
  if (!chosen) chosen = await streamChoicePromise;
  if (!chosen && nativeBootstrapCandidate) {
    const expiresAt = Math.floor(Date.now() / 1000) + STREAM_TICKET_TTL_SECONDS;
    return json({
      success: true,
      nativeBootstrap: {
        url: nativeBootstrapCandidate.embed.href,
        referrer: `https://phim.nguonc.com/phim/${encodeURIComponent(slug)}`,
      },
      isHls: true,
      selectedServer: nativeBootstrapCandidate.serverIndex,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
  }
  if (!chosen) chosen = clientFallbackCandidate;
  if (!chosen) {
    await recordMovieAvailability(env, slug, "offline", "ALL_SOURCES_GONE");
    return textError("Các server của phim đang tạm thời không phản hồi; phim vẫn được giữ trong kho.", 404, "STREAM_SOURCE_OFFLINE");
  }
  const { target, isHls, clientDirectFallback } = chosen;
  const expiresAt = Math.floor(Date.now() / 1000) + ((env.MEDIA_RELAY_FALLBACK === "redirect" || clientDirectFallback) ? 15 * 60 : STREAM_TICKET_TTL_SECONDS);
  if (!clientDirectFallback) await recordMovieAvailability(env, slug, "online");
  return json({
    success: true,
    streamUrl: await protectedMediaUrl(request, env, target.href, "stream", expiresAt, {
      format: isHls ? "hls" : "media",
      sid: identity.sessionId || "",
      clientDirectFallback,
      ref: chosen.referer || "",
      streamC: chosen.streamC === true,
    }),
    isHls,
    selectedServer: chosen.serverIndex,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  });
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
    signal: AbortSignal.timeout(15000),
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

async function fetchProtectedUpstream(initialUrl, request, env, mediaFormat = "media", maxRedirects = 4, allowRelay = true, timeoutMs = 0, refererOverride = "") {
  const format = mediaFormat === "hls" ? "hls" : "media";
  if (allowRelay && configuredRelayOrigin(env)) {
    try {
      const relayed = await fetchVpsRelay(initialUrl, request, env, format);
      if (relayed.response.ok || relayed.response.status === 206) return relayed;
      try { await relayed.response.body?.cancel(); } catch (_error) {}
    } catch (_error) {}
  }
  let target = safePublicHttpsUrl(initialUrl);
  if (!target) throw new Error("UNSAFE_MEDIA_TARGET");
  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const catalogOrigin = configuredCatalogOrigin(env);
    const headers = new Headers({
      accept: "*/*",
      "accept-language": "vi,en-US;q=0.8,en;q=0.6",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    });
    const safeReferer = safePublicHttpsUrl(refererOverride);
    if (safeReferer) headers.set("referer", safeReferer.href);
    else if (catalogOrigin) headers.set("referer", `${catalogOrigin.origin}/`);
    const range = format === "hls" ? "" : request.headers.get("range");
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
    const response = await fetch(target.href, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs > 0 ? timeoutMs : (format === "hls" ? 15000 : 30000)),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, target };
    if (attempt === maxRedirects) throw new Error("MEDIA_REDIRECT_LIMIT");
    const location = response.headers.get("location");
    target = location ? safePublicHttpsUrl(new URL(location, target).href) : null;
    if (!target) throw new Error("UNSAFE_MEDIA_REDIRECT");
  }
  throw new Error("MEDIA_REDIRECT_LIMIT");
}

async function protectHlsReference(reference, baseUrl, request, env, expiresAt, sessionId) {
  const value = String(reference || "").trim();
  if (!value || value.startsWith("data:")) throw new Error("UNSAFE_HLS_REFERENCE");
  const target = safePublicHttpsUrl(new URL(value, baseUrl).href);
  if (!target) throw new Error("UNSAFE_HLS_REFERENCE");
  const base = safePublicHttpsUrl(baseUrl);
  const streamC = Boolean(base && /^embed(?:\d{1,3})?\.streamc\.xyz$/i.test(base.hostname));
  return protectedMediaUrl(request, env, target.href, "stream", expiresAt, {
    format: /\.m3u8(?:$|[?#])/i.test(target.href) ? "hls" : "media",
    sid: sessionId,
    ref: streamC ? `${base.origin}/` : "",
    streamC,
    disguisedMedia: streamC && /\.png(?:$|[?#])/i.test(target.href),
  });
}

async function rewriteHlsLine(line, baseUrl, request, env, expiresAt, sessionId) {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (!trimmed.startsWith("#")) return protectHlsReference(trimmed, baseUrl, request, env, expiresAt, sessionId);
  const matches = [...line.matchAll(/URI="([^"]+)"/g)];
  if (!matches.length) return line;
  let output = "";
  let offset = 0;
  for (const match of matches) {
    output += line.slice(offset, match.index);
    output += `URI="${await protectHlsReference(match[1], baseUrl, request, env, expiresAt, sessionId)}"`;
    offset = match.index + match[0].length;
  }
  return output + line.slice(offset);
}

async function handleMovieStream(request, env) {
  const missing = dbUnavailable(env);
  if (missing) return missing;
  let ticket;
  try {
    ticket = await openMediaTicket(new URL(request.url).searchParams.get("t"), env, "stream");
  } catch (error) {
    const expired = error.message === "EXPIRED_MEDIA_TICKET";
    return textError(expired ? "Vé phát đã hết hạn." : "Vé phát không hợp lệ.", expired ? 410 : 400, expired ? "STREAM_TICKET_EXPIRED" : "INVALID_STREAM_TICKET");
  }
  if (!(env.ALLOW_LEGACY_TEST_AUTH === "1" && !ticket.sid)) {
    const session = await mediaSession(env.DB, ticket.sid);
    if (!session) return sessionError("SESSION_REVOKED");
    const identity = await authorizeSessionRecord(session, env);
    if (identity.error) return identity.error;
  }
  // Compatibility mode is retained only for emergency rollback. Production
  // uses the authenticated VPS relay, so the provider URL never reaches the
  // client or appears in a browser-visible redirect.
  const clientMediaRedirect = () => new Response(null, {
    status: 307,
    headers: { ...CORS_HEADERS, location: ticket.url, "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
  });
  if (env.MEDIA_RELAY_FALLBACK === "redirect" || ticket.clientDirectFallback === true) return clientMediaRedirect();
  let upstream;
  let target;
  try {
    ({ response: upstream, target } = await fetchProtectedUpstream(ticket.url, request, env, ticket.format, 4, ticket.streamC !== true, 0, ticket.ref));
  } catch (_error) {
    // A master playlist may pass its probe while a variant, key, or segment
    // is later blocked at a Cloudflare edge. The session has already been
    // validated, so let the viewer request that exact resource directly.
    if (!configuredRelayOrigin(env)) return clientMediaRedirect();
    return textError("Không kết nối được luồng phim.", 502, "STREAM_UPSTREAM_ERROR");
  }
  if (!upstream.ok && upstream.status !== 206) {
    upstream.body?.cancel?.().catch?.(() => {});
    if (!configuredRelayOrigin(env)) return clientMediaRedirect();
    return textError("Luồng phim tạm thời không phản hồi.", 502, `STREAM_UPSTREAM_HTTP_${upstream.status}`);
  }
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
      const lines = await Promise.all(manifest.split(/\r?\n/).map((line) => rewriteHlsLine(line, target.href, request, env, ticket.exp, ticket.sid)));
      return new Response(lines.join("\n"), { status: 200, headers: { ...CORS_HEADERS, "content-type": "application/vnd.apple.mpegurl; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    } catch (_error) {
      return textError("Danh sách phát chứa liên kết không an toàn.", 502, "UNSAFE_HLS_MANIFEST");
    }
  }
  const disguisedMedia = ticket.streamC === true && ticket.disguisedMedia === true && contentType.startsWith("image/");
  if (!disguisedMedia && !/^(?:video\/|audio\/|application\/(?:octet-stream|mp2t))/.test(contentType)) return textError("Nguồn phát trả về nội dung không hợp lệ.", 502, "INVALID_STREAM_RESPONSE");
  const headers = new Headers(CORS_HEADERS);
  headers.set("content-type", disguisedMedia ? "video/mp2t" : (contentType || "application/octet-stream"));
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
      if ((request.method === "GET" || request.method === "HEAD") && INSTALLER_RELEASES[pathname]) {
        return await handleInstallerDownload(request, pathname);
      }
      if (request.method === "GET" && pathname === "/api/media/image") return await handleProtectedMovieImage(request, env, executionContext);
      if (request.method === "GET" && pathname === "/api/media/stream") return await handleMovieStream(request, env);
      if (request.method === "POST" && pathname === "/api/movies/play") return await handleMoviePlayback(request, env);
      if (request.method === "GET" && pathname.startsWith("/api/movies/")) return await handleProtectedMovieCatalog(request, env, executionContext);
      const missing = dbUnavailable(env);
      if (missing) return missing;

      if (request.method === 'GET' && pathname === '/api/app/access-policy') return await accessPolicy(request, env);
      if (request.method === 'POST' && pathname === '/api/admin/access-policy') return await accessPolicy(request, env);
      if (request.method === 'POST' && pathname === '/api/admin/maintenance') return await handleMaintenanceAdmin(request, env);

      if (request.method === "POST" && pathname === "/api/auth/activate") {
        return await activateSession(request, env);
      }
      if (request.method === "GET" && pathname === "/api/auth/status") {
        if (env.ALLOW_LEGACY_TEST_AUTH === "1" && !request.headers.get("authorization")) {
          return await activationStatus({ db: env.DB, key: requestKey(request), telegramId: requestTelegram(request), deviceId: normalizeDeviceId(request.headers.get('x-device-id')), request, env, activation: false });
        }
        return await sessionStatus(request, env);
      }
      if (request.method === "POST" && pathname === "/api/auth/refresh") return await refreshSession(request, env);
      if (request.method === "POST" && pathname === "/api/auth/logout") return await logoutSession(request, env);
      if (request.method === "POST" && pathname === "/api/auth/request-device-access") return await requestDeviceAccess(request, env);
      if (request.method === "GET" && pathname === "/api/auth/device-status") return await deviceAccessStatus(request, env);
      if (request.method === "GET" && (pathname === "/api/app/check-update" || pathname === "/api/app/version")) {
        const version = url.searchParams.get('version') || appVersion(request);
        const status = await getForceUpdate(env.DB, version);
        const platform = url.searchParams.get('platform') || requestPlatform(request) || 'web';
        if (!status.forceUpdate && ['ios', 'android', 'android_tv', 'windows'].includes(platform)) {
          const storedRelease = await queryOne(env.DB, 'SELECT * FROM downloads WHERE platform = ?', platform);
          const release = preferredRelease(platform, storedRelease);
          if (release && validDownloadUrl(release.url) && validReleaseSha256(release.sha256)) {
            status.latestVersion = release.version;
            status.isLatest = compareAppVersions(version, release.version) >= 0;
            status.downloadSha256 = String(release.sha256).toLowerCase();
            status.downloadSizeBytes = validReleaseSize(release.sizeBytes) ? Number(release.sizeBytes) : 0;
            status.downloadSigner = cleanProgressText(release.signer, 200);
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
      if (request.method === "POST" && pathname === "/api/admin/set-max-devices") return await updateKey(request, env, "max-devices");
      if (request.method === "POST" && pathname === "/api/admin/remove-device") {
        const denied = await requireVerifiedAdmin(request, env);
        if (denied) return denied;
        const body = await parseBody(request);
        const key = normalizeKey(body.key);
        const deviceId = normalizeDeviceId(body.deviceId);
        if (!validKey(key) || !deviceId) return textError("Thiết bị cần gỡ không hợp lệ.", 400, "INVALID_DEVICE_TARGET");
        await removeLicenseDevice(env.DB, key, deviceId);
        await logEvent(env.DB, "key_remove_device", { actorTelegramId: requestTelegram(request), targetKey: key, detail: `device=${maskedValue(deviceId, 6)}` });
        return json({ success: true, message: "Đã gỡ thiết bị khỏi key." });
      }
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
  async scheduled(_event, env, executionContext) {
    executionContext?.waitUntil?.(runMovieAvailabilityAudit(env));
  },
};
