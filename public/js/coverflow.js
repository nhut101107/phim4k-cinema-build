// 3D Coverflow Carousel & Bottom Tab Controller matching Phim4K Native App Interface

const Coverflow = {
  movies: [],
  currentIndex: 0,
  autoTimer: null,
  touchStartX: 0,
  touchEndX: 0,

  init(movies = []) {
    if (!movies || movies.length === 0) return;
    const currentSlug = this.movies[this.currentIndex]?.slug || '';
    this.movies = movies;
    const preservedIndex = currentSlug
      ? this.movies.findIndex((movie) => movie?.slug === currentSlug)
      : -1;
    this.currentIndex = preservedIndex >= 0
      ? preservedIndex
      : Math.min(this.currentIndex, Math.max(this.movies.length - 1, 0));
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
    const identity = String(cur.slug || cur.name || 'mnhut');
    const hue = [...identity].reduce((total, character, index) => total + character.charCodeAt(0) * (index + 3), 0) % 360;
    document.documentElement?.style?.setProperty?.('--projection-hue', String(hue));
    const featureSection = document.getElementById('coverflowSection');
    if (featureSection) {
      const featureArt = App.resolveImageUrl(cur.thumb_url || cur.poster_url || '');
      const featureTitle = cur.name || 'MNHUT Cinema';
      const featureMeta = [cur.year, cur.quality, cur.episode_current].filter(Boolean).join(' · ');
      featureSection.dataset.featureTitle = featureTitle;
      featureSection.dataset.featureMeta = featureMeta;
      const featureDetails = document.getElementById('coverflowDetails');
      if (featureDetails) {
        featureDetails.dataset.featureTitle = featureTitle;
        featureDetails.dataset.featureMeta = featureMeta;
      }
      if (featureArt) {
        const safeFeatureArt = String(featureArt).replace(/["\\\n\r]/g, '');
        featureSection.style.setProperty('--feature-art', `url("${safeFeatureArt}")`);
        document.documentElement?.style?.setProperty?.('--member-art', `url("${safeFeatureArt}")`);
      }
    }

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
    this.updateSaveButton(cur.slug);
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
      App.openMovieDetail(cur.slug);
    }
  },

  infoCurrent() {
    if (this.movies.length === 0) return;
    const cur = this.movies[this.currentIndex];
    if (cur && cur.slug) {
      App.openMovieDetail(cur.slug);
    }
  },

  updateSaveButton(slug) {
    const button = document.getElementById('btnCfInfo');
    if (!button) return;
    const saved = Boolean(slug && window.AccountExperience?.isSaved?.(slug, 'watchlist'));
    button.classList.toggle('active', saved);
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? 'Bỏ khỏi danh sách xem sau' : 'Lưu vào danh sách xem sau');
    const path = button.querySelector('path');
    if (path) path.setAttribute('d', saved ? 'M5 12l4 4L19 6' : 'M12 5v14M5 12h14');
  },

  async toggleSaveCurrent() {
    const movie = this.movies[this.currentIndex];
    if (!movie?.slug) return;
    await window.AccountExperience?.toggleMovie?.(movie, 'watchlist');
    this.updateSaveButton(movie.slug);
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
      window.App?.refreshPersonalizedHome?.();
      return;
    }
    document.getElementById('continueWatchingSection')?.classList.remove('hidden');

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'cw-card';
      card.onclick = () => App.openMovieDetail(item.slug);

      const posterSource = this.posterSource(item);
      const posterUrl = App.resolveImageUrl(posterSource);

      card.innerHTML = `
        <div class="cw-thumb-wrapper">
          <img src="${App.escapeHtml(posterUrl)}" class="cw-thumb" alt="${App.escapeHtml(item.name)}" loading="lazy" decoding="async" />
          <div class="cw-progress-bar">
            <div class="cw-progress-fill" style="width: ${Number.isFinite(Number(item.progressPercent)) ? Number(item.progressPercent) : 0}%"></div>
          </div>
        </div>
        <div class="cw-meta">${App.escapeHtml(item.epName)} • ${App.escapeHtml(item.timeText)}</div>
        <div class="cw-name">${App.escapeHtml(item.name)}</div>
      `;

      const image = card.querySelector('.cw-thumb');
      image.dataset.movieSlug = item.slug;
      image.addEventListener('error', () => void this.refreshPoster(item, image), { once: true });
      App.attachPosterFallback(image);
      if (posterUrl === App.posterFallbackUrl()) void this.refreshPoster(item, image);
      row.appendChild(card);
    });
    window.App?.refreshPersonalizedHome?.();
  }
};

