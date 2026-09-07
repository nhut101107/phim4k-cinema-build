// 3D Coverflow Carousel & Bottom Tab Controller matching Phim4K Native App Interface

const Coverflow = {
  movies: [],
  currentIndex: 0,
  autoTimer: null,
  touchStartX: 0,
  touchEndX: 0,

  init(movies = []) {
    if (!movies || movies.length === 0) return;
    this.movies = movies;
    this.currentIndex = 0;
    this.renderCards();
    this.updateDetails();
    this.setupGestures();
    this.startAutoRotate();
  },

  renderCards() {
    const track = document.getElementById('coverflowTrack');
    if (!track) return;
    track.innerHTML = '';

    if (this.movies.length === 0) return;

    const total = this.movies.length;
    const centerIdx = this.currentIndex;
    const leftIdx = (centerIdx - 1 + total) % total;
    const rightIdx = (centerIdx + 1) % total;

    // Create 3 cards: Left, Center, Right
    const visibleCards = [
      { role: 'left', movie: this.movies[leftIdx], index: leftIdx },
      { role: 'center', movie: this.movies[centerIdx], index: centerIdx },
      { role: 'right', movie: this.movies[rightIdx], index: rightIdx }
    ];

    visibleCards.forEach(item => {
      const card = document.createElement('div');
      card.className = `coverflow-card ${item.role}`;
      card.dataset.index = item.index;

      const img = document.createElement('img');
      img.alt = item.movie.name || 'Poster';
      img.loading = 'eager';
      img.decoding = 'async';
      img.fetchPriority = item.role === 'center' ? 'high' : 'low';
      img.src = App.resolveImageUrl(item.movie.poster_url || item.movie.thumb_url || '');
      App.attachPosterFallback(img, [App.resolveImageUrl(item.movie.thumb_url || item.movie.poster_url || '')]);

      card.appendChild(img);

      // Click handling
      card.onclick = () => {
        if (item.role === 'center') {
          this.playCurrent();
        } else if (item.role === 'left') {
          this.prev();
        } else if (item.role === 'right') {
          this.next();
        }
      };

      track.appendChild(card);
    });

    this.updateDots();
  },

  updateDetails() {
    if (this.movies.length === 0) return;
    const cur = this.movies[this.currentIndex];
    if (!cur) return;

    const titleEl = document.getElementById('cfTitle');
    const subEl = document.getElementById('cfSubtitle');
    const qualityEl = document.getElementById('cfBadgeQuality');
    const yearEl = document.getElementById('cfBadgeYear');
    const statusEl = document.getElementById('cfBadgeStatus');
    const catEl = document.getElementById('cfCategories');
    const synEl = document.getElementById('cfSynopsis');

    if (titleEl) titleEl.textContent = cur.name || 'Đang cập nhật tên phim';
    if (subEl) subEl.textContent = cur.origin_name || '';
    if (qualityEl) qualityEl.textContent = cur.quality || 'Theo nguồn';
    if (yearEl) yearEl.textContent = cur.year || 'Chưa rõ năm';
    if (statusEl) statusEl.textContent = cur.episode_current || 'Xem danh sách tập';

    if (catEl) {
      const cats = cur.category || [];
      catEl.textContent = Array.isArray(cats) 
        ? cats.map(c => typeof c === 'object' ? c.name : c).join(', ')
        : cats;
    }

    if (synEl) {
      synEl.textContent = cur.content 
        ? cur.content.replace(/<[^>]*>?/gm, '').trim()
        : 'Bấm Thông tin để xem nội dung và danh sách tập của phim này.';
    }
  },

  updateDots() {
    const dotsContainer = document.getElementById('cfDots');
    if (!dotsContainer) return;
    dotsContainer.innerHTML = '';

    const maxDots = Math.min(6, this.movies.length);
    for (let i = 0; i < maxDots; i++) {
      const dot = document.createElement('span');
      if (i === (this.currentIndex % maxDots)) {
        dot.className = 'cf-dash active';
      } else {
        dot.className = 'cf-dot';
      }
      dot.onclick = () => {
        this.currentIndex = i;
        this.renderCards();
        this.updateDetails();
        this.resetAutoRotate();
      };
      dotsContainer.appendChild(dot);
    }
  },

  prev() {
    if (this.movies.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.movies.length) % this.movies.length;
    this.renderCards();
    this.updateDetails();
    this.resetAutoRotate();
  },

  next() {
    if (this.movies.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.movies.length;
    this.renderCards();
    this.updateDetails();
    this.resetAutoRotate();
  },

  playCurrent() {
    if (this.movies.length === 0) return;
    const cur = this.movies[this.currentIndex];
    if (cur && cur.slug) {
      App.openMovieDetail(cur.slug, true);
    }
  },

  infoCurrent() {
    if (this.movies.length === 0) return;
    const cur = this.movies[this.currentIndex];
    if (cur && cur.slug) {
      App.openMovieDetail(cur.slug, false);
    }
  },

  startAutoRotate() {
    clearInterval(this.autoTimer);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Rebuilding all cover cards during automatic rotation creates a visible
    // blank frame in WKWebView while the next poster decodes. Phone users can
    // swipe instead; keep auto rotation only on larger screens.
    if (window.matchMedia?.('(max-width: 600px)').matches) return;
    this.autoTimer = setInterval(() => {
      if (document.hidden) return;
      if (!document.getElementById('movieModal')?.classList.contains('hidden')) return;
      if (!document.getElementById('playerModal')?.classList.contains('hidden')) return;
      this.next();
    }, 8000);
  },

  resetAutoRotate() {
    clearInterval(this.autoTimer);
    this.startAutoRotate();
  },

  setupGestures() {
    const container = document.getElementById('coverflowContainer');
    if (!container) return;

    container.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      const diff = this.touchEndX - this.touchStartX;
      if (Math.abs(diff) > 40) {
        if (diff < 0) {
          this.next();
        } else {
          this.prev();
        }
      }
    }, { passive: true });
  }
};

