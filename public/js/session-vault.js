/* Server-issued session storage and device proof.
 * Long-lived license/admin keys are never persisted here. Native shells store
 * the rotating session envelope in Keychain/Keystore/DPAPI. The P-256 private
 * key is non-extractable and is persisted by the WebView's IndexedDB engine.
 */
(() => {
  const DB_NAME = 'phim4k-security-v1';
  const STORE = 'vault';
  const SESSION_KEY = 'session';
  const DEVICE_KEY = 'device-signing-key';
  let databasePromise;
  let deviceKeyPromise;
  let session = null;
  let initialized = false;

  const bytesToBase64Url = (bytes) => {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const openDatabase = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('SECURE_DATABASE_UNAVAILABLE'));
    });
    return databasePromise;
  };

  const dbOperation = async (mode, callback) => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      let result;
      try { result = callback(store); }
      catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error || new Error('SECURE_DATABASE_ERROR'));
      transaction.onabort = () => reject(transaction.error || new Error('SECURE_DATABASE_ABORTED'));
    });
  };

  const nativeStore = () => {
    if (window.Phim4KSecureSession) return window.Phim4KSecureSession;
    try {
      return window.Capacitor?.Plugins?.SecureSession
        || window.Capacitor?.registerPlugin?.('SecureSession')
        || null;
    } catch (_error) {
      return null;
    }
  };

  const safeSession = (value) => {
    if (!value || typeof value !== 'object') return null;
    const accessToken = String(value.accessToken || '');
    const refreshToken = String(value.refreshToken || '');
    if (!/^p4a_[A-Za-z0-9_-]{43}$/.test(accessToken) || !/^p4r_[A-Za-z0-9_-]{43}$/.test(refreshToken)) return null;
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: String(value.accessExpiresAt || ''),
      refreshExpiresAt: String(value.refreshExpiresAt || ''),
      sessionId: String(value.sessionId || ''),
      isAdmin: value.isAdmin === true,
      freeAccess: value.freeAccess === true,
      keyOnly: value.keyOnly === true,
      plan: String(value.plan || 'STANDARD').slice(0, 64),
      keyHint: String(value.keyHint || '').slice(0, 32),
      expiresAt: value.expiresAt || null,
      maxDevices: Math.max(0, Number(value.maxDevices || 0)),
      deviceCount: Math.max(0, Number(value.deviceCount || 0)),
    };
  };

  async function readSession() {
    if (session) return session;
    const native = nativeStore();
    if (native?.get) {
      try {
        const response = await native.get();
        return safeSession(JSON.parse(response?.value || 'null'));
      } catch (_error) {
        return null;
      }
    }
    try {
      const stored = await dbOperation('readonly', (store) => store.get(SESSION_KEY));
      if (stored) return safeSession(stored);
    } catch (_error) {}
    try {
      const raw = localStorage.getItem('phim4k_session_fallback');
      if (raw) return safeSession(JSON.parse(raw));
    } catch (_e) {}
    return null;
  }

  async function writeSession(value) {
    const clean = safeSession(value);
    if (!clean) throw new Error('INVALID_SESSION_ENVELOPE');
    session = clean;
    try {
      localStorage.setItem('phim4k_session_fallback', JSON.stringify(clean));
    } catch (_e) {}
    try {
      const native = nativeStore();
      if (native?.set) await native.set({ value: JSON.stringify(clean) });
      else await dbOperation('readwrite', (store) => store.put(clean, SESSION_KEY));
    } catch (_error) {}
    return clean;
  }

  async function clearSession() {
    session = null;
    try { localStorage.removeItem('phim4k_session_fallback'); } catch (_e) {}
    const native = nativeStore();
    if (native?.clear) {
      try { await native.clear(); } catch (_error) {}
    }
    try { await dbOperation('readwrite', (store) => store.delete(SESSION_KEY)); }
    catch (_error) {}
  }

  let inMemoryDeviceKey = null;

  async function createDeviceKey() {
    try {
      if (!window.crypto?.subtle?.generateKey) return null;
      const generated = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const [publicJwk, privateJwk] = await Promise.all([
        crypto.subtle.exportKey('jwk', generated.publicKey),
        crypto.subtle.exportKey('jwk', generated.privateKey),
      ]);
      const [publicKey, privateKey] = await Promise.all([
        crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
        crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
      ]);
      const pair = { publicKey, privateKey };
      inMemoryDeviceKey = pair;
      try {
        await dbOperation('readwrite', (store) => store.put(pair, DEVICE_KEY));
      } catch (_e) {}
      return pair;
    } catch (_err) {
      return null;
    }
  }

  async function ensureDeviceKey() {
    if (inMemoryDeviceKey) return inMemoryDeviceKey;
    if (deviceKeyPromise) return deviceKeyPromise;
    deviceKeyPromise = (async () => {
      let pair = null;
      try {
        pair = await dbOperation('readonly', (store) => store.get(DEVICE_KEY));
      } catch (_error) {
        pair = null;
      }
      if (pair?.privateKey && pair?.publicKey) {
        try {
          await crypto.subtle.exportKey('jwk', pair.publicKey);
          inMemoryDeviceKey = pair;
          return pair;
        } catch (_error) {
          try { await dbOperation('readwrite', (store) => store.delete(DEVICE_KEY)); }
          catch (_deleteError) {}
        }
      }
      const created = await createDeviceKey();
      inMemoryDeviceKey = created;
      return created;
    })();
    try {
      return await deviceKeyPromise;
    } catch (_err) {
      deviceKeyPromise = null;
      return null;
    }
  }

  async function publicDeviceKey() {
    try {
      const pair = await ensureDeviceKey();
      if (!pair?.publicKey || !window.crypto?.subtle?.exportKey) return null;
      const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
      return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    } catch (_err) {
      return null;
    }
  }

  async function proofHeaders(method, input, credential) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
      const canonical = `${String(method || 'GET').toUpperCase()}\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${credential}`;
      const pair = await ensureDeviceKey();
      if (!pair?.privateKey || !window.crypto?.subtle?.sign) {
        return { 'x-device-time': timestamp, 'x-device-nonce': nonce };
      }
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(canonical),
      );
      return {
        'x-device-time': timestamp,
        'x-device-nonce': nonce,
        'x-device-proof': bytesToBase64Url(signature),
      };
    } catch (_e) {
      return {};
    }
  }

  const PUBLIC_PATHS = new Set([
    '/api/auth/activate',
    '/api/auth/refresh',
    '/api/auth/request-device-access',
    '/api/auth/device-status',
    '/api/app/access-policy',
    '/api/app/check-update',
    '/api/app/version',
    '/api/app/announcement',
    '/api/app/downloads',
    '/api/media/image',
    '/api/media/stream',
    '/api/health',
  ]);

  const SessionVault = {
    async init() {
      if (initialized) return session;
      initialized = true;
      try {
        await ensureDeviceKey();
      } catch (_e) {}
      try {
        session = await readSession();
      } catch (_e) {}
      return session;
    },
    current() { return session; },
    hasSession() { return Boolean(session?.accessToken && session?.refreshToken); },
    publicDeviceKey,
    save: writeSession,
    clear: clearSession,
    proofHeaders,
    async decorate(input, init = {}) {
      try {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (!url.pathname.startsWith('/api/') || PUBLIC_PATHS.has(url.pathname) || !session?.accessToken) return init;
        const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
        const deviceId = String(localStorage.getItem('phim4k_device_id') || '').trim();
        if (deviceId) headers.set('x-device-id', deviceId);
        headers.set('authorization', `Bearer ${session.accessToken}`);
        try {
          const proofs = await proofHeaders(method, url.href, session.accessToken);
          for (const [name, value] of Object.entries(proofs || {})) {
            if (value) headers.set(name, value);
          }
        } catch (_proofErr) {}
        return { ...init, headers };
      } catch (_e) {
        return init;
      }
    },
  };

  window.SessionVault = SessionVault;
})();