// ==========================================
// 3. ACCOUNT EXPERIENCE (REAL VIEWING DATA)
// ==========================================
const AccountExperience = {
  overview: null,
  loading: null,
  loadedAt: 0,

  async load({ force = false } = {}) {
    if (!window.API?.hasSession?.()) {
      this.overview = { stats: { watchedSeconds: 0, movieCount: 0, streakDays: 0, byDay: [] }, recentMovies: [], library: [] };
      this.render('Kích hoạt tài khoản để đồng bộ sự kiện máy chủ.');
      return this.overview;
    }
    if (!force && this.overview && Date.now() - this.loadedAt < 60000) {
      this.render('Sự kiện máy chủ · GMT+7');
      return this.overview;
    }
    if (this.loading) return this.loading;
    this.setState('Đang đồng bộ sự kiện máy chủ…');
    this.loading = API.getAccountOverview()
      .then((payload) => {
        this.overview = payload || {};
        this.loadedAt = Date.now();
        this.render('Sự kiện máy chủ · GMT+7');
        return this.overview;
      })
      .catch((error) => {
        this.render('Chưa thể đồng bộ · thử lại sau');
        console.warn('Unable to load account overview', error);
        return this.overview;
      })
      .finally(() => { this.loading = null; });
    return this.loading;
  },

  setState(message) {
    const element = document.getElementById('accStatsState');
    if (element) element.textContent = message;
  },

  setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  },

  render(message) {
    const stats = this.overview?.stats || {};
    const seconds = Math.max(0, Number(stats.watchedSeconds) || 0);
    const hours = seconds / 3600;
    this.setText('accWatchHours', hours >= 10 ? Math.round(hours).toLocaleString('vi-VN') : hours.toLocaleString('vi-VN', { maximumFractionDigits: 1 }));
    this.setText('accMoviesWatched', Math.max(0, Number(stats.movieCount) || 0).toLocaleString('vi-VN'));
    this.setText('accStreak', Math.max(0, Number(stats.streakDays) || 0).toLocaleString('vi-VN'));
    this.setState(message);
    this.renderActivity(stats.byDay || []);
    this.renderTaste(this.overview?.recentMovies || []);
    const library = Array.isArray(this.overview?.library) ? this.overview.library : [];
    this.setText('accWatchlistCount', this.libraryItems('watchlist').length ? `${this.libraryItems('watchlist').length} phim đã lưu` : 'Chưa có phim');
    this.setText('accFavoritesCount', this.libraryItems('favorites').length ? `${this.libraryItems('favorites').length} phim yêu thích` : 'Chưa có phim');
    this.updateDetailButtons(window.App?.activeMovieDetail?.movie?.slug);
    window.Coverflow?.updateSaveButton?.(window.Coverflow?.movies?.[window.Coverflow?.currentIndex]?.slug);
    window.App?.refreshExperienceEffects?.(document.getElementById('accountTabContent'));
  },

  vietnamDay(offset = 0) {
    return new Date(Date.now() + (7 * 60 * 60 * 1000) + offset * 86400000).toISOString().slice(0, 10);
  },

  renderActivity(rows) {
    const host = document.getElementById('accActivityBars');
    if (!host) return;
    const values = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.day), Math.max(0, Number(row.watchedSeconds) || 0)]));
    const series = Array.from({ length: 30 }, (_, index) => {
      const day = this.vietnamDay(index - 29);
      return { day, seconds: values.get(day) || 0 };
    });
    const max = Math.max(1, ...series.map((item) => item.seconds));
    host.innerHTML = '';
    series.forEach((item, index) => {
      const bar = document.createElement('i');
      const minutes = Math.round(item.seconds / 60);
      bar.style.setProperty('--activity', `${Math.max(8, Math.round((item.seconds / max) * 100))}%`);
      bar.classList.toggle('has-activity', item.seconds > 0);
      bar.title = `${item.day}: ${minutes} phút`;
      bar.setAttribute('aria-label', `${index + 1} trên 30, ${minutes} phút`);
      host.appendChild(bar);
    });
  },

  renderTaste(recentMovies) {
    const host = document.getElementById('accFavoriteGenres');
    if (!host) return;
    const recent = new Set((Array.isArray(recentMovies) ? recentMovies : []).map((movie) => movie.slug));
    const counts = new Map();
    const recentCatalog = (window.App?.homeCatalog || []).filter((movie) => recent.has(movie.slug));
    recentCatalog.forEach((movie) => {
      window.App.getMovieTags(movie, 'category').forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi')).slice(0, 3);
    host.innerHTML = tags.length
      ? tags.map(([tag]) => {
        const movie = recentCatalog.find((item) => window.App.getMovieTags(item, 'category').includes(tag));
        const art = window.App.resolveImageUrl(movie?.thumb_url || movie?.poster_url || '').replace(/["\\\n\r]/g, '');
        return `<span class="account-taste-card" style="--taste-art:url('${window.App.escapeHtml(art)}')">${window.App.escapeHtml(tag)}</span>`;
      }).join('')
      : '<small>Chưa đủ dữ liệu</small>';
  },

  libraryItems(list) {
    return (Array.isArray(this.overview?.library) ? this.overview.library : []).filter((item) => item.list === list);
  },

  isSaved(slug, list) {
    return this.libraryItems(list).some((item) => item.slug === slug);
  },

  updateDetailButtons(slug) {
    const normalized = String(slug || '').trim().toLowerCase();
    const configs = [
      ['detailWatchlistBtn', 'watchlist', '♡ Xem sau', '✓ Đã lưu'],
      ['detailFavoriteBtn', 'favorites', '◇ Yêu thích', '◆ Đã thích'],
    ];
    configs.forEach(([id, list, idle, active]) => {
      const button = document.getElementById(id);
      if (!button) return;
      const saved = Boolean(normalized && this.isSaved(normalized, list));
      button.classList.toggle('active', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.textContent = saved ? active : idle;
    });
  },

  async toggleCurrentMovie(list) {
    const movie = window.App?.activeMovieDetail?.movie;
    return this.toggleMovie(movie, list);
  },

  async toggleMovie(movie, list) {
    if (!movie?.slug || !['watchlist', 'favorites'].includes(list)) return;
    if (!window.API?.hasSession?.()) {
      this.setState('Kích hoạt tài khoản để lưu phim.');
      return;
    }
    if (!this.overview) await this.load();
    const wasSaved = this.isSaved(movie.slug, list);
    const previous = [...(this.overview?.library || [])];
    const item = { slug: movie.slug, name: movie.name || movie.slug, list, updatedAt: new Date().toISOString() };
    this.overview.library = wasSaved
      ? previous.filter((entry) => !(entry.slug === movie.slug && entry.list === list))
      : [item, ...previous];
    this.render('Đang lưu thay đổi…');
    try {
      if (wasSaved) await API.removeLibraryMovie(movie.slug, list);
      else await API.saveLibraryMovie(movie, list);
      this.loadedAt = Date.now();
      this.render(wasSaved ? 'Đã bỏ khỏi thư viện.' : 'Đã lưu vào thư viện.');
    } catch (error) {
      this.overview.library = previous;
      this.render('Không lưu được · vui lòng thử lại');
      console.warn('Unable to update account library', error);
    }
  },

  async openLibrary(list) {
    await this.load();
    window.App?.showPersonalLibrary?.(this.libraryItems(list), list);
  },

  openDevices() {
    const session = window.Auth?.activeKeyData || {};
    const count = Math.max(0, Number(session.deviceCount) || 0);
    const max = Math.max(0, Number(session.maxDevices) || 0);
    const summary = max ? `${count}/${max} thiết bị đang liên kết` : 'Phiên hiện tại được bảo vệ';
    this.setText('accDeviceSummary', summary);
    window.alert(max ? `${summary}. Bạn có thể đổi thiết bị bằng cách đăng xuất phiên hiện tại trước.` : 'Phiên đăng nhập hiện tại đang được mã hóa và bảo vệ theo thiết bị.');
  },
};

// ==========================================
// 4. BOTTOM TAB BAR CONTROLLER
// ==========================================
function switchTab(tabId) {
  document.body.dataset.activeTab = tabId;
  const pageTitle = document.querySelector('.mobile-page-title');
  if (pageTitle) pageTitle.textContent = ({ home: 'Trang chủ', search: 'Duyệt tìm', schedule: 'Lịch chiếu', account: 'Tài khoản' })[tabId] || 'MNHUT Cinema';
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
  const isAuthenticated = Boolean(session?.active !== false && window.SessionVault?.hasSession?.());
  const teleId = isAuthenticated ? (session.freeAccess ? 'Không cần key' : session.isAdmin ? 'Quản trị viên đã xác thực' : 'Thiết bị đã xác thực') : 'Chưa đăng nhập';
  const plan = isAuthenticated
    ? (session.isAdmin ? 'SUPER ADMIN' : (session.freeAccess ? 'MNHUT CINEMA 4K' : (session.plan || 'VIP')))
    : 'Chưa kích hoạt';
  const key = session?.freeAccess ? 'Không yêu cầu' : isAuthenticated ? (session.keyHint || 'Phiên an toàn') : 'Chưa có key';
  const isSuperAdmin = Boolean(isAuthenticated && session.isAdmin);

  const teleEl = document.getElementById('accTelegramId');
  const planEl = document.getElementById('accPlan');
  const keyEl = document.getElementById('accKey');
  const displayNameEl = document.getElementById('accDisplayName');
  const adminBtn = document.getElementById('accAdminBtn');

  if (teleEl) teleEl.textContent = teleId;
  if (planEl) planEl.textContent = isSuperAdmin ? '👑 SUPER ADMIN' : plan;
  if (keyEl) keyEl.textContent = key;
  if (displayNameEl) displayNameEl.textContent = isSuperAdmin ? 'Quản trị viên' : 'Thành viên';
  const versionEl = document.getElementById('accAppVersion');
  if (versionEl) versionEl.textContent = `v${window.API?.getVersion?.() || '3.61'}`;

  if (adminBtn) {
    adminBtn.classList.toggle('hidden', !isSuperAdmin);
  }
  document.getElementById('accLogsBtn')?.classList.toggle('hidden', !isSuperAdmin);
  const deviceCount = Math.max(0, Number(session?.deviceCount) || 0);
  const maxDevices = Math.max(0, Number(session?.maxDevices) || 0);
  AccountExperience.setText('accDeviceSummary', maxDevices ? `${deviceCount}/${maxDevices} thiết bị đang liên kết` : 'Phiên hiện tại được bảo vệ');
  void AccountExperience.load();
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
window.AccountExperience = AccountExperience;
window.switchTab = switchTab;
window.filterByGenre = filterByGenre;
window.clearContinueWatching = clearContinueWatching;