// ==========================================
// 2. CONTINUE WATCHING (XEM TIẾP CỦA BẠN)
// ==========================================
const ContinueWatching = {
  storageKey: 'phim4k_continue_watching',
  clearPendingKey: 'phim4k_continue_clear_pending',
  syncTimer: null,
  syncInFlight: null,
  pendingItems: new Map(),
  posterRefreshes: new Map(),

  getDefaultSeed() {
    return [];
  },

  parseClock(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  },

  formatSec(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  },

  normalizeItem(item) {
    if (!item || typeof item !== 'object') return null;
    const slug = String(item.slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(slug)) return null;
    const clocks = String(item.timeText || '').split('/');
    const currentTime = Number.isFinite(Number(item.currentTime)) ? Number(item.currentTime) : this.parseClock(clocks[0]);
    const duration = Number.isFinite(Number(item.duration)) ? Number(item.duration) : this.parseClock(clocks[1]);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration < 5) return null;
    const name = String(item.name || slug).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
    const epName = String(item.epName || 'Tập 1').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    const episodeId = String(item.episodeId || epName).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
    const safeCurrent = Math.max(0, Math.min(currentTime, duration));
    return {
      slug,
      name,
      epName,
      episodeId,
      currentTime: safeCurrent,
      duration,
      timeText: `${this.formatSec(safeCurrent)} / ${this.formatSec(duration)}`,
      progressPercent: Math.max(0, Math.min(100, Number(item.progressPercent) || Math.round((safeCurrent / duration) * 100))),
      thumb: String(item.thumb || '').slice(0, 500),
      updatedAt: item.updatedAt || 0
    };
  },

  itemTimestamp(item) {
    const parsed = Date.parse(String(item?.updatedAt || ''));
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(item?.updatedAt);
    return Number.isFinite(numeric) ? numeric : 0;
  },

  getSavedTime(movieSlug, episodeId, episodeName = '') {
    const slug = String(movieSlug || '').trim().toLowerCase();
    const id = String(episodeId || '').trim().toLowerCase();
    const name = String(episodeName || '').trim().toLowerCase();
    const item = this.getItems().find(candidate => candidate.slug === slug
      && (String(candidate.episodeId || '').toLowerCase() === id || String(candidate.epName || '').toLowerCase() === name));
    const seconds = Number(item?.currentTime);
    return Number.isFinite(seconds) ? seconds : 0;
  },

  writeItems(items) {
    const clean = (Array.isArray(items) ? items : []).map(item => this.normalizeItem(item)).filter(Boolean).slice(0, 10);
    localStorage.setItem(this.storageKey, JSON.stringify(clean));
    return clean;
  },

  getItems() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const legacyDemoSlugs = new Set(['cua-hang-sat-thu', 'the-boys-season-2', 'sieu-anh-hung']);
        const cleaned = Array.isArray(parsed)
          ? parsed.map(item => this.normalizeItem(item)).filter(item => item && !legacyDemoSlugs.has(item.slug)).slice(0, 10)
          : [];
        localStorage.setItem(this.storageKey, JSON.stringify(cleaned));
        return cleaned;
      }
    } catch (e) {}
    return this.getDefaultSeed();
  },

  saveItem(movie, epName, currentTime, duration, episodeId = '') {
    if (!movie || !Number.isFinite(Number(duration)) || Number(duration) < 5) return;
    let list = this.getItems();
    list = list.filter(item => item.slug !== movie.slug);
    const item = this.normalizeItem({
      slug: movie.slug,
      name: movie.name,
      epName: epName || 'Tập 1',
      episodeId: episodeId || epName || 'tap-1',
      currentTime,
      duration,
      thumb: movie.thumb_url || movie.poster_url || '',
      updatedAt: Date.now()
    });
    if (!item) return;
    list.unshift(item);
    this.writeItems(list);
    this.queueSync(item);
    this.render();
  },

  queueSync(item) {
    const normalized = this.normalizeItem(item);
    if (!normalized) return;
    this.pendingItems.set(normalized.slug, normalized);
    if (this.syncTimer) return;
    this.syncTimer = window.setTimeout(() => void this.flushSync(), 7000);
  },

  async flushSync({ keepalive = false } = {}) {
    if (this.syncTimer) window.clearTimeout(this.syncTimer);
    this.syncTimer = null;
    if (this.syncInFlight) return this.syncInFlight;
    const queued = [...this.pendingItems.values()];
    this.pendingItems.clear();
    const clearPending = localStorage.getItem(this.clearPendingKey) === '1';
    if (!queued.length && !clearPending) return;
    this.syncInFlight = (async () => {
      try {
        if (clearPending) {
          await API.clearWatchProgress();
          localStorage.removeItem(this.clearPendingKey);
        }
        if (queued.length) await API.saveWatchProgress(queued, { keepalive });
      } catch (_error) {
        queued.forEach(item => this.pendingItems.set(item.slug, item));
      } finally {
        this.syncInFlight = null;
        if (this.pendingItems.size && !this.syncTimer) {
          this.syncTimer = window.setTimeout(() => void this.flushSync(), 12000);
        }
      }
    })();
    return this.syncInFlight;
  },

  async syncFromServer() {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = (async () => {
      try {
        if (localStorage.getItem(this.clearPendingKey) === '1') {
          await API.clearWatchProgress();
          localStorage.removeItem(this.clearPendingKey);
        }
        const localItems = this.getItems();
        const response = await API.getWatchProgress();
        const remoteItems = (response?.items || []).map(item => this.normalizeItem(item)).filter(Boolean);
        const merged = new Map();
        for (const item of [...remoteItems, ...localItems]) {
          const previous = merged.get(item.slug);
          if (!previous || this.itemTimestamp(item) >= this.itemTimestamp(previous)) merged.set(item.slug, item);
        }
        const items = [...merged.values()].sort((a, b) => this.itemTimestamp(b) - this.itemTimestamp(a)).slice(0, 10);
        this.writeItems(items);
        for (const item of items) {
          localStorage.setItem(`watch_${item.slug}_${item.episodeId}`, Number(item.currentTime).toFixed(1));
        }
        this.render();

        const remoteByMovie = new Map(remoteItems.map(item => [item.slug, item]));
        const upload = localItems.filter(item => {
          const remote = remoteByMovie.get(item.slug);
          return !remote || this.itemTimestamp(item) > this.itemTimestamp(remote);
        });
        if (upload.length) await API.saveWatchProgress(upload);
      } catch (_error) {
        this.render();
      } finally {
        this.syncInFlight = null;
      }
    })();
    return this.syncInFlight;
  },

  clearAll() {
    const items = this.getItems();
    for (const item of items) localStorage.removeItem(`watch_${item.slug}_${item.episodeId}`);
    localStorage.setItem(this.storageKey, '[]');
    localStorage.setItem(this.clearPendingKey, '1');
    this.pendingItems.clear();
    void this.flushSync();
    this.render();
  },

  findFreshMovie(slug) {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!normalizedSlug) return null;
    const candidates = [
      ...(Array.isArray(window.App?.homeCatalog) ? window.App.homeCatalog : []),
      ...(Array.isArray(window.App?.heroList) ? window.App.heroList : []),
    ];
    return candidates.find(movie => String(movie?.slug || '').trim().toLowerCase() === normalizedSlug) || null;
  },

  posterSource(item) {
    const freshMovie = this.findFreshMovie(item?.slug);
    return freshMovie?.thumb_url || freshMovie?.poster_url || item?.thumb || '';
  },

  cacheFreshPoster(slug, source) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const cleanSource = String(source || '').trim().slice(0, 500);
    if (!cleanSlug || !cleanSource) return;
    const items = this.getItems();
    let changed = false;
    for (const item of items) {
      if (item.slug === cleanSlug && item.thumb !== cleanSource) {
        item.thumb = cleanSource;
        changed = true;
      }
    }
    if (changed) this.writeItems(items);
  },

  async refreshPoster(item, image) {
    const slug = String(item?.slug || '').trim().toLowerCase();
    if (!slug || !image) return;
    image.dataset.movieSlug = slug;

    let request = this.posterRefreshes.get(slug);
    if (!request) {
      request = Promise.resolve()
        .then(() => API.getDetail(slug))
        .then(data => data?.movie?.thumb_url || data?.movie?.poster_url || '')
        .catch(() => '')
        .finally(() => this.posterRefreshes.delete(slug));
      this.posterRefreshes.set(slug, request);
    }

    const source = await request;
    if (!source || !image.isConnected || image.dataset.movieSlug !== slug) return;
    const resolved = App.resolveImageUrl(source);
    if (resolved === App.posterFallbackUrl()) return;
    this.cacheFreshPoster(slug, source);
    delete image.dataset.posterFallback;
    image.src = resolved;
  },

  render() {
    const row = document.getElementById('continueWatchingRow');
    if (!row) return;
    row.innerHTML = '';

    const items = this.getItems();
    if (!items || items.length === 0) {
      document.getElementById('continueWatchingSection')?.classList.add('hidden');
      return;
    }
    document.getElementById('continueWatchingSection')?.classList.remove('hidden');

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'cw-card';
      card.onclick = () => App.openMovieDetail(item.slug, true);

      const posterSource = this.posterSource(item);
      const posterUrl = App.resolveImageUrl(posterSource);

      card.innerHTML = `
        <div class="cw-thumb-wrapper">
          <img src="${posterUrl}" class="cw-thumb" alt="${App.escapeHtml(item.name)}" loading="lazy" decoding="async" />
          <div class="cw-progress-bar">
            <div class="cw-progress-fill" style="width: ${Number.isFinite(Number(item.progressPercent)) ? Number(item.progressPercent) : 0}%"></div>
          </div>
        </div>
        <div class="cw-meta">${item.epName} • ${item.timeText}</div>
        <div class="cw-name">${item.name}</div>
      `;

      const image = card.querySelector('.cw-thumb');
      image.dataset.movieSlug = item.slug;
      image.addEventListener('error', () => void this.refreshPoster(item, image), { once: true });
      App.attachPosterFallback(image);
      if (posterUrl === App.posterFallbackUrl()) void this.refreshPoster(item, image);
      row.appendChild(card);
    });
  }
};

