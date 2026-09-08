// API Client with automatic license/device identity. Movie providers are only
// reachable through the configured Cloudflare Worker.

const API = {
  movieCache: new Map(),
  usageQueue: [],
  usageFlushTimer: null,
  lastUsageFingerprint: '',
  lastUsageAt: 0,
  maxMovieCacheEntries: 80,
  refreshPromise: null,

  getSession() { return window.SessionVault?.current?.() || null; },

  hasSession() { return Boolean(this.getSession()?.accessToken); },

  getDeviceId() {
    return localStorage.getItem('phim4k_device_id') || '';
  },

  getVersion() {
    return '3.4.39';
  },

  getSessionId() {
    let id = sessionStorage.getItem('phim4k_session_id');
    if (!id) {
      const random = globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
        : Math.random().toString(36).slice(2, 10);
      id = `s-${Date.now().toString(36)}-${random}`;
      sessionStorage.setItem('phim4k_session_id', id);
    }
    return id;
  },

  getOperationalContext() {
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
    const runtime = /Phim4KTV/.test(navigator.userAgent) ? 'Android TV' : /Phim4KAndroid/.test(navigator.userAgent) ? 'Android app' : /Phim4KDesktop/.test(navigator.userAgent) ? 'Windows app' : window.Capacitor?.isNativePlatform?.()
      ? `${window.Capacitor.getPlatform?.() || 'native'} app`
      : (standalone ? 'PWA' : 'Web');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      session: this.getSessionId(),
      runtime,
      viewport: `${innerWidth}x${innerHeight}`,
      os: /Windows NT/.test(navigator.userAgent) ? 'Windows' : /Android/.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : 'other',
      browser: /Edg\//.test(navigator.userAgent) ? 'Edge' : /Chrome\//.test(navigator.userAgent) ? 'Chromium' : /Safari\//.test(navigator.userAgent) ? 'WebKit' : 'other',
      screen: `${Math.round(window.screen?.width || innerWidth)}x${Math.round(window.screen?.height || innerHeight)}`,
      language: String(navigator.language || 'unknown').slice(0, 20),
      network: String(connection?.effectiveType || (navigator.onLine ? 'online' : 'offline')).slice(0, 20)
    };
  },

  async cachedMovieRequest(endpoint, ttlMs = 60000) {
    const cached = this.movieCache.get(endpoint);
    if (cached?.data && cached.expiresAt > Date.now()) return cached.data;
    if (cached?.promise) return cached.promise;
    const promise = this.request(endpoint)
      .then((data) => {
        this.movieCache.set(endpoint, { data, expiresAt: Date.now() + ttlMs });
        while (this.movieCache.size > this.maxMovieCacheEntries) {
          this.movieCache.delete(this.movieCache.keys().next().value);
        }
        return data;
      })
      .catch((error) => {
        this.movieCache.delete(endpoint);
        throw error;
      });
    this.movieCache.set(endpoint, { promise, expiresAt: Date.now() + ttlMs });
    return promise;
  },

  clearMovieCache() {
    this.movieCache.clear();
  },

  trackUsage(action, context = {}) {
    if (!this.hasSession() || !this.getDeviceId()) return;
    const safeAction = String(action || '').trim().toLowerCase();
    if (!safeAction) return;
    const operational = safeAction === 'app_open'
      ? this.getOperationalContext()
      : { session: this.getSessionId() };
    const safeContext = Object.fromEntries(Object.entries({ ...operational, ...context })
      .filter(([, value]) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 160) : value]));
    const fingerprint = `${safeAction}:${JSON.stringify(safeContext)}`;
    const timestamp = Date.now();
    if (fingerprint === this.lastUsageFingerprint && timestamp - this.lastUsageAt < 2000) return;
    this.lastUsageFingerprint = fingerprint;
    this.lastUsageAt = timestamp;
    this.usageQueue.push({ action: safeAction, context: { ...safeContext, eventAt: new Date().toISOString() } });
    this.usageQueue = this.usageQueue.slice(-60);
    if (this.usageQueue.length >= 10) {
      void this.flushUsage();
      return;
    }
    window.clearTimeout(this.usageFlushTimer);
    this.usageFlushTimer = window.setTimeout(() => void this.flushUsage(), 1200);
  },

  async flushUsage({ keepalive = false } = {}) {
    window.clearTimeout(this.usageFlushTimer);
    this.usageFlushTimer = null;
    if (!this.usageQueue.length || !this.hasSession() || !this.getDeviceId()) return;
    const events = this.usageQueue.splice(0, 20);
    try {
      await this.request('/api/telemetry', {
        method: 'POST',
        keepalive,
        body: JSON.stringify({ events })
      });
    } catch (_error) {
      this.usageQueue.unshift(...events.slice(-10));
    }
  },

  async fetchWithTimeout(input, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  },

  async fetchJson(input, options = {}, timeoutMs = 15000) {
    const response = await this.fetchWithTimeout(input, options, timeoutMs);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  },

  async request(endpoint, options = {}, retried = false) {
    const headers = {
      'Content-Type': 'application/json',
      'x-device-id': this.getDeviceId(),
      'x-app-version': this.getVersion(),
      ...(options.headers || {})
    };

    try {
      const response = await this.fetchWithTimeout(endpoint, { ...options, headers });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 && payload.code === 'ACCESS_TOKEN_EXPIRED' && !retried) {
        const refreshed = await this.refreshSession();
        if (refreshed?.active) return this.request(endpoint, options, true);
      }
      if (response.status === 401 || response.status === 403) {
        Auth.triggerLock(payload.message || 'Khóa kích hoạt không hợp lệ hoặc đã hết hạn!');
        const error = new Error(payload.error || 'UNAUTHORIZED_KEY');
        error.status = response.status;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (err) {
      console.warn(`Local API [${endpoint}] unavailable, using direct client-side fallback:`, err.message);
      throw err;
    }
  },

  async refreshSession() {
    if (this.refreshPromise) return this.refreshPromise;
    const current = this.getSession();
    if (!current?.refreshToken) return null;
    this.refreshPromise = (async () => {
      try {
        const proof = await SessionVault.proofHeaders('POST', '/api/auth/refresh', current.refreshToken);
        const response = await this.fetchWithTimeout('/api/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-refresh-token': current.refreshToken,
            'x-device-id': this.getDeviceId(),
            'x-app-version': this.getVersion(),
            ...proof
          },
          body: '{}'
        }, 15000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.active || !payload.accessToken || !payload.refreshToken) {
          await SessionVault.clear();
          return payload;
        }
        await SessionVault.save(payload);
        return payload;
      } catch (_error) {
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  },

  // Authentication is server-authoritative. A native release must never
  // accept a key locally when the licensing API is unavailable.
  async activate(key, telegramId, deviceId) {
    try {
      const devicePublicKey = await SessionVault.publicDeviceKey();
      const response = await this.fetchWithTimeout('/api/auth/activate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-version': this.getVersion()
        },
        body: JSON.stringify({ key, telegramId, deviceId, devicePublicKey })
      }, 15000);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          code: payload.code || 'ACTIVATION_REJECTED',
          message: payload.message || payload.error || 'Không thể xác thực key trên thiết bị này.',
          maintenance: payload.maintenance || null
        };
      }
      return payload;
    } catch (err) {
      return {
        success: false,
        code: 'LICENSE_SERVER_UNAVAILABLE',
        message: 'Không kết nối được máy chủ bản quyền. Hãy kiểm tra kết nối Internet rồi thử lại.'
      };
    }
  },

  async checkStatus(key, telegramId, deviceId) {
    try {
      const response = await this.fetchWithTimeout('/api/auth/status', {
        cache: 'no-store',
        headers: { 'x-app-version': this.getVersion(), 'x-device-id': deviceId || this.getDeviceId() }
      }, 12000);
      const payload = await response.json().catch(() => ({ active: false, code: 'INVALID_SERVER_RESPONSE' }));
      if (response.status === 401 && payload.code === 'ACCESS_TOKEN_EXPIRED') {
        return await this.refreshSession() || payload;
      }
      return payload;
    } catch (err) {}

    return { active: false, isAdmin: false, plan: 'OFFLINE' };
  },

  async logout() {
    try {
      if (this.hasSession()) await this.request('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch (_error) {
      // Removing the local envelope must still complete when the server is down.
    } finally {
      await SessionVault.clear();
    }
  },

  async requestDeviceAccess(key, deviceId) {
    return this.fetchJson('/api/auth/request-device-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-version': this.getVersion() },
      body: JSON.stringify({ key, deviceId })
    }, 15000);
  },

  async checkDeviceAccess(key, deviceId) {
    try {
      const response = await this.fetchWithTimeout('/api/auth/device-status', {
        cache: 'no-store',
        headers: { 'x-app-version': this.getVersion(), 'x-license-key': key, 'x-device-id': deviceId }
      }, 12000);
      return await response.json().catch(() => ({ active: false, code: 'INVALID_SERVER_RESPONSE' }));
    } catch (_error) {
      return { active: false, isAdmin: false, plan: 'OFFLINE' };
    }
  },

  async checkUpdate(version = this.getVersion()) {
    const platform = window.Phim4KPlatform?.detect(navigator.userAgent, window.PHIM4K_PLATFORM) || 'web';
    return this.fetchJson(`/api/app/check-update?version=${encodeURIComponent(version)}&platform=${encodeURIComponent(platform)}`, {}, 12000);
  },

  async getAnnouncement() {
    return this.fetchJson('/api/app/announcement', {}, 10000);
  },

  async getWatchProgress() {
    return this.request('/api/watch-progress');
  },

  async saveWatchProgress(items, { keepalive = false } = {}) {
    const list = Array.isArray(items) ? items.slice(0, 10) : [items];
    return this.request('/api/watch-progress', {
      method: 'POST',
      keepalive,
      body: JSON.stringify({ items: list })
    });
  },

  async clearWatchProgress() {
    return this.request('/api/watch-progress', { method: 'DELETE' });
  },

  async getPlaybackTicket(streamRef) {
    return this.request('/api/movies/play', {
      method: 'POST',
      body: JSON.stringify(streamRef || {})
    });
  },

  getBundledHomeFeed() {
    const items = Array.isArray(window.PHIM4K_CATALOG_FALLBACK) ? window.PHIM4K_CATALOG_FALLBACK : [];
    return Phim4KHome.build(items, { offline: true, updatedAt: null });
  },

  getBundledMovie(slug) {
    const items = Array.isArray(window.PHIM4K_CATALOG_FALLBACK) ? window.PHIM4K_CATALOG_FALLBACK : [];
    return items.find((item) => item.slug === slug) || null;
  },

  // Movies: server-protected catalog with metadata-only bundled fallback.
  async getHomeFeed() {
    try {
      return await this.cachedMovieRequest('/api/movies/home', 25000);
    } catch (_error) { return this.getBundledHomeFeed(); }
  },

  async getCategory(category, page = 1) {
    try {
      return await this.cachedMovieRequest(`/api/movies/category/${category}?page=${page}`, 60000);
    } catch (_error) {
      const items = this.getBundledHomeFeed().sections.flatMap((section) => section.items);
      return { title: category, items, pagination: { currentPage: 1, totalPages: 1 } };
    }
  },

  async getCatalog(page = 1) {
    return this.cachedMovieRequest(`/api/movies/catalog?page=${page}`, 60000);
  },

  async getFilteredCatalog({ genre = '', country = '' } = {}, page = 1) {
    const query = new URLSearchParams({ page: String(page) });
    if (genre) query.set('genre', genre);
    if (country) query.set('country', country);
    return this.cachedMovieRequest(`/api/movies/filter?${query.toString()}`, 60000);
  },

  async search(query, page = 1) {
    try {
      return await this.cachedMovieRequest(`/api/movies/search?q=${encodeURIComponent(query)}&page=${page}`, 30000);
    } catch (_error) {
      const term = String(query || '').toLocaleLowerCase();
      const items = this.getBundledHomeFeed().sections[0].items.filter((item) => `${item.name} ${item.origin_name}`.toLocaleLowerCase().includes(term));
      return { query, items, pagination: { currentPage: 1, totalPages: 1 } };
    }
  },

  async getDetail(slug) {
    try {
      return await this.cachedMovieRequest(`/api/movies/detail/${slug}`, 300000);
    } catch (_error) {
      const movie = this.getBundledMovie(slug);
      if (movie) return { movie, episodes: [] };
      throw _error;
    }
  }
};

// Top-level `const` values are not guaranteed to become Window properties in
// an iOS WKWebView. Account and other later-loaded scripts therefore use this
// explicit, public reference rather than falling back to a stale version.
window.API = API;
if (typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => void API.flushUsage({ keepalive: true }));
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void API.flushUsage({ keepalive: true });
  });
}
