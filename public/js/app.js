// Main Application Logic (Home, Categories, Search, Detail Modal)

const App = {
  currentCategory: 'home',
  currentPage: 1,
  currentHeroMovie: null,
  heroList: [],
  heroRotateTimer: null,
  feedRefreshTimer: null,
  announcementRefreshTimer: null,
  announcementExpiryTimer: null,
  homeFeedLoading: false,
  homeFeedUpdatedAt: null,
  homeFeedOffline: false,
  homeFeedSignature: '',
  homeCatalog: [],
  baseHomeSections: [],
  homeSections: [],
  activeHomeFilters: { genre: '', country: '' },
  filterResults: [],
  filterPagination: { currentPage: 0, totalPages: 0, totalItems: 0 },
  filterLoading: false,
  filterError: '',
  filterRequestId: 0,
  browseAllMode: false,
  catalogInventoryTotal: 0,
  activeMovieDetail: null,
  activeServerIndex: 0,
  searchDebounceTimer: null,
  searchRequestId: 0,
  scrollFrame: 0,
  lastCatalogInteractionAt: 0,
  heroRenderSignature: '',
  detailRequestId: 0,
  railInitialItems: 14,
  railBatchItems: 12,
  activeMood: '',
  moodMovies: [],
  lastMoodSelections: new Map(),
  motionTier: 'low',

  init() {
    document.body.dataset.activeTab = 'home';
    this.configureAdaptiveMotion();
    this.bindEvents();
    this.bindTouchFeedback();
    const activationGate = document.getElementById('activationGate');
    if (activationGate && typeof MutationObserver !== 'undefined') {
      this.activationGateObserver = new MutationObserver(() => this.syncPageScrollLock());
      this.activationGateObserver.observe(activationGate, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    this.syncPageScrollLock();
    this.loadHomeFeed();
    this.startHomeFeedRefresh();
    this.startAnnouncementRefresh();
  },

  configureAdaptiveMotion() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const cores = Number(navigator.hardwareConcurrency || 2);
    const memory = Number(navigator.deviceMemory || 0);
    const saveData = Boolean(navigator.connection?.saveData);
    const tv = document.body.classList.contains('platform-tv');
    this.motionTier = reduced || saveData || cores <= 2 || (memory > 0 && memory <= 2)
      ? 'low'
      : (cores >= 6 && (memory === 0 || memory >= 4) && !tv ? 'high' : 'mid');
    document.body.dataset.motionTier = this.motionTier;
    if (this.motionTier === 'high') {
      let frame = 0;
      document.addEventListener('pointermove', (event) => {
        if (frame || event.pointerType === 'touch') return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const hero = document.getElementById('coverflowSection');
          if (!hero || hero.classList.contains('hidden')) return;
          const rect = hero.getBoundingClientRect();
          hero.style.setProperty('--pointer-x', `${Math.max(0, Math.min(100, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100))}%`);
          hero.style.setProperty('--pointer-y', `${Math.max(0, Math.min(100, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100))}%`);
        });
      }, { passive: true });
    }
  },

  refreshExperienceEffects(root = document) {
    if (this.motionTier === 'low' || typeof IntersectionObserver === 'undefined') return;
    if (!this.revealObserver) {
      this.revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('experience-visible');
          this.revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '80px 0px', threshold: 0.08 });
    }
    root.querySelectorAll?.('.movie-section:not(.experience-visible), .mood-discovery:not(.experience-visible), .account-card:not(.experience-visible)')
      .forEach((element) => this.revealObserver.observe(element));
  },

  bindTouchFeedback() {
    const selector = 'button, [role="button"], .movie-card, .coverflow-card, .schedule-card';
    const clear = () => document.querySelectorAll('.is-pressing').forEach((element) => element.classList.remove('is-pressing'));
    document.addEventListener('pointerdown', (event) => {
      const target = event.target.closest?.(selector);
      if (target && !target.disabled) {
        target.classList.add('is-pressing');
        if (target.closest?.('.cinema-rail, .movie-grid, .coverflow-section')) {
          this.lastCatalogInteractionAt = Date.now();
        }
      }
    }, { passive: true });
    document.addEventListener('pointerup', clear, { passive: true });
    document.addEventListener('pointercancel', clear, { passive: true });
    window.addEventListener('blur', clear);
  },

  bindEvents() {
    // Navbar scroll effect
    window.addEventListener('scroll', () => {
      this.lastCatalogInteractionAt = Date.now();
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 30);
        this.scrollFrame = 0;
      });
    }, { passive: true });

    // Search Input
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');

    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      searchClear.classList.toggle('hidden', !val);
      clearTimeout(this.searchDebounceTimer);
      if (!val) {
        this.hideSearchDropdown();
        return;
      }
      this.searchDebounceTimer = setTimeout(() => {
        this.performInstantSearch(val);
      }, 300);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val) {
          this.hideSearchDropdown();
          this.loadFullSearch(val, 1);
        }
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        this.hideSearchDropdown();
      }
      // Some iOS WebView sessions retain a stale body lock after dismissing a
      // dialog. Re-evaluate it after every tap instead of leaving the home
      // feed permanently unscrollable.
      requestAnimationFrame(() => this.syncPageScrollLock());
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.currentCategory === 'home') {
        this.loadHomeFeed({ silent: true });
        this.loadAnnouncement();
      }
    });
    window.addEventListener('online', () => {
      API.clearMovieCache();
      if (this.currentCategory === 'home') this.loadHomeFeed({ silent: true });
      this.loadAnnouncement();
    });
  },

  syncPageScrollLock() {
    const gate = document.getElementById('activationGate');
    const gateOpen = Boolean(gate
      && !gate.classList.contains('hidden')
      && gate.style.display !== 'none'
      && getComputedStyle(gate).display !== 'none');
    // Modal/player overlays are fixed and manage their own scroll. Do not
    // lock the document for them: iOS WebView may retain that lock after an
    // overlay closes, making the home feed look frozen.
    document.body.classList.toggle('activation-locked', Boolean(gateOpen));
    if (!gateOpen) {
      for (const element of [document.documentElement, document.body]) {
        element.style.removeProperty('overflow');
        element.style.removeProperty('overflow-y');
        element.style.removeProperty('height');
        element.style.removeProperty('position');
        element.style.removeProperty('touch-action');
      }
    }
  },

  // =================================================
  // 1. HOME FEED & HERO BILLBOARD
  // =================================================
  async loadHomeFeed({ silent = false } = {}) {
    if (this.homeFeedLoading) return;
    this.homeFeedLoading = true;
    this.currentCategory = 'home';
    this.updateActiveNav('home');
    // The current mobile layout uses Coverflow instead of the retired
    // #heroBillboard block. Keep this path compatible with both layouts so a
    // missing optional hero cannot abort the entire catalogue promise.
    document.getElementById('heroBillboard')?.classList.remove('hidden');
    document.getElementById('coverflowSection')?.classList.remove('hidden');
    document.getElementById('featuredSnapSection')?.classList.remove('hidden');
    document.getElementById('continueWatchingSection')?.classList.remove('hidden');
    document.getElementById('moodDiscovery')?.classList.remove('hidden');
    document.getElementById('catalogFilterPanel')?.classList.remove('hidden');
    document.getElementById('dynamicSections')?.classList.remove('hidden');
    document.getElementById('categoryView')?.classList.add('hidden');

    const container = document.getElementById('dynamicSections');
    // Any client can encounter a slow first connection. Render the bundled
    // catalogue immediately, then refresh it in place when the live Worker
    // response arrives.
    let renderedBundledCatalog = false;
    if (!silent) {
      try {
        this.applyHomeFeed(API.getBundledHomeFeed());
        renderedBundledCatalog = true;
      } catch (fallbackError) {
        console.warn('Unable to render bundled home catalogue', fallbackError);
      }
    }

    if (!silent && !renderedBundledCatalog) container.innerHTML = `
      <div class="loading-spinner-wrapper">
        <div class="spinner"></div>
        <p>Đang tải kho phim 4K cập nhật mới nhất...</p>
      </div>
    `;

    try {
      const data = await API.getHomeFeed();
      if (renderedBundledCatalog) void this.preloadHomeArtwork(data);
      const signature = this.catalogSignature(data);
      if (!silent || signature !== this.homeFeedSignature) this.applyHomeFeed(data);
      else this.updateLiveFeedLabel();
      void this.refreshCatalogInventory();
    } catch (err) {
      // Do not replace a visible fallback catalogue with a transient error.
      if (silent || renderedBundledCatalog) return;
      container.innerHTML = `
        <div class="loading-spinner-wrapper">
          <p style="color: #f87171;">❌ Lỗi kết nối máy chủ dữ liệu phim. Vui lòng thử lại sau!</p>
          <button class="btn-primary" style="width: auto; margin-top: 10px;" onclick="App.loadHomeFeed()">Thử Lại</button>
        </div>
      `;
    } finally {
      this.homeFeedLoading = false;
      this.syncPageScrollLock();
    }
  },

  catalogSignature(data) {
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const movieKey = (movie) => [
      movie?.slug || movie?.name || '', movie?.year || '', movie?.episode_current || '',
      movie?.quality || '', movie?.lang || '', movie?.modified?.time || movie?.updated_at || ''
    ];
    return JSON.stringify({
      hero: (Array.isArray(data?.hero) ? data.hero : []).map(movieKey),
      sections: sections.map((section) => ({
        id: section?.id || section?.title || '',
        title: section?.title || '',
        items: (Array.isArray(section?.items) ? section.items : []).map(movieKey),
      })),
    });
  },

  updateLiveFeedLabel() {
    document.querySelectorAll('.section-update-status').forEach((element) => {
      element.textContent = this.homeFeedOffline ? 'Dữ liệu đã lưu' : `Đã đồng bộ · ${new Date(this.homeFeedUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    });
  },

  preloadHomeArtwork(data, timeoutMs = 1200) {
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const candidates = this.uniqueMovies([
      ...(Array.isArray(data?.hero) ? data.hero : []),
      ...sections.flatMap((section) => Array.isArray(section?.items) ? section.items : [])
    ]).slice(0, 6);
    const urls = candidates
      .map((movie) => this.resolveImageUrl(movie.poster_url || movie.thumb_url))
      .filter(Boolean);
    if (!urls.length) return Promise.resolve(false);

    return new Promise((resolvePreload) => {
      let settled = false;
      let failures = 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePreload(value);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      urls.forEach((url) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
          if (typeof image.decode === 'function') {
            image.decode().then(() => finish(true)).catch(() => finish(true));
          } else {
            finish(true);
          }
        };
        image.onerror = () => {
          failures += 1;
          if (failures === urls.length) finish(false);
        };
        image.src = url;
      });
    });
  },

  applyHomeFeed(data) {
    const visibleAnchor = [...document.querySelectorAll('#dynamicSections [data-section-id]')]
      .map((section) => ({
        id: section.dataset.sectionId,
        top: section.getBoundingClientRect().top,
      }))
      .filter((entry) => entry.id && entry.top < innerHeight * 0.72)
      .sort((a, b) => Math.abs(a.top) - Math.abs(b.top))[0] || null;
    const railPositions = new Map(
      [...document.querySelectorAll('#dynamicSections [data-section-id]')].map((section) => [
        section.dataset.sectionId,
        section.querySelector('.cinema-rail')?.scrollLeft || 0,
      ])
    );
    let sections = Array.isArray(data?.sections) ? data.sections : [];
    if (!sections.some((section) => Array.isArray(section?.items) && section.items.length > 0)) {
      if (data?.policy !== Phim4KHome.POLICY) {
        data = Phim4KHome.build([
          ...(data?.hero || []), ...(data?.sections || []).flatMap(section => section.items || [])
        ], { updatedAt: data?.updatedAt || null, offline: Boolean(data?.offline) });
        sections = Array.isArray(data?.sections) ? data.sections : [];
      }
    }
    const hasMovies = sections.some((section) => Array.isArray(section?.items) && section.items.length > 0);
    if (!hasMovies) throw new Error('MOVIE_CATALOG_EMPTY');
    this.homeFeedOffline = Boolean(data.offline);
    this.homeFeedUpdatedAt = this.homeFeedOffline ? null : data.updatedAt || new Date().toISOString();
    this.homeFeedSignature = this.catalogSignature(data);
    this.heroList = data.hero || [];
    document.getElementById('coverflowSection')?.classList.toggle('hidden', !this.heroList.length);
    const rawCatalog = this.uniqueMovies([
      ...this.heroList,
      ...sections.flatMap((section) => Array.isArray(section?.items) ? section.items : [])
    ]);
    this.homeCatalog = this.enrichCatalogFilters(rawCatalog);
    this.baseHomeSections = sections;
    this.homeSections = this.buildHomeSections(sections);
    if (this.heroList.length > 0) {
      const nextHeroSignature = this.heroList
        .map((movie) => `${movie?.slug || movie?.name || ''}:${movie?.poster_url || movie?.thumb_url || ''}`)
        .join('|');
      if (window.Coverflow && nextHeroSignature !== this.heroRenderSignature) {
        Coverflow.init(this.heroList);
        this.heroRenderSignature = nextHeroSignature;
      }
      this.renderHeroBillboard(this.heroList[0]);
      this.startHeroRotation();
    }

    if (window.ContinueWatching) {
      ContinueWatching.render();
    }

    this.renderHomeCatalog();
    requestAnimationFrame(() => {
      document.querySelectorAll('#dynamicSections [data-section-id]').forEach((section) => {
        const previous = railPositions.get(section.dataset.sectionId);
        const rail = section.querySelector('.cinema-rail');
        if (rail && Number.isFinite(previous) && previous > 0) rail.scrollLeft = previous;
      });
      if (visibleAnchor) {
        const nextAnchor = [...document.querySelectorAll('#dynamicSections [data-section-id]')]
          .find((section) => section.dataset.sectionId === visibleAnchor.id);
        if (nextAnchor) {
          const delta = nextAnchor.getBoundingClientRect().top - visibleAnchor.top;
          if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
        }
      }
    });
    this.renderSchedule();
    this.applyMoodArtwork();
    this.renderMoodSelection();
    this.refreshExperienceEffects();
  },

  getScheduleMovies() {
    return (this.homeCatalog || [])
      .map((movie, index) => ({ movie, index, timestamp: Date.parse(movie?.modified?.time || '') || 0 }))
      .sort((a, b) => (b.timestamp - a.timestamp) || (a.index - b.index))
      .slice(0, 20)
      .map((entry) => entry.movie);
  },

  formatScheduleTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return { day: 'MỚI', time: 'Vừa cập nhật' };
    return {
      day: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      time: date.toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    };
  },

  renderSchedule() {
    const grid = document.getElementById('scheduleGrid');
    const state = document.getElementById('scheduleState');
    const updated = document.getElementById('scheduleUpdatedAt');
    if (!grid || !state || !updated) return;

    const movies = this.getScheduleMovies();
    const feedDate = new Date(this.homeFeedUpdatedAt || '');
    updated.textContent = Number.isNaN(feedDate.getTime())
      ? 'Dữ liệu mới nhất từ kho phim'
      : `Đồng bộ lúc ${feedDate.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}`;

    grid.innerHTML = '';
    if (!movies.length) {
      state.textContent = 'Chưa tải được lịch cập nhật. Hãy bấm Làm mới.';
      state.classList.remove('hidden');
      return;
    }

    state.classList.add('hidden');
    movies.forEach((movie) => {
      const timestamp = this.formatScheduleTime(movie?.modified?.time);
      const posterUrl = this.resolveImageUrl(movie.poster_url || movie.thumb_url);
      const alternatePosterUrl = this.resolveImageUrl(movie.thumb_url || movie.poster_url);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'schedule-card';
      card.setAttribute('aria-label', `Mở phim ${movie.name || movie.origin_name || ''}`);
      card.innerHTML = `
        <img class="schedule-poster" src="${this.escapeHtml(posterUrl)}" alt="" loading="lazy" decoding="async" />
        <span class="schedule-date"><strong>${this.escapeHtml(timestamp.day)}</strong><small>${this.escapeHtml(timestamp.time)}</small></span>
        <span class="schedule-info">
          <strong class="schedule-name">${this.escapeHtml(movie.name || movie.origin_name || 'Phim mới')}</strong>
          <span class="schedule-origin">${this.escapeHtml(movie.origin_name || 'Đang cập nhật thông tin')}</span>
          <span class="schedule-meta">
            <b>${this.escapeHtml(String(movie.year || 'Mới'))}</b>
            <b>${this.escapeHtml(movie.quality || 'Mới cập nhật')}</b>
            <b>${this.escapeHtml(movie.lang || 'Vietsub')}</b>
          </span>
        </span>
        <span class="schedule-open" aria-hidden="true">›</span>
      `;
      this.attachPosterFallback(card.querySelector('.schedule-poster'), [alternatePosterUrl]);
      card.addEventListener('click', () => this.openMovieDetail(movie.slug));
      grid.appendChild(card);
    });
  },

  async refreshSchedule() {
    const button = document.getElementById('scheduleRefreshBtn');
    const state = document.getElementById('scheduleState');
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang tải…';
    }
    if (state) {
      state.textContent = 'Đang lấy lịch cập nhật mới nhất…';
      state.classList.remove('hidden');
    }
    try {
      const data = await API.getHomeFeed();
      this.applyHomeFeed(data);
      this.renderSchedule();
    } catch (_error) {
      if (state) {
        state.textContent = 'Không thể cập nhật lúc này. Dữ liệu đã tải trước đó vẫn được giữ lại.';
        state.classList.remove('hidden');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Làm mới';
      }
    }
  },

  uniqueMovies(items) {
    const seen = new Set();
    return (items || []).filter((movie) => {
      const key = String(movie?.slug || movie?.name || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  enrichCatalogFilters(items) {
    const fallback = Array.isArray(window.PHIM4K_CATALOG_FALLBACK) ? window.PHIM4K_CATALOG_FALLBACK : [];
    return this.uniqueMovies([...this.enrichMovies(items), ...fallback]);
  },

  enrichMovies(items) {
    const fallback = Array.isArray(window.PHIM4K_CATALOG_FALLBACK) ? window.PHIM4K_CATALOG_FALLBACK : [];
    const bySlug = new Map(fallback.map((movie) => [movie.slug, movie]));
    return this.uniqueMovies((items || []).map((movie) => {
      const known = bySlug.get(movie.slug);
      if (!known) return movie;
      return {
        ...known,
        ...movie,
        category: this.getMovieTags(movie, 'category').length ? movie.category : known.category,
        country: this.getMovieTags(movie, 'country').length ? movie.country : known.country,
      };
    }));
  },

  normalizeFilterValue(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi-VN')
      .trim();
  },

  getMovieTags(movie, field) {
    const raw = movie?.[field];
    const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return values
      .map((item) => typeof item === 'string' ? item : item?.name)
      .filter(Boolean)
      .map((value) => String(value).trim());
  },

  moviesMatching(filters = this.activeHomeFilters) {
    return this.homeCatalog.filter((movie) => {
      const genreMatch = !filters.genre || this.getMovieTags(movie, 'category').some((tag) => this.normalizeFilterValue(tag) === this.normalizeFilterValue(filters.genre));
      const countryMatch = !filters.country || this.getMovieTags(movie, 'country').some((tag) => this.normalizeFilterValue(tag) === this.normalizeFilterValue(filters.country));
      return genreMatch && countryMatch;
    });
  },

  buildHomeSections(sourceSections = []) {
    const personalized = window.Phim4KHome?.personalize?.(
      this.homeCatalog,
      window.ContinueWatching?.getItems?.() || [],
      { limit: 30 }
    );
    const groups = [
      ...(personalized ? [personalized] : []),
      ...sourceSections.filter(section => Array.isArray(section?.items) && section.items.length),
      { id: 'genre-action', title: 'Phim hành động', items: this.filterMoviesByTag('category', 'Hành Động') },
      { id: 'genre-animation', title: 'Hoạt hình và Anime', items: this.filterMoviesByTag('category', 'Hoạt Hình') },
      { id: 'country-china', title: 'Phim Trung Quốc', items: this.filterMoviesByTag('country', 'Trung Quốc') },
      { id: 'country-korea', title: 'Phim Hàn Quốc', items: this.filterMoviesByTag('country', 'Hàn Quốc') },
      { id: 'country-japan', title: 'Phim Nhật Bản', items: this.filterMoviesByTag('country', 'Nhật Bản') },
      { id: 'country-western', title: 'Phim Âu Mỹ', items: this.filterMoviesByTag('country', 'Âu Mỹ') },
    ];
    return groups.filter((section) => section.items.length > 0);
  },

  moodDefinition(mood) {
    return {
      relax: { title: 'Nhẹ nhàng cho tối nay', tags: ['tình cảm', 'tâm lý', 'gia đình', 'hài hước', 'chính kịch'] },
      thrill: { title: 'Căng thẳng đến phút cuối', tags: ['hành động', 'hình sự', 'kinh dị', 'bí ẩn', 'giật gân'] },
      night: { title: 'Cuốn để cày xuyên đêm', tags: ['hoạt hình', 'khoa học viễn tưởng', 'viễn tưởng', 'phiêu lưu', 'cổ trang'] },
    }[mood] || null;
  },

  randomUnit() {
    if (globalThis.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      globalThis.crypto.getRandomValues(value);
      return value[0] / 4294967296;
    }
    return Math.random();
  },

  shuffleMovies(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.randomUnit() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  },

  applyMoodArtwork() {
    const definitions = [
      ['relax', ['tinh-cam', 'tam-ly', 'gia-dinh', 'hai-huoc']],
      ['thrill', ['hanh-dong', 'hinh-su', 'kinh-di', 'bi-an']],
      ['night', ['vien-tuong', 'phieu-luu', 'hoat-hinh', 'hanh-dong']],
    ];
    definitions.forEach(([mood, tags], index) => {
      const button = document.querySelector(`.mood-chip[data-mood="${mood}"]`);
      if (!button) return;
      const movie = this.homeCatalog.find((item) => {
        const categories = this.getMovieTags(item, 'category').map((tag) => this.normalizeFilterValue(tag));
        return tags.some((tag) => categories.includes(tag));
      }) || this.homeCatalog[index] || this.heroList[index];
      const art = this.resolveImageUrl(movie?.thumb_url || movie?.poster_url || '').replace(/["\\\n\r]/g, '');
      if (art) button.style.setProperty('--mood-art', `url("${art}")`);
    });
  },
  selectMood(mood) {
    const definition = this.moodDefinition(mood);
    if (!definition || !this.homeCatalog.length) return;
    this.activeMood = mood;
    document.querySelectorAll('.mood-chip').forEach((button) => button.classList.toggle('active', button.dataset.mood === mood));
    const expectedTags = new Set(definition.tags.map((tag) => this.normalizeFilterValue(tag)));
    const matches = this.homeCatalog.filter((movie) => {
      const tags = this.getMovieTags(movie, 'category').map((tag) => this.normalizeFilterValue(tag));
      return tags.some((tag) => [...expectedTags].some((expected) => tag === expected || tag.includes(expected)));
    });
    const moodIndex = { relax: 0, thrill: 1, night: 2 }[mood] ?? 0;
    const candidates = matches.length
      ? matches
      : this.homeCatalog.filter((_movie, index) => index % 3 === moodIndex);
    const previous = this.lastMoodSelections.get(mood) || new Set();
    const history = new Set((window.ContinueWatching?.getItems?.() || []).map((item) => item.slug));
    const randomized = this.shuffleMovies(candidates);
    const unseen = randomized.filter((movie) => !previous.has(movie.slug));
    const repeated = randomized.filter((movie) => previous.has(movie.slug));
    this.moodMovies = [...unseen, ...repeated]
      .slice(0, 12)
      .sort((a, b) => Number(history.has(b.slug)) - Number(history.has(a.slug)));
    this.lastMoodSelections.set(mood, new Set(this.moodMovies.map((movie) => movie.slug)));
    this.renderMoodSelection();
    window.API?.trackUsage?.('filter_applied', { category: `mood-${mood}`, results: this.moodMovies.length });
  },

  renderMoodSelection() {
    const host = document.getElementById('moodDiscovery');
    if (!host) return;
    document.getElementById('moodResultSection')?.remove();
    const definition = this.moodDefinition(this.activeMood);
    if (!definition || !this.moodMovies.length) return;
    const section = document.createElement('section');
    section.id = 'moodResultSection';
    section.className = 'mood-result-section';
    section.innerHTML = `<div class="mood-result-head"><div><span>ĐỀ XUẤT TỪ KHO ĐANG PHÁT ĐƯỢC</span><h2>${this.escapeHtml(definition.title)}</h2></div><button type="button" onclick="App.clearMood()">Đóng</button></div><div class="movie-row mood-result-row"></div>`;
    const row = section.querySelector('.mood-result-row');
    this.moodMovies.forEach((movie, index) => row.appendChild(this.createMovieCard(movie, index)));
    host.after(section);
    this.refreshExperienceEffects(section);
  },

  clearMood() {
    this.activeMood = '';
    this.moodMovies = [];
    document.querySelectorAll('.mood-chip').forEach((button) => button.classList.remove('active'));
    document.getElementById('moodResultSection')?.remove();
  },

  openMoodSurprise() {
    const pool = this.moodMovies.length ? this.moodMovies : this.homeCatalog;
    if (!pool.length) return;
    const watched = new Set((window.ContinueWatching?.getItems?.() || []).map((item) => item.slug));
    const candidates = pool.filter((movie) => !watched.has(movie.slug));
    const list = candidates.length ? candidates : pool;
    const movie = list[Math.floor(Math.random() * list.length)];
    if (movie?.slug) this.openMovieDetail(movie.slug);
  },

  async showPersonalLibrary(libraryItems = [], list = 'watchlist') {
    switchTab('home');
    this.currentCategory = `library-${list}`;
    this.updateActiveNav('home');
    ['heroBillboard', 'coverflowSection', 'featuredSnapSection', 'continueWatchingSection', 'moodDiscovery', 'catalogFilterPanel', 'dynamicSections']
      .forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    const categoryView = document.getElementById('categoryView');
    const grid = document.getElementById('categoryGrid');
    const title = document.getElementById('categoryTitle');
    const count = document.getElementById('categoryCount');
    const pagination = document.getElementById('paginationBox');
    if (!categoryView || !grid || !title || !count || !pagination) return;
    categoryView.classList.remove('hidden');
    const label = list === 'favorites' ? 'Phim yêu thích' : 'Danh sách xem sau';
    title.textContent = label;
    pagination.innerHTML = '<button type="button" class="catalog-load-more-btn" onclick="App.loadHomeFeed()">Quay lại trang chủ</button>';
    const saved = Array.isArray(libraryItems) ? libraryItems : [];
    count.textContent = `(${saved.length} phim)`;
    if (!saved.length) {
      grid.innerHTML = '<div class="catalog-empty-state">Chưa có phim trong danh sách này. Mở một phim rồi bấm lưu để xem lại nhanh hơn.</div>';
      return;
    }
    grid.innerHTML = '<div class="loading-spinner-wrapper" style="grid-column:1/-1"><div class="spinner"></div><p>Đang mở thư viện của bạn…</p></div>';
    const known = new Map(this.uniqueMovies([...this.homeCatalog, ...this.heroList]).map((movie) => [movie.slug, movie]));
    const missing = saved.filter((item) => !known.has(item.slug)).slice(0, 24);
    const fetched = await Promise.allSettled(missing.map((item) => API.getDetail(item.slug)));
    fetched.forEach((result) => {
      const movie = result.status === 'fulfilled' ? result.value?.movie : null;
      if (movie?.slug) known.set(movie.slug, movie);
    });
    const movies = saved.map((item) => known.get(item.slug)).filter(Boolean);
    grid.innerHTML = '';
    if (!movies.length) {
      grid.innerHTML = '<div class="catalog-empty-state">Các phim đã lưu hiện không còn trong kho đang phát. Danh sách vẫn được giữ để tự khôi phục khi nguồn phim trở lại.</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    movies.forEach((movie, index) => fragment.appendChild(this.createMovieCard(movie, index)));
    grid.appendChild(fragment);
    this.refreshExperienceEffects(categoryView);
  },

  refreshPersonalizedHome() {
    if (!this.homeCatalog.length) return;
    const before = this.homeSections.find(section => section.id === 'for-you')?.items?.map(movie => movie.slug).join('|') || '';
    const next = this.buildHomeSections(this.baseHomeSections);
    const after = next.find(section => section.id === 'for-you')?.items?.map(movie => movie.slug).join('|') || '';
    this.homeSections = next;
    if (before !== after && this.currentCategory === 'home') this.renderHomeCatalog();
  },

  filterMoviesByTag(field, value) {
    const expected = this.normalizeFilterValue(value);
    return this.homeCatalog.filter((movie) => this.getMovieTags(movie, field).some((tag) => this.normalizeFilterValue(tag) === expected));
  },

  renderHomeCatalog() {
    const container = document.getElementById('dynamicSections');
    if (!container) return;
    const hasFilter = this.browseAllMode || Boolean(this.activeHomeFilters.genre || this.activeHomeFilters.country);
    document.getElementById('mainContent')?.classList.toggle('filter-active', hasFilter);
    const filteredMovies = hasFilter ? this.filterResults : this.moviesMatching();
    const sections = hasFilter
      ? [{ id: 'filtered', title: this.getFilterTitle(), items: filteredMovies, layout: 'grid' }]
      : this.homeSections;

    container.innerHTML = '';
    if (hasFilter && this.filterLoading && !filteredMovies.length) {
      container.innerHTML = '<div class="loading-spinner-wrapper"><div class="spinner"></div><p>Đang tải thêm phim từ toàn bộ kho…</p></div>';
      this.renderCatalogControls();
      return;
    }
    if (!sections.length || (hasFilter && !filteredMovies.length)) {
      const empty = document.createElement('div');
      empty.className = 'catalog-empty-state';
      empty.textContent = 'Chưa có phim phù hợp trong mục này. Hãy chọn bộ lọc khác hoặc bấm Bỏ lọc.';
      container.appendChild(empty);
    } else {
      sections.forEach((section, index) => container.appendChild(this.createSectionElement(section, index)));
      if (hasFilter && this.filterPagination.currentPage < this.filterPagination.totalPages) {
        const loadMore = document.createElement('button');
        loadMore.type = 'button';
        loadMore.id = 'catalogLoadMoreBtn';
        loadMore.className = 'catalog-load-more-btn';
        loadMore.disabled = this.filterLoading;
        loadMore.textContent = this.filterLoading ? 'Đang tải thêm…' : 'Tải thêm 24 phim';
        loadMore.onclick = () => this.loadHomeFilterResults({ reset: false });
        container.appendChild(loadMore);
      }
    }
    this.renderCatalogControls();
    // Filter and full-catalog grids are replaced in place. Make them visible
    // synchronously instead of waiting for IntersectionObserver: iOS Safari
    // can miss that first observation after scrollIntoView + DOM replacement,
    // leaving valid movie cards at opacity: 0.
    if (hasFilter) {
      container.querySelectorAll('.catalog-grid-section')
        .forEach((section) => section.classList.add('experience-visible'));
    }
    this.refreshExperienceEffects(container);
  },

  getFilterTitle() {
    if (this.browseAllMode) return 'Toàn bộ kho phim';
    const labels = [this.activeHomeFilters.genre, this.activeHomeFilters.country].filter(Boolean);
    return `Kết quả lọc: ${labels.join(' · ')}`;
  },

  collectFilterTags(field, preferred) {
    const available = this.homeCatalog.flatMap((movie) => this.getMovieTags(movie, field));
    const deduped = Array.from(new Map(available.map((value) => [this.normalizeFilterValue(value), value])).values());
    const ordered = preferred;
    return [...ordered, ...deduped.filter((tag) => !ordered.some((value) => this.normalizeFilterValue(tag) === this.normalizeFilterValue(value)))].slice(0, 10);
  },

  renderCatalogControls() {
    const genreBox = document.getElementById('genreFilterChips');
    const countryBox = document.getElementById('countryFilterChips');
    const summary = document.getElementById('catalogFilterSummary');
    const reset = document.getElementById('resetCatalogFilter');
    const browseAll = document.getElementById('browseAllCatalogBtn');
    if (!genreBox || !countryBox || !summary || !reset) return;

    const genres = this.collectFilterTags('category', ['Hành Động', 'Hoạt Hình', 'Tình Cảm', 'Viễn Tưởng', 'Cổ Trang', 'Kinh Dị', 'Hài Hước', 'Tâm Lý', 'Võ Thuật', 'Phiêu Lưu']);
    const countries = this.collectFilterTags('country', ['Việt Nam', 'Trung Quốc', 'Hàn Quốc', 'Nhật Bản', 'Âu Mỹ', 'Thái Lan']);
    this.renderFilterButtons(genreBox, genres, 'genre');
    this.renderFilterButtons(countryBox, countries, 'country');
    const hasFilter = this.browseAllMode || Boolean(this.activeHomeFilters.genre || this.activeHomeFilters.country);
    reset.classList.toggle('hidden', !hasFilter);
    browseAll?.classList.toggle('hidden', this.browseAllMode);
    const filterLabels = [this.activeHomeFilters.genre, this.activeHomeFilters.country].filter(Boolean).join(' · ');
    summary.textContent = hasFilter
      ? (this.filterLoading && !this.filterResults.length
        ? `Đang tải ${this.browseAllMode ? 'toàn bộ kho phim' : `phim ${filterLabels}`}…`
        : `${this.filterResults.length}/${this.filterPagination.totalItems || this.filterResults.length} phim ${this.browseAllMode ? 'trong kho' : filterLabels} đã tải.${this.filterError ? ` ${this.filterError}` : ''}`)
      : `${this.homeCatalog.length} phim nổi bật${this.catalogInventoryTotal ? ` · ${this.catalogInventoryTotal.toLocaleString('vi-VN')} phim trong toàn kho` : ''}.`;
  },

  renderFilterButtons(container, values, kind) {
    container.innerHTML = '';
    values.forEach((value) => {
      const button = document.createElement('button');
      const selected = this.normalizeFilterValue(this.activeHomeFilters[kind]) === this.normalizeFilterValue(value);
      button.type = 'button';
      button.className = 'catalog-filter-chip';
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = value;
      button.onclick = () => this.setHomeFilter(kind, value);
      container.appendChild(button);
    });
  },

  filterValueToSlug(value) {
    return this.normalizeFilterValue(value)
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  },

  async loadHomeFilterResults({ reset = true } = {}) {
    const hasFilter = this.browseAllMode || Boolean(this.activeHomeFilters.genre || this.activeHomeFilters.country);
    if (!hasFilter) return;
    if (!reset && this.filterLoading) return;
    const requestId = reset ? ++this.filterRequestId : this.filterRequestId;
    const page = reset ? 1 : this.filterPagination.currentPage + 1;
    if (reset) {
      // Rendering hundreds of cached cards in one synchronous pass can leave
      // iOS Safari/WKWebView with a blank compositor layer. Seed one page only;
      // the live response below replaces it and pagination appends subsequent
      // pages in small, predictable batches.
      const localResults = (this.browseAllMode ? this.homeCatalog : this.moviesMatching()).slice(0, 24);
      this.filterResults = localResults;
      this.filterPagination = {
        currentPage: localResults.length ? 1 : 0,
        totalPages: localResults.length ? 1 : 0,
        totalItems: localResults.length,
      };
    }
    this.filterLoading = true;
    this.filterError = '';
    this.renderHomeCatalog();
    try {
      const data = this.browseAllMode
        ? await API.getCatalog(page)
        : await API.getFilteredCatalog({
          genre: this.filterValueToSlug(this.activeHomeFilters.genre),
          country: this.filterValueToSlug(this.activeHomeFilters.country),
        }, page);
      if (requestId !== this.filterRequestId) return;
      const incoming = this.enrichMovies(Array.isArray(data.items) ? data.items : []);
      this.filterResults = reset
        ? (incoming.length ? this.uniqueMovies(incoming) : this.filterResults)
        : this.uniqueMovies([...this.filterResults, ...incoming]);
      this.filterPagination = {
        currentPage: Number(data.pagination?.currentPage || page),
        totalPages: Number(data.pagination?.totalPages || page),
        totalItems: Number(data.pagination?.totalItems || this.filterResults.length),
      };
      this.catalogInventoryTotal = Math.max(this.catalogInventoryTotal, Number(data.pagination?.totalItems || 0));
    } catch (_error) {
      if (requestId !== this.filterRequestId) return;
      if (reset) this.filterResults = this.moviesMatching().slice(0, 24);
      this.filterPagination = {
        currentPage: this.filterResults.length ? 1 : 0,
        totalPages: this.filterResults.length ? 1 : 0,
        totalItems: this.filterResults.length,
      };
      this.filterError = 'Máy chủ tạm gián đoạn nên đang hiển thị dữ liệu đã lưu.';
    } finally {
      if (requestId === this.filterRequestId) {
        this.filterLoading = false;
        this.renderHomeCatalog();
      }
    }
  },

  setHomeFilter(kind, value) {
    if (!['genre', 'country'].includes(kind)) return;
    this.browseAllMode = false;
    this.activeHomeFilters[kind] = this.normalizeFilterValue(this.activeHomeFilters[kind]) === this.normalizeFilterValue(value) ? '' : value;
    if (this.activeHomeFilters.genre || this.activeHomeFilters.country) {
      this.loadHomeFilterResults({ reset: true });
    } else {
      this.clearHomeFilters();
    }
    API.trackUsage('filter_applied', {
      genre: this.activeHomeFilters.genre || 'Tất cả',
      country: this.activeHomeFilters.country || 'Tất cả'
    });
    document.getElementById('dynamicSections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  clearHomeFilters() {
    this.filterRequestId += 1;
    this.activeHomeFilters = { genre: '', country: '' };
    this.browseAllMode = false;
    this.filterResults = [];
    this.filterPagination = { currentPage: 0, totalPages: 0, totalItems: 0 };
    this.filterLoading = false;
    this.filterError = '';
    this.renderHomeCatalog();
  },

  async refreshCatalogInventory() {
    try {
      const data = await API.getCatalog(1);
      this.catalogInventoryTotal = Number(data.pagination?.totalItems || data.items?.length || 0);
      this.renderCatalogControls();
    } catch (_error) {
      // The curated home feed remains usable while the inventory count retries later.
    }
  },

  browseAllCatalog() {
    this.browseAllMode = true;
    this.activeHomeFilters = { genre: '', country: '' };
    void this.loadHomeFilterResults({ reset: true });
    document.getElementById('dynamicSections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  startHomeFeedRefresh() {
    clearInterval(this.feedRefreshTimer);
    const isTv = Phim4KPlatform.detect(navigator.userAgent, window.PHIM4K_PLATFORM) === 'android_tv';
    this.feedRefreshTimer = setInterval(() => {
      const playerOpen = !document.getElementById('playerModal')?.classList.contains('hidden');
      const catalogIdle = Date.now() - this.lastCatalogInteractionAt > 12000;
      if (!document.hidden && !playerOpen && this.currentCategory === 'home' && catalogIdle) {
        this.loadHomeFeed({ silent: true });
      }
    // The Worker reads the public catalogue directly, so frequent metadata
    // refreshes need no VPS or always-on PC. Pause while hidden or playing to
    // avoid wasting bandwidth and disrupting playback.
    }, isTv ? 90000 : 60000);
  },

  startAnnouncementRefresh() {
    clearInterval(this.announcementRefreshTimer);
    void this.loadAnnouncement();
    this.announcementRefreshTimer = setInterval(() => {
      const playerOpen = !document.getElementById('playerModal')?.classList.contains('hidden');
      if (!document.hidden && !playerOpen) void this.loadAnnouncement();
    }, 10000);
  },

  async loadAnnouncement() {
    try {
      this.renderAnnouncement(await API.getAnnouncement());
    } catch (_error) {
      // Keep the last valid banner during a transient network interruption.
    }
  },

  renderAnnouncement(data) {
    const banner = document.getElementById('globalAnnouncement');
    if (!banner) return;
    clearTimeout(this.announcementExpiryTimer);
    const expiresAt = Date.parse(data?.expiresAt || '');
    if (!data?.active || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      banner.classList.add('hidden');
      banner.dataset.announcementId = '';
      return;
    }
    document.getElementById('globalAnnouncementTitle').textContent = data.title || 'Thông báo từ Admin';
    document.getElementById('globalAnnouncementMessage').textContent = data.message || '';
    document.getElementById('globalAnnouncementExpiry').textContent = `Ghim đến ${new Date(expiresAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`;
    banner.dataset.announcementId = data.id || '';
    banner.classList.remove('hidden');
    this.announcementExpiryTimer = setTimeout(() => this.renderAnnouncement(data), Math.min(expiresAt - Date.now() + 250, 2147483647));
  },

  renderHeroBillboard(movie) {
    this.currentHeroMovie = movie;
    const backdropEl = document.getElementById('heroBackdrop');
    const titleEl = document.getElementById('heroTitle');
    const subEl = document.getElementById('heroSub');
    const descEl = document.getElementById('heroDesc');
    const yearEl = document.getElementById('heroYear');
    const qualityEl = document.getElementById('heroQuality');

    // Coverflow owns the hero UI in the current iOS build. These IDs only
    // exist in the legacy web layout; Coverflow.init() has already received
    // the same movie list in applyHomeFeed().
    if (!backdropEl || !titleEl || !subEl || !descEl || !yearEl || !qualityEl) return;

    // Protected poster / thumbnail URL resolver
    this.setBackgroundImage(backdropEl, movie.thumb_url || movie.poster_url);

    titleEl.textContent = movie.name;
    subEl.textContent = movie.origin_name || '';
    yearEl.textContent = movie.year || 'Chưa rõ năm';
    qualityEl.textContent = movie.quality || 'Theo nguồn';
    descEl.textContent = movie.content ? movie.content.replace(/<[^>]*>?/gm, '') : 'Bấm Thông tin để xem nội dung và danh sách tập.';
  },

  startHeroRotation() {
    if (this.heroRotateTimer) clearInterval(this.heroRotateTimer);
    let index = 0;
    this.heroRotateTimer = setInterval(() => {
      if (this.heroList.length > 1 && this.currentCategory === 'home') {
        index = (index + 1) % this.heroList.length;
        this.renderHeroBillboard(this.heroList[index]);
      }
    }, 9000);
  },

  createSectionElement(section, sectionIndex = 0) {
    const sec = document.createElement('section');
    const isGrid = section.layout === 'grid';
    const itemCount = (section.items || []).length;
    sec.className = `movie-section ${isGrid ? 'catalog-grid-section' : 'cinema-rail-section'}`;
    sec.dataset.sectionId = section.id || '';

    const updateStatus = section.id === 'latest' && this.homeFeedUpdatedAt
      ? `Đồng bộ ${new Date(this.homeFeedUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
      : section.id === 'for-you'
        ? 'Theo lịch sử xem trên tài khoản này'
        : section.id === 'recent-interest'
        ? 'Xếp theo điểm quan tâm TMDB / IMDb'
        : '';

    sec.innerHTML = `
      <div class="section-header ${isGrid ? '' : 'cinema-section-header'}">
        ${isGrid ? '' : `<span class="section-index" aria-hidden="true">${String(sectionIndex + 1).padStart(2, '0')}</span>`}
        <div class="section-heading-copy">
          ${isGrid ? '' : `<span class="section-eyebrow">BĂNG PHIM · ${itemCount} TỰA</span>`}
          <h2 class="section-title">${this.escapeHtml(section.title)}</h2>
        </div>
        <div class="section-heading-aside">
          ${updateStatus ? `<span class="section-update-status">${this.escapeHtml(updateStatus)}</span>` : ''}
          ${isGrid ? '' : `<span class="rail-position" aria-live="polite">01 / ${String(Math.max(itemCount, 1)).padStart(2, '0')}</span><span class="rail-gesture" aria-hidden="true">VUỐT →</span>`}
        </div>
      </div>
      <div class="${isGrid ? 'movie-grid filtered-movie-grid' : 'movie-row cinema-rail'}" aria-label="${this.escapeHtml(section.title || 'Danh sách phim')}"></div>
    `;

    const row = sec.querySelector(isGrid ? '.filtered-movie-grid' : '.cinema-rail');
    const allItems = section.items || [];
    const initialItems = isGrid ? allItems : allItems.slice(0, this.railInitialItems);
    const fragment = document.createDocumentFragment();
    initialItems.forEach((movie, movieIndex) => {
      const card = this.createMovieCard(movie, isGrid ? null : movieIndex);
      fragment.appendChild(card);
    });
    row.appendChild(fragment);
    if (!isGrid) this.bindMovieRail(sec, row, allItems);

    return sec;
  },

  bindMovieRail(section, row, items = []) {
    if (!row) return;
    const status = section.querySelector('.rail-position');
    if (!status || !row.querySelector('.movie-card')) return;
    let frame = 0;
    let mounted = row.querySelectorAll('.movie-card').length;
    let appending = false;
    const appendNext = () => {
      if (appending || mounted >= items.length) return;
      appending = true;
      const end = Math.min(items.length, mounted + this.railBatchItems);
      const fragment = document.createDocumentFragment();
      for (let index = mounted; index < end; index += 1) {
        fragment.appendChild(this.createMovieCard(items[index], index));
      }
      row.appendChild(fragment);
      mounted = end;
      appending = false;
    };
    const update = () => {
      frame = 0;
      const rowRect = row.getBoundingClientRect();
      const guide = rowRect.left + Math.min(28, rowRect.width * 0.08);
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      row.querySelectorAll('.movie-card').forEach((card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().left - guide);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      status.textContent = `${String(nearestIndex + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
      if (row.scrollLeft + row.clientWidth >= row.scrollWidth - row.clientWidth) appendNext();
    };
    row.addEventListener('scroll', () => {
      if (!frame) frame = requestAnimationFrame(update);
    }, { passive: true });
    update();
  },

  createMovieCard(movie, railIndex = null) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.dataset.movieSlug = movie.slug || '';
    card.onclick = () => this.openMovieDetail(movie.slug);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Mở phim ${movie.name || 'Đang cập nhật'}`);
    card.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.openMovieDetail(movie.slug);
      }
    };

    const accentPalette = ['#ff3d5e', '#ffb21c', '#8b7cff', '#25d8b4', '#58a6ff'];
    const identity = String(movie.slug || movie.name || 'phim');
    const accentIndex = [...identity].reduce((sum, character) => sum + character.charCodeAt(0), 0) % accentPalette.length;
    card.style.setProperty('--card-accent', accentPalette[accentIndex]);
    if (railIndex !== null) card.dataset.railIndex = String(railIndex);

    const posterUrl = this.resolveImageUrl(movie.poster_url || movie.thumb_url);
    const alternatePosterUrl = this.resolveImageUrl(movie.thumb_url || movie.poster_url);
    const epCurrent = movie.episode_current || movie.episode_total || '';
    const genre = this.getMovieTags(movie, 'category')[0] || '';
    const country = this.getMovieTags(movie, 'country')[0] || '';

    card.innerHTML = `
      <div class="card-poster-wrapper">
        <img class="card-poster" src="${this.escapeHtml(posterUrl)}" alt="${this.escapeHtml(movie.name || 'Poster phim')}" loading="${railIndex !== null && railIndex < 2 ? 'eager' : 'lazy'}" fetchpriority="${railIndex !== null && railIndex < 2 ? 'high' : 'auto'}" decoding="async" width="300" height="450" />
        ${railIndex !== null ? `<span class="card-rail-number" aria-hidden="true">${String(railIndex + 1).padStart(2, '0')}</span>` : ''}
        <span class="card-badge-quality">${this.escapeHtml(movie.quality || 'Theo nguồn')}</span>
        ${epCurrent ? `<span class="card-badge-ep">${this.escapeHtml(epCurrent)}</span>` : ''}
        <span class="card-quick-play" aria-hidden="true"><b>▶</b><small>MỞ PHIM</small></span>
      </div>
      <div class="card-info">
        <h4 class="card-title" title="${this.escapeHtml(movie.name || '')}">${this.escapeHtml(movie.name || 'Đang cập nhật')}</h4>
        <div class="card-meta">
          <span>${this.escapeHtml(movie.year || '2026')}</span>
          <span>${this.escapeHtml(movie.lang || 'Vietsub')}</span>
        </div>
        ${(genre || country) ? `<div class="card-catalog-tags">${genre ? `<span>${this.escapeHtml(genre)}</span>` : ''}${country ? `<span>${this.escapeHtml(country)}</span>` : ''}</div>` : ''}
      </div>
    `;

    this.attachPosterFallback(card.querySelector('.card-poster'), [alternatePosterUrl]);

    return card;
  },

  resolveImageUrl(path) {
    return this.resolveDirectImageUrl(path);
  },

  resolveDirectImageUrl(path) {
    const value = String(path || '').trim();
    if (!value) return this.posterFallbackUrl();
    if (value === this.posterFallbackUrl() || value.startsWith('/media/')) return value;
    try {
      const url = new URL(value, window.location?.href || 'https://local.invalid');
      const apiOrigin = new URL(window.Phim4KRuntime?.apiBaseUrl || window.location?.origin || url.origin).origin;
      const ticket = url.pathname === '/api/media/image' && /^[A-Za-z0-9_-]{24,}$/.test(url.searchParams.get('t') || '');
      if (ticket && url.origin === apiOrigin) return url.href;
    } catch (_error) {}
    return this.posterFallbackUrl();
  },

  posterFallbackUrl() {
    return '/media/poster-fallback.svg';
  },

  attachPosterFallback(image, alternatives = []) {
    if (!image) return;
    const fallback = this.posterFallbackUrl();
    const sources = [image.getAttribute('src'), ...alternatives]
      .map((source) => String(source || '').trim())
      .filter((source, index, list) => source && source !== fallback && list.indexOf(source) === index);
    let sourceIndex = 0;
    let retry = 0;
    let finished = false;
    const retryUrl = (source) => {
      try {
        const url = new URL(source, window.location.href);
        url.searchParams.set('_poster_retry', `${Date.now()}-${retry}`);
        return url.href;
      } catch (_error) { return source; }
    };
    const loadNext = () => {
      if (finished) return;
      if (sourceIndex >= sources.length) {
        finished = true;
        const brokenCard = image.closest?.('.movie-card, .schedule-card, .search-item, .coverflow-item');
        if (brokenCard) {
          brokenCard.remove();
          return;
        }
        image.dataset.posterFallback = '1';
        image.src = fallback;
        return;
      }
      image.src = retryUrl(sources[sourceIndex]);
    };
    const onError = () => {
      if (finished || image.dataset.posterFallback === '1') return;
      if (retry < 2) {
        retry += 1;
        window.setTimeout(loadNext, retry * 700);
        return;
      }
      sourceIndex += 1;
      retry = 0;
      window.setTimeout(loadNext, 250);
    };
    image.addEventListener('error', onError);
    if (image.complete && image.naturalWidth === 0) window.queueMicrotask(onError);
  },

  setBackgroundImage(element, source) {
    if (!element) return;
    const primary = this.resolveImageUrl(source);
    const preload = new Image();
    preload.onload = () => { element.style.backgroundImage = `url("${primary}")`; };
    preload.onerror = () => { element.style.backgroundImage = `url("${this.posterFallbackUrl()}")`; };
    preload.src = primary;
  },

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  },

  // =================================================
  // 2. CATEGORY VIEWS & PAGINATION
  // =================================================
  async switchCategory(category, page = 1) {
    if (category === 'home') {
      this.loadHomeFeed();
      return;
    }

    this.currentCategory = category;
    this.currentPage = page;
    this.updateActiveNav(category);

    document.getElementById('heroBillboard')?.classList.add('hidden');
    document.getElementById('coverflowSection')?.classList.add('hidden');
    document.getElementById('featuredSnapSection')?.classList.add('hidden');
    document.getElementById('continueWatchingSection')?.classList.add('hidden');
    document.getElementById('moodDiscovery')?.classList.add('hidden');
    document.getElementById('catalogFilterPanel')?.classList.add('hidden');
    document.getElementById('dynamicSections')?.classList.add('hidden');
    const catView = document.getElementById('categoryView');
    catView.classList.remove('hidden');

    const grid = document.getElementById('categoryGrid');
    const paginationBox = document.getElementById('paginationBox');
    const titleEl = document.getElementById('categoryTitle');
    const countEl = document.getElementById('categoryCount');

    titleEl.textContent = this.getCategoryDisplayName(category);
    grid.innerHTML = `
      <div class="loading-spinner-wrapper" style="grid-column: 1 / -1;">
        <div class="spinner"></div>
        <p>Đang tải danh sách phim...</p>
      </div>
    `;
    paginationBox.innerHTML = '';

    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const data = await API.getCategory(category, page);
      grid.innerHTML = '';
      const items = data.items || [];
      countEl.textContent = `(Trang ${page} - ${items.length} phim)`;

      if (items.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: var(--text-dim);">Không có phim nào.</p>';
        return;
      }

      const fragment = document.createDocumentFragment();
      items.forEach(movie => fragment.appendChild(this.createMovieCard(movie)));
      grid.appendChild(fragment);
      API.trackUsage('category_view', { category: this.getCategoryDisplayName(category), results: items.length });

      this.renderPagination(paginationBox, category, page, data.pagination?.totalPages || 50);
    } catch (err) {
      grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #f87171;">Lỗi tải dữ liệu phim thể loại này.</p>';
    }
  },

  getCategoryDisplayName(cat) {
    switch (cat) {
      case 'phim-moi-cap-nhat': return '🔥 Phim Mới Cập Nhật';
      case 'phim-le': return '🎬 Phim Lẻ Đỉnh Cao';
      case 'phim-bo': return '📺 Phim Bộ Chọn Lọc';
      case 'hoat-hinh': return '✨ Hoạt Hình & Anime';
      case 'tv-shows': return '🎤 TV Shows Hấp Dẫn';
      default: return 'Danh Mục Phim';
    }
  },

  updateActiveNav(cat) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === cat);
    });
  },

  renderPagination(container, category, currentPage, totalPages) {
    container.innerHTML = '';
    const maxPages = Math.min(totalPages || 50, 50);

    // Prev button
    if (currentPage > 1) {
      const prev = document.createElement('button');
      prev.className = 'page-btn';
      prev.textContent = '« Trang Trước';
      prev.onclick = () => this.switchCategory(category, currentPage - 1);
      container.appendChild(prev);
    }

    // Page indicator
    const info = document.createElement('span');
    info.style.color = '#fff';
    info.style.fontWeight = 'bold';
    info.style.margin = '0 10px';
    info.textContent = `Trang ${currentPage} / ${maxPages}`;
    container.appendChild(info);

    // Next button
    if (currentPage < maxPages) {
      const next = document.createElement('button');
      next.className = 'page-btn';
      next.textContent = 'Trang Kế »';
      next.onclick = () => this.switchCategory(category, currentPage + 1);
      container.appendChild(next);
    }
  },

  // =================================================
  // 3. INSTANT & FULL SEARCH
  // =================================================
  async performInstantSearch(query) {
    const dropdown = document.getElementById('searchDropdown');
    const requestId = ++this.searchRequestId;
    const normalized = this.normalizeFilterValue(query);
    const localItems = this.homeCatalog.filter((movie) => this.normalizeFilterValue([
      movie?.name, movie?.origin_name, movie?.year
    ].filter(Boolean).join(' ')).includes(normalized)).slice(0, 6);
    if (localItems.length) this.renderInstantSearch(localItems);
    try {
      const data = await API.search(query, 1);
      if (requestId !== this.searchRequestId) return;
      const items = (data.items || []).slice(0, 6);
      if (items.length === 0) {
        dropdown.innerHTML = '<div style="padding: 14px; text-align: center; color: var(--text-dim); font-size: 13px;">Không tìm thấy phim phù hợp</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      this.renderInstantSearch(items);
    } catch (err) {
      if (!localItems.length && requestId === this.searchRequestId) dropdown.classList.add('hidden');
    }
  },

  renderInstantSearch(items = []) {
      const dropdown = document.getElementById('searchDropdown');
      dropdown.innerHTML = '';
      items.forEach(movie => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.onclick = () => {
          this.hideSearchDropdown();
          this.openMovieDetail(movie.slug);
        };

        const posterUrl = this.resolveImageUrl(movie.poster_url || movie.thumb_url);
        const alternatePosterUrl = this.resolveImageUrl(movie.thumb_url || movie.poster_url);
        item.innerHTML = `
          <img class="search-thumb" src="${this.escapeHtml(posterUrl)}" alt="${this.escapeHtml(movie.name || 'Poster phim')}" loading="lazy" decoding="async" width="56" height="82" />
          <div class="search-info">
            <div class="search-title">${this.escapeHtml(movie.name || 'Đang cập nhật')}</div>
            <div class="search-sub">${this.escapeHtml(movie.origin_name || '')} (${this.escapeHtml(movie.year || '2026')})</div>
          </div>
        `;
        this.attachPosterFallback(item.querySelector('.search-thumb'), [alternatePosterUrl]);
        dropdown.appendChild(item);
      });

      dropdown.classList.remove('hidden');
  },

  hideSearchDropdown() {
    document.getElementById('searchDropdown').classList.add('hidden');
  },

  async loadFullSearch(query, page = 1) {
    document.getElementById('heroBillboard')?.classList.add('hidden');
    document.getElementById('coverflowSection')?.classList.add('hidden');
    document.getElementById('featuredSnapSection')?.classList.add('hidden');
    document.getElementById('continueWatchingSection')?.classList.add('hidden');
    document.getElementById('catalogFilterPanel')?.classList.add('hidden');
    document.getElementById('dynamicSections')?.classList.add('hidden');
    const catView = document.getElementById('categoryView');
    catView.classList.remove('hidden');

    const grid = document.getElementById('categoryGrid');
    const titleEl = document.getElementById('categoryTitle');
    const countEl = document.getElementById('categoryCount');
    const paginationBox = document.getElementById('paginationBox');

    titleEl.textContent = `🔍 Kết quả tìm kiếm: "${query}"`;
    grid.innerHTML = '<div class="loading-spinner-wrapper" style="grid-column: 1 / -1;"><div class="spinner"></div><p>Đang tìm kiếm...</p></div>';
    paginationBox.innerHTML = '';

    try {
      const data = await API.search(query, page);
      const items = data.items || [];
      API.trackUsage('search', { query, results: items.length });
      countEl.textContent = `(${items.length} phim)`;
      grid.innerHTML = '';

      if (items.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px 0;">Không tìm thấy phim nào khớp với từ khóa.</p>';
        return;
      }

      items.forEach(m => grid.appendChild(this.createMovieCard(m)));
    } catch (err) {
      grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #f87171;">Lỗi tìm kiếm.</p>';
    }
  },

  // =================================================
  // 4. MOVIE DETAIL MODAL & EPISODES
  // =================================================
  async openMovieDetail(slug) {
    this.lastDetailSlug = slug;
    const requestId = ++this.detailRequestId;
    const modal = document.getElementById('movieModal');
    modal.classList.remove('hidden');
    const detailBody = modal.querySelector('.detail-body');
    if (detailBody) detailBody.scrollTop = 0;

    window.Phim4KTrailer?.stop();
    document.getElementById('detailTrailer')?.classList.add('hidden');
    // Reset fields while loading
    document.getElementById('detailName').textContent = 'Đang tải thông tin phim...';
    document.getElementById('detailOriginName').textContent = '';
    document.getElementById('detailContent').textContent = 'Vui lòng chờ trong giây lát...';
    document.getElementById('detailContent').classList.remove('expanded');
    document.getElementById('detailSynopsisToggle').classList.add('hidden');
    document.getElementById('detailBadges').innerHTML = '';
    document.getElementById('detailMetaGrid').innerHTML = '';
    document.getElementById('serverTabs').innerHTML = '';
    document.getElementById('episodesList').innerHTML = '<div class="spinner"></div>';

    try {
      let data;
      try {
        data = await API.getDetail(slug);
      } catch (_firstError) {
        // Bypass both browser and Worker edge caches once. This fixes the
        // transient catalogue/detail race without making the user press retry.
        data = await API.getDetail(slug, { refresh: true });
      }
      if (requestId !== this.detailRequestId) return;
      if (!data?.movie || !Array.isArray(data?.episodes) || !data.episodes.some((server) => Array.isArray(server?.server_data) && server.server_data.length)) {
        const error = new Error('ENSMOVIE_STREAM_UNAVAILABLE');
        error.code = 'ENSMOVIE_STREAM_UNAVAILABLE';
        throw error;
      }
      this.activeMovieDetail = data;
      this.activeServerIndex = 0;
      this.renderDetailModalContent(data);
      API.trackUsage('movie_open', { movie: data.movie?.name || slug });
    } catch (err) {
      if (requestId !== this.detailRequestId) return;
      document.querySelectorAll(`[data-movie-slug="${slug}"]`).forEach((card) => card.remove());
      document.getElementById('detailName').textContent = 'Không thể tải chi tiết phim';
      document.getElementById('detailContent').textContent = 'Phim này chưa có luồng ENSMovie hoạt động và đã được gỡ khỏi danh sách hiện tại.';
      document.getElementById('serverTabs').innerHTML = '';
      document.getElementById('episodesList').innerHTML = '<button type="button" class="ep-btn" onclick="App.openMovieDetail(App.lastDetailSlug)">Thử tải lại</button>';
    }
  },

  renderDetailModalContent(data) {
    const movie = data.movie;
    const episodes = data.episodes || [];

    document.getElementById('detailName').textContent = movie.name;
    document.getElementById('detailOriginName').textContent = movie.origin_name || '';
    
    // Poster and Backdrop
    const posterUrl = this.resolveImageUrl(movie.poster_url || movie.thumb_url);
    const thumbUrl = this.resolveImageUrl(movie.thumb_url || movie.poster_url);
    const detailPoster = document.getElementById('detailPoster');
    detailPoster.src = posterUrl;
    this.attachPosterFallback(detailPoster, [thumbUrl]);
    this.setBackgroundImage(document.getElementById('detailBackdrop'), thumbUrl);
    // Details are image-only; never mount a trailer or embedded video.

    // Badges
    const badgesBox = document.getElementById('detailBadges');
    badgesBox.innerHTML = `
      <span class="detail-badge badge-red">${this.escapeHtml(movie.quality || 'Theo nguồn')}</span>
      <span class="detail-badge">${this.escapeHtml(movie.year || '2026')}</span>
      <span class="detail-badge">${this.escapeHtml(movie.time || 'Đang cập nhật')}</span>
      <span class="detail-badge">${this.escapeHtml(movie.episode_current || movie.episode_total || 'Trọn bộ')}</span>
      <span class="detail-badge">${this.escapeHtml(movie.lang || 'Vietsub')}</span>
    `;

    // Synopsis
    const cleanContent = movie.content ? movie.content.replace(/<[^>]*>?/gm, '') : 'Không có mô tả chi tiết.';
    const synopsis = document.getElementById('detailContent');
    const synopsisToggle = document.getElementById('detailSynopsisToggle');
    synopsis.textContent = cleanContent;
    synopsis.classList.remove('expanded');
    synopsisToggle.textContent = 'Xem thêm';
    synopsisToggle.classList.toggle('hidden', cleanContent.length < 220);

    // Meta grid
    const metaGrid = document.getElementById('detailMetaGrid');
    const categories = (movie.category || []).map(c => c.name).join(', ') || 'Đang cập nhật';
    const countries = (movie.country || []).map(c => c.name).join(', ') || 'Đang cập nhật';
    const actors = (movie.actor || []).slice(0, 5).join(', ') || 'Đang cập nhật';
    const directors = (movie.director || []).join(', ') || 'Đang cập nhật';

    metaGrid.innerHTML = `
      <div><strong>Thể loại:</strong> ${this.escapeHtml(categories)}</div>
      <div><strong>Quốc gia:</strong> ${this.escapeHtml(countries)}</div>
      <div><strong>Đạo diễn:</strong> ${this.escapeHtml(directors)}</div>
      <div><strong>Diễn viên:</strong> ${this.escapeHtml(actors)}</div>
    `;

    window.AccountExperience?.updateDetailButtons?.(movie.slug);

    // Render Server Tabs
    this.renderServerTabs(episodes);
  },

  toggleDetailSynopsis() {
    const synopsis = document.getElementById('detailContent');
    const toggle = document.getElementById('detailSynopsisToggle');
    if (!synopsis || !toggle) return;
    const expanded = synopsis.classList.toggle('expanded');
    toggle.textContent = expanded ? 'Thu gọn' : 'Xem thêm';
  },

  renderServerTabs(episodes = []) {
    const tabsContainer = document.getElementById('serverTabs');
    tabsContainer.innerHTML = '';

    if (episodes.length === 0) {
      document.getElementById('episodesList').innerHTML = '<p style="color: var(--text-dim);">Chưa có tập phim nào.</p>';
      return;
    }

    episodes.forEach((server, idx) => {
      const btn = document.createElement('button');
      btn.className = `server-tab ${idx === this.activeServerIndex ? 'active' : ''}`;
      btn.textContent = window.formatMovieServerName?.(server, idx, this.activeMovieDetail?.movie) || server.server_name || `Server #${idx + 1}`;
      btn.onclick = () => {
        this.activeServerIndex = idx;
        this.renderServerTabs(episodes);
      };
      tabsContainer.appendChild(btn);
    });

    // Render Episodes for active server
    const currentServer = episodes[this.activeServerIndex] || episodes[0];
    const epList = currentServer.server_data || [];
    const listContainer = document.getElementById('episodesList');
    listContainer.innerHTML = '';

    epList.forEach((ep, epIdx) => {
      const epBtn = document.createElement('button');
      epBtn.className = 'ep-btn';
      epBtn.textContent = ep.name || `Tập ${epIdx + 1}`;
      epBtn.title = ep.filename || ep.name;
      epBtn.onclick = () => {
        Player.open(
          this.activeMovieDetail.movie,
          this.withPlaybackReference(ep, currentServer, this.activeServerIndex, epIdx),
          epList.map((item, index) => this.withPlaybackReference(item, currentServer, this.activeServerIndex, index)),
          epIdx,
          this.activeMovieDetail.episodes.map((server, serverIndex) => ({
            ...server,
            server_data: (server.server_data || []).map((item, index) => this.withPlaybackReference(item, server, serverIndex, index)),
          })),
          this.activeServerIndex
        );
      };
      listContainer.appendChild(epBtn);
    });
  },

  // Preserve provider-native playback metadata on every platform. Reconstruct
  // a protected reference only for metadata-only responses.
  withPlaybackReference(episode, server, serverIndex, episodeIndex) {
    // Keep the provider's native URLs for mobile/TV, while also attaching the
    // protected EnsMovie reference required by web/Windows. This prevents a
    // public detail response from silently sending desktop back to the legacy
    // raw player path.
    if (episode?.stream_ref) return episode;
    const movie = this.activeMovieDetail?.movie || {};
    return {
      ...episode,
      stream_ref: {
        movie: movie.slug,
        server: serverIndex,
        episode: episodeIndex,
        source: server?.source_id || server?._source_id || '',
        sourceMovieSlug: server?._source_movie_slug || movie.slug,
        serverName: server?._source_server_name || server?.server_name || '',
        episodeSlug: episode?.slug || '',
        episodeName: episode?.name || '',
        episodeFilename: episode?.filename || '',
      },
    };
  },

  playCurrentFirstEpisode() {
    if (!this.activeMovieDetail) return;
    const episodes = this.activeMovieDetail.episodes || [];
    if (episodes.length > 0 && episodes[0].server_data?.length > 0) {
      const currentServer = episodes[this.activeServerIndex] || episodes[0];
      const epList = currentServer.server_data.map((episode, index) =>
        this.withPlaybackReference(episode, currentServer, this.activeServerIndex, index));
      const allServers = this.activeMovieDetail.episodes.map((server, serverIndex) => ({
        ...server,
        server_data: (server.server_data || []).map((episode, index) =>
          this.withPlaybackReference(episode, server, serverIndex, index)),
      }));
      Player.open(this.activeMovieDetail.movie, epList[0], epList, 0, allServers, this.activeServerIndex);
    }
  },

  onTabSearchInput(e) {
    const val = e.target.value.trim();
    clearTimeout(this.tabSearchTimer);
    const container = document.getElementById('tabSearchResults');
    if (!val) {
      if (container) container.innerHTML = '';
      return;
    }
    this.tabSearchTimer = setTimeout(async () => {
      try {
        if (container) {
          container.innerHTML = '<div class="loading-spinner-wrapper"><div class="spinner"></div><p>Đang tìm kiếm...</p></div>';
        }
        const data = await API.search(val, 1);
        if (container) {
          container.innerHTML = '';
          const items = data.items || [];
          if (items.length === 0) {
            container.innerHTML = '<p style="color: #9ca3af; text-align: center; grid-column: 1/-1; padding: 40px;">Không tìm thấy phim phù hợp.</p>';
            return;
          }
          const fragment = document.createDocumentFragment();
          items.forEach(m => fragment.appendChild(this.createMovieCard(m)));
          container.appendChild(fragment);
          API.trackUsage('search', { query: val, results: items.length });
        }
      } catch (err) {}
    }, 350);
  },

  quickSearch(keyword) {
    const input = document.getElementById('tabSearchInput');
    if (input) {
      input.value = keyword;
      this.onTabSearchInput({ target: input });
    }
  }
};

// Global Helpers for HTML inline calls
function switchCategory(cat) { App.switchCategory(cat); }
function clearSearch() {
  const input = document.getElementById('searchInput');
  input.value = '';
  document.getElementById('searchClear').classList.add('hidden');
  App.hideSearchDropdown();
}

function playHeroMovie() {
  if (App.currentHeroMovie) {
    App.openMovieDetail(App.currentHeroMovie.slug);
  }
}

function infoHeroMovie() {
  if (App.currentHeroMovie) {
    App.openMovieDetail(App.currentHeroMovie.slug);
  }
}

function hideMovieModal() {
  window.Phim4KTrailer?.stop();
  App.detailRequestId++;
  document.getElementById('movieModal').classList.add('hidden');
  App.syncPageScrollLock();
}

function closeMovieModal(e) {
  if (e.target.id === 'movieModal') {
    hideMovieModal();
  }
}

function playCurrentFirstEpisode() {
  App.playCurrentFirstEpisode();
}

// Attach App to window
window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