// ==========================================
// 3. BOTTOM TAB BAR CONTROLLER
// ==========================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-item').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
  if (activeBtn) activeBtn.classList.add('active');

  const homeView = document.getElementById('homeTabContent');
  const searchView = document.getElementById('searchTabContent');
  const scheduleView = document.getElementById('scheduleTabContent');
  const accountView = document.getElementById('accountTabContent');

  if (homeView) homeView.classList.toggle('hidden', tabId !== 'home');
  if (searchView) searchView.classList.toggle('hidden', tabId !== 'search');
  if (scheduleView) scheduleView.classList.toggle('hidden', tabId !== 'schedule');
  if (accountView) accountView.classList.toggle('hidden', tabId !== 'account');

  if (tabId === 'search') {
    setTimeout(() => {
      document.getElementById('tabSearchInput')?.focus();
    }, 150);
  }

  if (tabId === 'account') {
    renderAccountTab();
  }

  if (tabId === 'schedule') {
    window.App?.renderSchedule?.();
  }

  window.API?.trackUsage?.('tab_view', { tab: tabId });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAccountTab() {
  const session = window.Auth?.activeKeyData;
  const isAuthenticated = Boolean(session?.active !== false && (session?.freeAccess || (session?.key && (session?.telegramId || session?.deviceOnly || session?.keyOnly))));
  const teleId = isAuthenticated ? (session.freeAccess ? 'Không cần key' : session.keyOnly ? 'Thiết bị đã gắn key' : session.deviceOnly ? 'Thiết bị được Admin duyệt' : String(session.telegramId)) : 'Chưa đăng nhập';
  const plan = isAuthenticated ? (session.isAdmin ? 'SUPER ADMIN' : (session.plan || 'VIP')) : 'Chưa kích hoạt';
  const key = session?.freeAccess ? 'Không yêu cầu' : isAuthenticated ? `${String(session.key).slice(0, 4)}••••${String(session.key).slice(-4)}` : 'Chưa có key';
  const isSuperAdmin = Boolean(isAuthenticated && session.isAdmin);

  const teleEl = document.getElementById('accTelegramId');
  const planEl = document.getElementById('accPlan');
  const keyEl = document.getElementById('accKey');
  const adminBtn = document.getElementById('accAdminBtn');

  if (teleEl) teleEl.textContent = teleId;
  if (planEl) planEl.textContent = isSuperAdmin ? '👑 SUPER ADMIN' : plan;
  if (keyEl) keyEl.textContent = key;
  const versionEl = document.getElementById('accAppVersion');
  if (versionEl) versionEl.textContent = `v${window.API?.getVersion?.() || '3.4.34'}`;

  if (adminBtn) {
    adminBtn.classList.toggle('hidden', !isSuperAdmin);
  }
  document.getElementById('accLogsBtn')?.classList.toggle('hidden', !isSuperAdmin);
}

function filterByGenre(genre) {
  switchTab('home');
  App.setHomeFilter('genre', genre);
}

function clearContinueWatching() {
  ContinueWatching.clearAll();
}

window.Coverflow = Coverflow;
window.ContinueWatching = ContinueWatching;
window.switchTab = switchTab;
window.filterByGenre = filterByGenre;
window.clearContinueWatching = clearContinueWatching;
