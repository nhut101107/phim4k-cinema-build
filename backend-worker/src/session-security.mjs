const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const PROOF_CLOCK_SKEW_SECONDS = 90;

const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value, pattern, errorCode) {
  const text = String(value || "");
  if (!pattern.test(text)) throw new Error(errorCode);
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64Url(bytes) !== text) throw new Error(errorCode);
  return bytes;
}

function randomValue(prefix, bytes = 32) {
  return `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(bytes)))}`;
}

async function digest(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")))));
}

function iso(timestampMs) {
  return new Date(timestampMs).toISOString();
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function requestDeviceId(request) {
  const value = String(request.headers.get("x-device-id") || "").trim();
  return /^[A-Za-z0-9._:-]{3,128}$/.test(value) ? value : "";
}

export function sanitizeDevicePublicKey(value) {
  if (!value || typeof value !== "object") return null;
  const key = {
    kty: String(value.kty || ""),
    crv: String(value.crv || ""),
    x: String(value.x || ""),
    y: String(value.y || ""),
  };
  if (key.kty !== "EC" || key.crv !== "P-256") return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(key.x) || !/^[A-Za-z0-9_-]{43}$/.test(key.y)) return null;
  return key;
}

export function bearerToken(request) {
  const match = /^Bearer\s+(p4a_[A-Za-z0-9_-]{43})$/.exec(String(request.headers.get("authorization") || ""));
  return match?.[1] || "";
}

export function refreshToken(request, body = {}) {
  const header = String(request.headers.get("x-refresh-token") || "");
  const value = header || String(body.refreshToken || "");
  return /^p4r_[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}

async function verifyDeviceProof(request, publicKeyJson, credential, db, sessionId, timestampMs = Date.now()) {
  let jwk;
  try { jwk = sanitizeDevicePublicKey(JSON.parse(publicKeyJson)); }
  catch (_error) { jwk = null; }
  if (!jwk) return { ok: false, code: "DEVICE_PROOF_KEY_INVALID" };

  const proofTime = String(request.headers.get("x-device-time") || "");
  const nonce = String(request.headers.get("x-device-nonce") || "");
  const proof = String(request.headers.get("x-device-proof") || "");
  if (!/^\d{10}$/.test(proofTime) || !/^[A-Za-z0-9_-]{24,64}$/.test(nonce) || !/^[A-Za-z0-9_-]{86}$/.test(proof)) {
    return { ok: false, code: "DEVICE_PROOF_REQUIRED" };
  }
  if (Math.abs(Math.floor(timestampMs / 1000) - Number(proofTime)) > PROOF_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: "DEVICE_PROOF_EXPIRED" };
  }

  const url = new URL(request.url);
  const canonical = `${request.method.toUpperCase()}\n${url.pathname}${url.search}\n${proofTime}\n${nonce}\n${credential}`;
  let verified = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, ext: true, key_ops: ["verify"] },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      decodeBase64Url(proof, /^[A-Za-z0-9_-]{86}$/, "DEVICE_PROOF_INVALID"),
      encoder.encode(canonical),
    );
  } catch (_error) {
    verified = false;
  }
  if (!verified) return { ok: false, code: "DEVICE_PROOF_INVALID" };

  try {
    await db.prepare(
      "INSERT INTO request_nonces (session_id, nonce, expires_at) VALUES (?, ?, ?)",
    ).bind(sessionId, nonce, iso(timestampMs + PROOF_CLOCK_SKEW_SECONDS * 2 * 1000)).run();
  } catch (_error) {
    return { ok: false, code: "DEVICE_PROOF_REPLAYED" };
  }
  return { ok: true };
}

