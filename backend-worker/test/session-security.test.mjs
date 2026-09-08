import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { sealMediaTicket } from '../src/worker.mjs';

const encoder = new TextEncoder();
const releaseHash = 'a'.repeat(64);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async run() { return sqlite.prepare(sql).run(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { return sqlite.prepare(sql).run(); },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const env = {
    DB,
    ADMIN_LICENSE_KEY: 'TEST-ADMIN-SECRET',
    ADMIN_TELEGRAM_ID: '1000000001',
    MEDIA_TICKET_SECRET: 'test-media-ticket-secret-that-is-long-enough',
  };
  const seed = (key, deviceId = null) => sqlite.prepare(
    'INSERT INTO license_keys (license_key, device_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(key, deviceId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  return { sqlite, DB, env, seed };
}

async function deviceKey() {
  const pair = await crypto.webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const publicKey = await crypto.webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey };
}

async function activate(f, key, deviceId, pair, telegramId = '') {
  const response = await worker.fetch(new Request('https://test.example/api/auth/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ key, telegramId, deviceId, devicePublicKey: pair.publicKey }),
  }), f.env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(body.accessToken, /^p4a_/);
  assert.match(body.refreshToken, /^p4r_/);
  assert.equal(body.key, undefined);
  return body;
}

async function signedRequest(path, { method = 'GET', credential, token, deviceId, privateKey, body, nonce } = {}) {
  const proofTime = String(Math.floor(Date.now() / 1000));
  const proofNonce = nonce || crypto.randomBytes(18).toString('base64url');
  const canonical = `${method}\n${path}\n${proofTime}\n${proofNonce}\n${credential}`;
  const signature = Buffer.from(await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(canonical),
  )).toString('base64url');
  const headers = {
    'content-type': 'application/json',
    'x-device-id': deviceId,
    'x-device-time': proofTime,
    'x-device-nonce': proofNonce,
    'x-device-proof': signature,
    'cf-connecting-ip': '198.51.100.20',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (credential.startsWith('p4r_')) headers['x-refresh-token'] = credential;
  return new Request(`https://test.example${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('production auth rejects raw license headers and requires a fresh signed device proof', async () => {
  const f = fixture();
  try {
    f.seed('P4K-SESSION-USER');
    const pair = await deviceKey();
    const session = await activate(f, 'P4K-SESSION-USER', 'device-session-a', pair);

    const legacy = await worker.fetch(new Request('https://test.example/api/auth/status', {
      headers: { 'x-license-key': 'P4K-SESSION-USER', 'x-device-id': 'device-session-a' },
    }), f.env);
    assert.equal(legacy.status, 401);
    assert.equal((await legacy.json()).code, 'ACCESS_TOKEN_REQUIRED');

    const missingProof = await worker.fetch(new Request('https://test.example/api/auth/status', {
      headers: { authorization: `Bearer ${session.accessToken}`, 'x-device-id': 'device-session-a' },
    }), f.env);
    assert.equal(missingProof.status, 401);
    assert.equal((await missingProof.json()).code, 'DEVICE_PROOF_REQUIRED');

    const nonce = crypto.randomBytes(18).toString('base64url');
    const validRequest = await signedRequest('/api/auth/status', {
      credential: session.accessToken, token: session.accessToken, deviceId: 'device-session-a', privateKey: pair.privateKey, nonce,
    });
    const validHeaders = Object.fromEntries(validRequest.headers);
    const valid = await worker.fetch(validRequest, f.env);
    assert.equal(valid.status, 200);

    const replay = await worker.fetch(new Request('https://test.example/api/auth/status', { headers: validHeaders }), f.env);
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).code, 'DEVICE_PROOF_REPLAYED');

    const tampered = await worker.fetch(new Request('https://test.example/api/watch-progress', { headers: {
      ...validHeaders,
      'x-device-nonce': crypto.randomBytes(18).toString('base64url'),
    } }), f.env);
    assert.equal(tampered.status, 401);
    assert.equal((await tampered.json()).code, 'DEVICE_PROOF_INVALID');
  } finally { f.sqlite.close(); }
});

test('tampered and expired access tokens are rejected', async () => {
  const f = fixture();
  try {
    f.seed('P4K-TOKEN-USER');
    const pair = await deviceKey();
    const session = await activate(f, 'P4K-TOKEN-USER', 'device-token-a', pair);

    const tamperedToken = `${session.accessToken.slice(0, -1)}${session.accessToken.endsWith('A') ? 'B' : 'A'}`;
    const tampered = await signedRequest('/api/auth/status', {
      credential: tamperedToken, token: tamperedToken, deviceId: 'device-token-a', privateKey: pair.privateKey,
    });
    const tamperedResponse = await worker.fetch(tampered, f.env);
    assert.equal(tamperedResponse.status, 401);
    assert.equal((await tamperedResponse.json()).code, 'SESSION_REVOKED');

    f.sqlite.prepare('UPDATE auth_sessions SET access_expires_at = ? WHERE session_id = ?')
      .run('2026-01-01T00:00:00.000Z', session.sessionId);
    const expired = await signedRequest('/api/auth/status', {
      credential: session.accessToken, token: session.accessToken, deviceId: 'device-token-a', privateKey: pair.privateKey,
    });
    const expiredResponse = await worker.fetch(expired, f.env);
    assert.equal(expiredResponse.status, 401);
    assert.equal((await expiredResponse.json()).code, 'ACCESS_TOKEN_EXPIRED');
  } finally { f.sqlite.close(); }
});

test('concurrent activations leave exactly one active session for a license', async () => {
  const f = fixture();
  try {
    f.seed('P4K-RACE-USER');
    const pair = await deviceKey();
    const [first, second] = await Promise.all([
      activate(f, 'P4K-RACE-USER', 'device-race-a', pair),
      activate(f, 'P4K-RACE-USER', 'device-race-a', pair),
    ]);

    const active = f.sqlite.prepare(
      "SELECT session_id FROM auth_sessions WHERE license_key = ? AND revoked_at IS NULL",
    ).all('P4K-RACE-USER');
    assert.equal(active.length, 1);
    assert.ok(active[0].session_id === first.sessionId || active[0].session_id === second.sessionId);

    const outcomes = [];
    for (const session of [first, second]) {
      const status = await signedRequest('/api/auth/status', {
        credential: session.accessToken,
        token: session.accessToken,
        deviceId: 'device-race-a',
        privateKey: pair.privateKey,
      });
      outcomes.push((await worker.fetch(status, f.env)).status);
    }
    assert.deepEqual(outcomes.sort(), [200, 401]);
  } finally { f.sqlite.close(); }
});

test('refresh tokens rotate once and reuse revokes the whole session family', async () => {
  const f = fixture();
  try {
    f.seed('P4K-REFRESH-USER');
    const pair = await deviceKey();
    const first = await activate(f, 'P4K-REFRESH-USER', 'device-refresh-a', pair);
    const rotate = await signedRequest('/api/auth/refresh', {
      method: 'POST', credential: first.refreshToken, deviceId: 'device-refresh-a', privateKey: pair.privateKey, body: {},
    });
    const rotatedResponse = await worker.fetch(rotate, f.env);
    const second = await rotatedResponse.json();
    assert.equal(rotatedResponse.status, 200, JSON.stringify(second));
    assert.notEqual(second.refreshToken, first.refreshToken);

    const reuse = await signedRequest('/api/auth/refresh', {
      method: 'POST', credential: first.refreshToken, deviceId: 'device-refresh-a', privateKey: pair.privateKey, body: {},
    });
    const reuseResponse = await worker.fetch(reuse, f.env);
    assert.equal(reuseResponse.status, 401);
    assert.equal((await reuseResponse.json()).code, 'REFRESH_TOKEN_REUSED');

    const afterReuse = await signedRequest('/api/auth/status', {
      credential: second.accessToken, token: second.accessToken, deviceId: 'device-refresh-a', privateKey: pair.privateKey,
    });
    const revoked = await worker.fetch(afterReuse, f.env);
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).code, 'SESSION_REVOKED');
  } finally { f.sqlite.close(); }
});

test('watch progress ownership ignores a forged license header from another account', async () => {
  const f = fixture();
  try {
    f.seed('P4K-OWNER-ONE');
    f.seed('P4K-OWNER-TWO');
    const pairOne = await deviceKey();
    const pairTwo = await deviceKey();
    const one = await activate(f, 'P4K-OWNER-ONE', 'device-owner-one', pairOne);
    const two = await activate(f, 'P4K-OWNER-TWO', 'device-owner-two', pairTwo);
    const item = { slug: 'movie-one', episodeId: 'ep-1', name: 'Movie One', epName: 'Tập 1', currentTime: 30, duration: 100 };

    const save = await signedRequest('/api/watch-progress', {
      method: 'POST', credential: one.accessToken, token: one.accessToken, deviceId: 'device-owner-one', privateKey: pairOne.privateKey,
      body: { item },
    });
    save.headers.set('x-license-key', 'P4K-OWNER-TWO');
    assert.equal((await worker.fetch(save, f.env)).status, 202);

    const readTwo = await signedRequest('/api/watch-progress', {
      credential: two.accessToken, token: two.accessToken, deviceId: 'device-owner-two', privateKey: pairTwo.privateKey,
    });
    assert.deepEqual((await (await worker.fetch(readTwo, f.env)).json()).items, []);

    const readOne = await signedRequest('/api/watch-progress', {
      credential: one.accessToken, token: one.accessToken, deviceId: 'device-owner-one', privateKey: pairOne.privateKey,
    });
    const oneItems = (await (await worker.fetch(readOne, f.env)).json()).items;
    assert.equal(oneItems.length, 1);
    assert.equal(oneItems[0].slug, 'movie-one');
  } finally { f.sqlite.close(); }
});

test('media tickets stop working when their session is revoked or the ticket expires', async () => {
  const f = fixture();
  try {
    f.seed('P4K-MEDIA-USER');
    const pair = await deviceKey();
    const session = await activate(f, 'P4K-MEDIA-USER', 'device-media-a', pair);
    const ticket = await sealMediaTicket({
      kind: 'stream', url: 'https://media.example/movie.mp4', format: 'direct',
      exp: Math.floor(Date.now() / 1000) + 300, sid: session.sessionId,
    }, f.env);

    const logout = await signedRequest('/api/auth/logout', {
      method: 'POST', credential: session.accessToken, token: session.accessToken, deviceId: 'device-media-a', privateKey: pair.privateKey, body: {},
    });
    assert.equal((await worker.fetch(logout, f.env)).status, 200);
    const revoked = await worker.fetch(new Request(`https://test.example/api/media/stream?t=${ticket}`), f.env);
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).code, 'SESSION_REVOKED');

    const expiredTicket = await sealMediaTicket({
      kind: 'stream', url: 'https://media.example/movie.mp4', format: 'direct',
      exp: Math.floor(Date.now() / 1000) - 1, sid: session.sessionId,
    }, f.env);
    const expired = await worker.fetch(new Request(`https://test.example/api/media/stream?t=${expiredTicket}`), f.env);
    assert.equal(expired.status, 410);
    assert.equal((await expired.json()).code, 'STREAM_TICKET_EXPIRED');
  } finally { f.sqlite.close(); }
});

