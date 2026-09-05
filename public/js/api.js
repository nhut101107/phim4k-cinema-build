// API Client with automatic Telegram ID, License Key & Direct Client-Side Standalone Fallback

const API = {
  movieCache: new Map(),
  usageQueue: [],
  usageFlushTimer: null,
  lastUsageFingerprint: '',
  lastUsageAt: 0,
  maxMovieCacheEntries: 80,

  getKey() {
    return localStorage.getItem('phim4k_key') || '';
  },

  getTelegramId() {
    return localStorage.getItem('phim4k_telegram_id') || '';
  },

  getDeviceId() {
    return localStorage.getItem('phim4k_device_id') || '';
  },

  getVersion() {
    return '3.4.13';
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
    const runtime = window.Capacitor?.isNativePlatform?.()
      ? `iOS app`
      : (standalone ? 'PWA' : 'Web');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      session: this.getSessionId(),
      runtime,
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
    if (!this.getKey() || !this.getDeviceId()) return;
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
    this.usageQueue.push({ action: safeAction, context: safeContext });
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
    if (!this.usageQueue.length || !this.getKey() || !this.getDeviceId()) return;
    const events = this.usageQueue.splice(0, 20);
    try {
      const response = await fetch('/api/telemetry', {
        method: 'POST',
        keepalive,
        headers: {
          'Content-Type': 'application/json',
          'x-license-key': this.getKey(),
          'x-telegram-id': this.getTelegramId(),
          'x-device-id': this.getDeviceId(),
          'x-app-version': this.getVersion()
        },
        body: JSON.stringify({ events })
      });
      if (!response.ok && response.status >= 500) this.usageQueue.unshift(...events.slice(-10));
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

  async request(endpoint, options = {}) {
    const key = this.getKey();
    const telegramId = this.getTelegramId();
    const deviceId = this.getDeviceId();

    const headers = {
      'Content-Type': 'application/json',
      'x-license-key': key,
      'x-telegram-id': telegramId,
      'x-device-id': deviceId,
      'x-app-version': this.getVersion(),
      ...(options.headers || {})
    };

    try {
      const response = await this.fetchWithTimeout(endpoint, { ...options, headers });
      const payload = await response.json().catch(() => ({}));
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

  // Authentication is server-authoritative. A native release must never
  // accept a key locally when the licensing API is unavailable.
  async activate(key, telegramId, deviceId) {
    try {
      const response = await this.fetchWithTimeout('/api/auth/activate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-version': this.getVersion()
        },
        body: JSON.stringify({ key, telegramId, deviceId })
      }, 15000);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          code: payload.code || 'ACTIVATION_REJECTED',
          message: payload.message || payload.error || 'Không thể xác thực key hoặc Telegram ID.'
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
      const response = await this.fetchWithTimeout(`/api/auth/status?key=${encodeURIComponent(key)}&telegramId=${encodeURIComponent(telegramId)}&deviceId=${encodeURIComponent(deviceId)}&version=${encodeURIComponent(this.getVersion())}`, {
        headers: { 'x-app-version': this.getVersion() }
      }, 12000);
      return await response.json().catch(() => ({ active: false, code: 'INVALID_SERVER_RESPONSE' }));
    } catch (err) {}

    return { active: false, isAdmin: false, plan: 'OFFLINE' };
  },

  async requestDeviceAccess(key, deviceId) {
    return this.fetchJson('/api/auth/request-device-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-version': this.getVersion() },
      body: JSON.stringify({ key, deviceId })
    }, 15000);
  },

  async checkDeviceAccess(key, deviceId) {
    return this.fetchJson(`/api/auth/device-status?key=${encodeURIComponent(key)}&deviceId=${encodeURIComponent(deviceId)}`, {
      headers: { 'x-app-version': this.getVersion() }
    }, 12000);
  },

  async checkUpdate(version = this.getVersion()) {
    try {
      const response = await this.fetchWithTimeout(`/api/app/check-update?version=${encodeURIComponent(version)}`, {}, 12000);
      if (response.ok) return await response.json();
    } catch (err) {}
    return { isLatest: true, currentVersion: version, latestVersion: version };
  },

  async getAnnouncement() {
    return this.fetchJson('/api/app/announcement', {}, 10000);
  },

  getBundledHomeFeed() {
    const items = Array.isArray(window.PHIM4K_CATALOG_FALLBACK) ? window.PHIM4K_CATALOG_FALLBACK : [];
    return {
      updatedAt: new Date().toISOString(),
      hero: items.slice(0, 5),
      sections: [
        { id: 'latest', title: 'Phim moi cap nhat', items },
        { id: 'movies', title: 'Phim de cu', items: items.slice(0, 6) },
        { id: 'series', title: 'Phim bo va hoat hinh', items: items.slice(2) }
      ]
    };
  },

  getBundledMovie(slug) {
    const items = Array.isArray(window.PHIM4K_CATALOG_FALLBACK) ? window.PHIM4K_CATALOG_FALLBACK : [];
    return items.find((item) => item.slug === slug) || null;
  },

  // Movies: Direct standalone fallback to live public movie API
  async getHomeFeed() {
    try {
      return await this.cachedMovieRequest('/api/movies/home', 25000);
    } catch (err) {
      // Capacitor cannot use the catalog directly because it has no CORS
      // permission.  Do not leave the screen spinning while a rate-limited
      // relay recovers; render the bundled metadata immediately instead.
      if (window.Phim4KRuntime?.apiBaseUrl) return this.getBundledHomeFeed();
      console.log('Fetching live movie feed directly from phimapi.com...');
      const [latestRes, movieRes, seriesRes, animeRes] = await Promise.allSettled([
        this.fetchJson('https://phimapi.com/danh-sach/phim-moi-cap-nhat?page=1'),
        this.fetchJson('https://phimapi.com/v1/api/danh-sach/phim-le?page=1&limit=16'),
        this.fetchJson('https://phimapi.com/v1/api/danh-sach/phim-bo?page=1&limit=16'),
        this.fetchJson('https://phimapi.com/v1/api/danh-sach/hoat-hinh?page=1&limit=16')
      ]);

      const latestItems = latestRes.status === 'fulfilled' ? latestRes.value.items || [] : [];
      const movieItems = movieRes.status === 'fulfilled' ? movieRes.value.data?.items || [] : [];
      const seriesItems = seriesRes.status === 'fulfilled' ? seriesRes.value.data?.items || [] : [];
      const animeItems = animeRes.status === 'fulfilled' ? animeRes.value.data?.items || [] : [];

      if (!latestItems.length) return this.getBundledHomeFeed();

      // Hero banner items
      const hero = latestItems.slice(0, 8).map(m => ({
        name: m.name,
        slug: m.slug,
        origin_name: m.origin_name,
        poster_url: m.poster_url,
        thumb_url: m.thumb_url,
        year: m.year,
        quality: m.quality || '4K Ultra HD',
        episode_current: m.episode_current || 'Bản Chiếu Rạp'
      }));

      return {
        hero,
        sections: [
          { id: 'latest', title: '🔥 Phim Mới Cập Nhật Hôm Nay', items: latestItems.slice(0, 18) },
          { id: 'movies', title: '🎬 Phim Lẻ Chiếu Rạp (4K Ultra HD)', items: movieItems },
          { id: 'series', title: '📺 Phim Bộ Đang Thịnh Hành', items: seriesItems },
          { id: 'anime', title: '✨ Anime & Hoạt Hình Hot', items: animeItems }
        ]
      };
    }
  },

  async getCategory(category, page = 1) {
    try {
      return await this.cachedMovieRequest(`/api/movies/category/${category}?page=${page}`, 60000);
    } catch (err) {
      if (window.Phim4KRuntime?.apiBaseUrl) {
        return { title: category, items: this.getBundledHomeFeed().sections.flatMap((section) => section.items), pagination: { currentPage: 1, totalPages: 1 } };
      }
      const url = category === 'phim-moi-cap-nhat' 
        ? `https://phimapi.com/danh-sach/phim-moi-cap-nhat?page=${page}`
        : `https://phimapi.com/v1/api/danh-sach/${category}?page=${page}&limit=24`;
      let data;
      try {
        data = await this.fetchJson(url);
      } catch (_error) {
        const items = this.getBundledHomeFeed().sections.flatMap((section) => section.items);
        return { title: category, items, pagination: { currentPage: 1, totalPages: 1 } };
      }
      return {
        title: category,
        items: data.items || data.data?.items || [],
        pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 10 }
      };
    }
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
    } catch (err) {
      if (window.Phim4KRuntime?.apiBaseUrl) {
        const term = String(query || '').toLocaleLowerCase();
        const items = this.getBundledHomeFeed().sections[0].items.filter((item) => `${item.name} ${item.origin_name}`.toLocaleLowerCase().includes(term));
        return { query, items, pagination: { currentPage: 1, totalPages: 1 } };
      }
      let data;
      try {
        data = await this.fetchJson(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&page=${page}&limit=24`);
      } catch (_error) {
        const term = String(query || '').toLocaleLowerCase();
        const items = this.getBundledHomeFeed().sections[0].items.filter((item) => `${item.name} ${item.origin_name}`.toLocaleLowerCase().includes(term));
        return { query, items, pagination: { currentPage: 1, totalPages: 1 } };
      }
      return {
        query,
        items: data.data?.items || [],
        pagination: data.data?.params?.pagination || { currentPage: page, totalPages: 1 }
      };
    }
  },

  async getDetail(slug) {
    try {
      return await this.cachedMovieRequest(`/api/movies/detail/${slug}`, 300000);
    } catch (err) {
      if (window.Phim4KRuntime?.apiBaseUrl) {
        const movie = this.getBundledMovie(slug);
        if (movie) return { movie, episodes: [] };
      }
      try {
        return await this.fetchJson(`https://phimapi.com/phim/${slug}`);
      } catch (_error) {
        const movie = this.getBundledMovie(slug);
        if (movie) return { movie, episodes: [] };
        throw _error;
      }
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