export async function issueSession({ db, role, licenseKey = "", telegramId = "", deviceId, plan = "STANDARD", devicePublicKey, timestampMs = Date.now() }) {
  const publicKey = sanitizeDevicePublicKey(devicePublicKey);
  if (!publicKey || !deviceId) throw new Error("DEVICE_KEY_REQUIRED");

  const sessionId = randomValue("sid_", 18);
  const familyId = randomValue("fam_", 18);
  const accessToken = randomValue("p4a_");
  const nextRefreshToken = randomValue("p4r_");
  const createdAt = iso(timestampMs);
  const accessExpiresAt = iso(timestampMs + ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = iso(timestampMs + REFRESH_TTL_SECONDS * 1000);

  const selector = role === "user" ? "license_key = ?" : "role = ? AND device_id = ?";
  const selectorValues = role === "user" ? [licenseKey] : [role, deviceId];
  const revokePrevious = () => db.prepare(
    `UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE revoked_at IS NULL AND ${selector}`,
  ).bind(createdAt, createdAt, ...selectorValues).run();
  await revokePrevious();

  const accessHash = await digest(accessToken);
  const refreshHash = await digest(nextRefreshToken);
  const insert = () => db.prepare(
    "INSERT INTO auth_sessions (session_id, family_id, role, license_key, telegram_id, device_id, device_public_jwk, plan, access_hash, access_expires_at, refresh_hash, refresh_expires_at, refresh_generation, created_at, updated_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)",
  ).bind(
    sessionId, familyId, role, licenseKey || null, telegramId || null, deviceId,
    JSON.stringify(publicKey), plan, accessHash, accessExpiresAt, refreshHash,
    refreshExpiresAt, createdAt, createdAt, createdAt,
  ).run();
  try {
    await insert();
  } catch (error) {
    // A concurrent activation may win between our revoke and insert. Revoke
    // that winner and retry once so the unique partial index guarantees one
    // active session while the last completed activation becomes authoritative.
    if (!/unique constraint/i.test(String(error?.message || error))) throw error;
    await revokePrevious();
    await insert();
  }

  await db.prepare("DELETE FROM request_nonces WHERE expires_at <= ?").bind(createdAt).run();
  await db.prepare("DELETE FROM consumed_refresh_tokens WHERE expires_at <= ?").bind(createdAt).run();
  return { sessionId, accessToken, accessExpiresAt, refreshToken: nextRefreshToken, refreshExpiresAt };
}

export async function authenticateSession(request, db, { timestampMs = Date.now(), allowExpiredAccess = false } = {}) {
  const accessToken = bearerToken(request);
  if (!accessToken) return { error: "ACCESS_TOKEN_REQUIRED" };
  const row = await db.prepare("SELECT * FROM auth_sessions WHERE access_hash = ?").bind(await digest(accessToken)).first();
  if (!row || row.revoked_at) return { error: "SESSION_REVOKED" };
  if (!allowExpiredAccess && Date.parse(row.access_expires_at) <= timestampMs) return { error: "ACCESS_TOKEN_EXPIRED" };
  if (Date.parse(row.refresh_expires_at) <= timestampMs) return { error: "SESSION_EXPIRED" };
  const deviceId = requestDeviceId(request);
  if (!deviceId || deviceId !== row.device_id) return { error: "DEVICE_MISMATCH" };
  const proof = await verifyDeviceProof(request, row.device_public_jwk, accessToken, db, row.session_id, timestampMs);
  if (!proof.ok) return { error: proof.code };

  if (timestampMs - Date.parse(row.last_seen_at || row.updated_at || row.created_at) >= 5 * 60 * 1000) {
    const seenAt = iso(timestampMs);
    await db.prepare("UPDATE auth_sessions SET last_seen_at = ?, updated_at = ? WHERE session_id = ? AND revoked_at IS NULL")
      .bind(seenAt, seenAt, row.session_id).run();
    row.last_seen_at = seenAt;
  }
  return { session: row, accessToken };
}

export async function rotateSession(request, db, body = {}, timestampMs = Date.now()) {
  const presented = refreshToken(request, body);
  if (!presented) return { error: "REFRESH_TOKEN_REQUIRED" };
  const presentedHash = await digest(presented);
  const row = await db.prepare("SELECT * FROM auth_sessions WHERE refresh_hash = ?").bind(presentedHash).first();
  if (!row) {
    const reused = await db.prepare("SELECT family_id FROM consumed_refresh_tokens WHERE token_hash = ?").bind(presentedHash).first();
    if (reused?.family_id) {
      const revokedAt = iso(timestampMs);
      await db.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE family_id = ? AND revoked_at IS NULL")
        .bind(revokedAt, revokedAt, reused.family_id).run();
      return { error: "REFRESH_TOKEN_REUSED" };
    }
    return { error: "REFRESH_TOKEN_INVALID" };
  }
  if (row.revoked_at || Date.parse(row.refresh_expires_at) <= timestampMs) return { error: "SESSION_EXPIRED" };
  const deviceId = requestDeviceId(request);
  if (!deviceId || deviceId !== row.device_id) return { error: "DEVICE_MISMATCH" };
  const proof = await verifyDeviceProof(request, row.device_public_jwk, presented, db, row.session_id, timestampMs);
  if (!proof.ok) return { error: proof.code };

  const accessToken = randomValue("p4a_");
  const nextRefreshToken = randomValue("p4r_");
  const updatedAt = iso(timestampMs);
  const accessExpiresAt = iso(timestampMs + ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = iso(timestampMs + REFRESH_TTL_SECONDS * 1000);
  const result = await db.prepare(
    "UPDATE auth_sessions SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?, refresh_generation = refresh_generation + 1, updated_at = ?, last_seen_at = ? WHERE session_id = ? AND refresh_hash = ? AND revoked_at IS NULL",
  ).bind(
    await digest(accessToken),
    accessExpiresAt,
    await digest(nextRefreshToken),
    refreshExpiresAt,
    updatedAt,
    updatedAt,
    row.session_id,
    presentedHash,
  ).run();
  if (changes(result) !== 1) {
    await db.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE family_id = ? AND revoked_at IS NULL")
      .bind(updatedAt, updatedAt, row.family_id).run();
    return { error: "REFRESH_TOKEN_REUSED" };
  }
  await db.prepare(
    "INSERT INTO consumed_refresh_tokens (token_hash, family_id, session_id, used_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(presentedHash, row.family_id, row.session_id, updatedAt, row.refresh_expires_at).run();
  await db.prepare("DELETE FROM request_nonces WHERE expires_at <= ?").bind(updatedAt).run();
  await db.prepare("DELETE FROM consumed_refresh_tokens WHERE expires_at <= ?").bind(updatedAt).run();
  return {
    session: { ...row, access_expires_at: accessExpiresAt, refresh_expires_at: refreshExpiresAt, updated_at: updatedAt },
    sessionId: row.session_id,
    accessToken,
    accessExpiresAt,
    refreshToken: nextRefreshToken,
    refreshExpiresAt,
  };
}

export async function revokeSession(db, sessionId, timestampMs = Date.now()) {
  const revokedAt = iso(timestampMs);
  await db.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE session_id = ? AND revoked_at IS NULL")
    .bind(revokedAt, revokedAt, sessionId).run();
}

export async function revokeSessionFamily(db, familyId, timestampMs = Date.now()) {
  const revokedAt = iso(timestampMs);
  await db.prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE family_id = ? AND revoked_at IS NULL")
    .bind(revokedAt, revokedAt, familyId).run();
}

export async function mediaSession(db, sessionId, timestampMs = Date.now()) {
  if (!/^sid_[A-Za-z0-9_-]{24}$/.test(String(sessionId || ""))) return null;
  const row = await db.prepare("SELECT * FROM auth_sessions WHERE session_id = ?").bind(sessionId).first();
  if (!row || row.revoked_at || Date.parse(row.refresh_expires_at) <= timestampMs) return null;
  return row;
}