test('release records require HTTPS and SHA-256 metadata in production', async () => {
  const f = fixture();
  try {
    // A public read does not publish unverifiable entries.
    f.sqlite.prepare('INSERT INTO downloads (platform, url, version, sha256, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ios', 'https://downloads.example/app.ipa', '9.9.9', '', 0, '2026-01-01');
    const check = await worker.fetch(new Request('https://test.example/api/app/check-update?version=1.0.0&platform=ios'), f.env);
    const result = await check.json();
    assert.equal(result.isLatest, false);
    assert.equal(result.downloadSha256, undefined);
    assert.notEqual(releaseHash, '');
  } finally { f.sqlite.close(); }
});

test('admin key rotation stores an HMAC verifier and revokes the prior admin session', async () => {
  const f = fixture();
  try {
    f.env.ADMIN_KEY_PEPPER = 'test-admin-key-pepper-with-at-least-32-bytes';
    const pair = await deviceKey();
    const admin = await activate(f, f.env.ADMIN_LICENSE_KEY, 'device-admin-a', pair, f.env.ADMIN_TELEGRAM_ID);
    assert.equal(admin.isAdmin, true);
    const rotate = await signedRequest('/api/admin/rotate-master-key', {
      method: 'POST', credential: admin.accessToken, token: admin.accessToken, deviceId: 'device-admin-a', privateKey: pair.privateKey,
      body: { newKey: 'NEW-ADMIN-KEY-2026' },
    });
    const rotated = await worker.fetch(rotate, f.env);
    assert.equal(rotated.status, 200);
    const verifier = f.sqlite.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'admin_key_hmac_v1'").get().setting_value;
    assert.match(verifier, /^hmac-sha256:[a-f0-9]{64}$/);

    const oldStatus = await signedRequest('/api/auth/status', {
      credential: admin.accessToken, token: admin.accessToken, deviceId: 'device-admin-a', privateKey: pair.privateKey,
    });
    assert.equal((await worker.fetch(oldStatus, f.env)).status, 401);

    const replacementPair = await deviceKey();
    const replacement = await activate(f, 'NEW-ADMIN-KEY-2026', 'device-admin-b', replacementPair, f.env.ADMIN_TELEGRAM_ID);
    assert.equal(replacement.isAdmin, true);
  } finally { f.sqlite.close(); }
});
