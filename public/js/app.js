// Main Application Logic (Home, Categories, Search, Detail Modal)

const App = {
  currentCategory: 'home',
  currentPage: 1,
  currentHeroMovie: null,
  heroList: [],
  heroRotateTimer: null,
  feedRefreshTimer: null,
  homeFeedLoading: false,
  homeFeedUpdatedAt: null,
  homeCatalog: [],
  homeSections: [],
  activeHomeFilters: { genre: '', country: '' },
  activeMovieDetail: null,
  activeServerIndex: 0,
  searchDebounceTimer: null,

  init() {
    this.bindEvents();
    this.syncPageScrollLock();
    this.startHomeFeedRefresh();
  },

  bindEvents() {
    // Navbar scroll effect
    window.addEventListener('scroll', () => {
      const navbar = document.getElementById('navbar');
      if (window.scrollY > 30) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    });

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
      }
    });
  },

  syncPageScrollLock() {
    const gateOpen = !document.getElementById('activationGate')?.classList.contains('hidden');
    // Modal/player overlays are fixed and manage their own scroll. Do not
    // lock the document for them: iOS WebView may retain that lock after an
    // overlay closes, making the home feed look frozen.
    document.body.classList.toggle('activation-locked', Boolean(gateOpen));
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
    document.getElementById('continueWatchingSection')?.classList.remove('hidden');
    document.getElementById('catalogFilterPanel')?.classList.remove('hidden');
    document.getElementById('dynamicSections')?.classList.remove('hidden');
    document.getElementById('categoryView')?.classList.add('hidden');

    const container = document.getElementById('dynamicSections');
    // Native WebViews can take longer than Safari to establish their first
    // connection. Render the bundled catalogue now, then refresh it in place
    // when the live Worker response arrives.
    let renderedBundledCatalog = false;
    if (!silent && window.Phim4KRuntime?.apiBaseUrl) {
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
      if (renderedBundledCatalog) {
        const artworkReady = await this.preloadHomeArtwork(data);
        if (!artworkReady) return;
      }
      this.applyHomeFeed(data);
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

  preloadHomeArtwork(data, timeoutMs = 5000) {
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
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const hasMovies = sections.some((section) => Array.isArray(section?.items) && section.items.length > 0);
    if (!hasMovies) throw new Error('MOVIE_CATALOG_EMPTY');
    this.homeFeedUpdatedAt = data.updatedAt || new Date().toISOString();
    this.heroList = data.hero || [];
    const rawCatalog = this.uniqueMovies([
      ...this.heroList,
      ...sections.flatMap((section) => Array.isArray(section?.items) ? section.items : [])
    ]);
    this.homeCatalog = this.enrichCatalogFilters(rawCatalog);
    this.homeSections = this.buildHomeSections(sections);
    if (this.heroList.length > 0) {
      if (window.Coverflow) {
        Coverflow.init(this.heroList);
      }
      this.renderHeroBillboard(this.heroList[0]);
      this.startHeroRotation();
    }

    if (window.ContinueWatching) {
      ContinueWatching.render();
    }

    this.renderHomeCatalog();
    this.renderSchedule();
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
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'schedule-card';
      card.setAttribute('aria-label', `Mở phim ${movie.name || movie.origin_name || ''}`);
      card.innerHTML = `
        <img class="schedule-poster" src="${this.escapeHtml(this.resolveImageUrl(movie.poster_url || movie.thumb_url))}" alt="" loading="lazy" decoding="async" />
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
      this.attachPosterFallback(card.querySelector('.schedule-poster'));
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
    const bySlug = new Map(fallback.map((movie) => [movie.slug, movie]));
    const enriched = (items || []).map((movie) => {
      const known = bySlug.get(movie.slug);
      if (!known) return movie;
      return {
        ...known,
        ...movie,
        category: this.getMovieTags(movie, 'category').length ? movie.category : known.category,
        country: this.getMovieTags(movie, 'country').length ? movie.country : known.country,
      };
    });
    return this.uniqueMovies([...enriched, ...fallback]);
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
    const catalog = this.homeCatalog;
    const latest = this.uniqueMovies(sourceSections.find((section) => section?.id === 'latest')?.items || catalog).slice(0, 18);
    const groups = [
      { id: 'latest', title: 'Phim mới cập nhật', items: latest },
      { id: 'genre-action', title: 'Phim hành động', items: this.filterMoviesByTag('category', 'Hành Động') },
      { id: 'genre-animation', title: 'Hoạt hình và Anime', items: this.filterMoviesByTag('category', 'Hoạt Hình') },
      { id: 'country-china', title: 'Phim Trung Quốc', items: this.filterMoviesByTag('country', 'Trung Quốc') },
      { id: 'country-korea', title: 'Phim Hàn Quốc', items: this.filterMoviesByTag('country', 'Hàn Quốc') },
      { id: 'country-japan', title: 'Phim Nhật Bản', items: this.filterMoviesByTag('country', 'Nhật Bản') },
      { id: 'country-western', title: 'Phim Âu Mỹ', items: this.filterMoviesByTag('country', 'Âu Mỹ') },
    ];
    return groups.filter((section) => section.items.length > 0);
  },

  filterMoviesByTag(field, value) {
    const expected = this.normalizeFilterValue(value);
    return this.homeCatalog.filter((movie) => this.getMovieTags(movie, field).some((tag) => this.normalizeFilterValue(tag) === expected));
  },

  renderHomeCatalog() {
    const container = document.getElementById('dynamicSections');
    if (!container) return;
    const hasFilter = Boolean(this.activeHomeFilters.genre || this.activeHomeFilters.country);
    const filteredMovies = this.moviesMatching();
    const sections = hasFilter
      ? [{ id: 'filtered', title: this.getFilterTitle(), items: filteredMovies }]
      : this.homeSections;

    container.innerHTML = '';
    if (!sections.length || (hasFilter && !filteredMovies.length)) {
      const empty = document.createElement('div');
      empty.className = 'catalog-empty-state';
      empty.textContent = 'Chưa có phim phù hợp trong mục này. Hãy chọn bộ lọc khác hoặc bấm Bỏ lọc.';
      container.appendChild(empty);
    } else {
      sections.forEach((section) => container.appendChild(this.createSectionElement(section)));
    }
    this.renderCatalogControls();
  },

  getFilterTitle() {
    const labels = [this.activeHomeFilters.genre, this.activeHomeFilters.country].filter(Boolean);
    return `Kết quả lọc: ${labels.join(' · ')}`;
  },

  collectFilterTags(field, preferred) {
    const available = this.homeCatalog.flatMap((movie) => this.getMovieTags(movie, field));
    const deduped = Array.from(new Map(available.map((value) => [this.normalizeFilterValue(value), value])).values());
    const ordered = preferred.filter((value) => deduped.some((tag) => this.normalizeFilterValue(tag) === this.normalizeFilterValue(value)));
    return [...ordered, ...deduped.filter((tag) => !ordered.some((value) => this.normalizeFilterValue(tag) === this.normalizeFilterValue(value)))].slice(0, 10);
  },

  renderCatalogControls() {
    const genreBox = document.getElementById('genreFilterChips');
    const countryBox = document.getElementById('countryFilterChips');
    const summary = document.getElementById('catalogFilterSummary');
    const reset = document.getElementById('resetCatalogFilter');
    if (!genreBox || !countryBox || !summary || !reset) return;

    const genres = this.collectFilterTags('category', ['Hành Động', 'Hoạt Hình', 'Tình Cảm', 'Khoa Học Viễn Tưởng', 'Cổ Trang', 'Kinh Dị']);
    const countries = this.collectFilterTags('country', ['Việt Nam', 'Trung Quốc', 'Hàn Quốc', 'Nhật Bản', 'Âu Mỹ', 'Thái Lan']);
    this.renderFilterButtons(genreBox, genres, 'genre');
    this.renderFilterButtons(countryBox, countries, 'country');
    const hasFilter = Boolean(this.activeHomeFilters.genre || this.activeHomeFilters.country);
    reset.classList.toggle('hidden', !hasFilter);
    summary.textContent = hasFilter
      ? `${this.moviesMatching().length} phim phù hợp với ${[this.activeHomeFilters.genre, this.activeHomeFilters.country].filter(Boolean).join(' · ')}.`
      : `${this.homeCatalog.length} phim hiện có. Chọn một hoặc hai điều kiện để lọc.`;
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

  setHomeFilter(kind, value) {
    if (!['genre', 'country'].includes(kind)) return;
    this.activeHomeFilters[kind] = this.normalizeFilterValue(this.activeHomeFilters[kind]) === this.normalizeFilterValue(value) ? '' : value;
    this.renderHomeCatalog();
    document.getElementById('dynamicSections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  clearHomeFilters() {
    this.activeHomeFilters = { genre: '', country: '' };
    this.renderHomeCatalog();
  },

  startHomeFeedRefresh() {
    clearInterval(this.feedRefreshTimer);
    this.feedRefreshTimer = setInterval(() => {
      if (!document.hidden && this.currentCategory === 'home') {
        this.loadHomeFeed({ silent: true });
      }
    }, 120000);
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

    // KKPhim poster / thumb URL resolver
    this.setBackgroundImage(backdropEl, movie.thumb_url || movie.poster_url);

    titleEl.textContent = movie.name;
    subEl.textContent = movie.origin_name || '';
    yearEl.textContent = movie.year || '2026';
    qualityEl.textContent = movie.quality || '4K Ultra HD';
    descEl.textContent = movie.content ? movie.content.replace(/<[^>]*>?/gm, '') : 'Trải nghiệm điện ảnh đỉnh cao với chất lượng hình ảnh 4K sắc nét và âm thanh sống động.';
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

  createSectionElement(section) {
    const sec = document.createElement('section');
    sec.className = 'movie-section';

    sec.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${this.escapeHtml(section.title)}</h2>
        ${section.id === 'latest' && this.homeFeedUpdatedAt ? `<span class="section-update-status">Cập nhật ${new Date(this.homeFeedUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}
      </div>
      <div class="movie-row"></div>
    `;

    const row = sec.querySelector('.movie-row');
    (section.items || []).forEach(movie => {
      const card = this.createMovieCard(movie);
      row.appendChild(card);
    });

    return sec;
  },

  createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.onclick = () => this.openMovieDetail(movie.slug);

    const posterUrl = this.resolveImageUrl(movie.poster_url || movie.thumb_url);
    const epCurrent = movie.episode_current || movie.episode_total || '';
    const genre = this.getMovieTags(movie, 'category')[0] || '';
    const country = this.getMovieTags(movie, 'country')[0] || '';

    card.innerHTML = `
      <div class="card-poster-wrapper">
        <img class="card-poster" src="${posterUrl}" alt="${this.escapeHtml(movie.name || 'Poster phim')}" loading="lazy" decoding="async" width="300" height="450" />
        <span class="card-badge-quality">${this.escapeHtml(movie.quality || 'FHD')}</span>
        ${epCurrent ? `<span class="card-badge-ep">${this.escapeHtml(epCurrent)}</span>` : ''}
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

    this.attachPosterFallback(card.querySelector('.card-poster'));

    return card;
  },

  resolveImageUrl(path) {
    const directUrl = this.resolveDirectImageUrl(path);
    const relayOrigin = window.Phim4KRuntime?.apiBaseUrl || '';
    try {
      const parsed = new URL(directUrl);
      if (relayOrigin && parsed.protocol === 'https:' && parsed.hostname === 'phimimg.com') {
        return `${relayOrigin}/api/media/image?url=${encodeURIComponent(parsed.href)}`;
      }
    } catch (_error) {}
    return directUrl;
  },

  resolveDirectImageUrl(path) {
    const value = String(path || '').trim();
    if (!value) return this.posterFallbackUrl();
    if (value.startsWith('/media/')) return value;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('https://')) return value;
    if (value.startsWith('http://')) return `https://${value.slice(7)}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return this.posterFallbackUrl();
    return `https://phimimg.com/${value.replace(/^\/+/, '')}`;
  },

  posterFallbackUrl() {
    return '/media/poster-fallback.svg';
  },

  attachPosterFallback(image) {
    if (!image) return;
    image.addEventListener('error', () => {
      if (image.dataset.posterDirectTried !== '1') {
        try {
          const failedUrl = new URL(image.src);
          const directUrl = failedUrl.pathname === '/api/media/image' ? failedUrl.searchParams.get('url') : '';
          if (directUrl?.startsWith('https://')) {
            image.dataset.posterDirectTried = '1';
            image.src = directUrl;
            return;
          }
        } catch (_error) {}
      }
      if (image.dataset.posterFallback === '1') return;
      image.dataset.posterFallback = '1';
      image.src = this.posterFallbackUrl();
    });
  },

  setBackgroundImage(element, source) {
    if (!element) return;
    const primary = this.resolveImageUrl(source);
    const direct = this.resolveDirectImageUrl(source);
    const preload = new Image();
    preload.onload = () => { element.style.backgroundImage = `url("${primary}")`; };
    preload.onerror = () => {
      if (direct !== primary) {
        const retry = new Image();
        retry.onload = () => { element.style.backgroundImage = `url("${direct}")`; };
        retry.onerror = () => { element.style.backgroundImage = `url("${this.posterFallbackUrl()}")`; };
        retry.src = direct;
        return;
      }
      element.style.backgroundImage = `url("${this.posterFallbackUrl()}")`;
    };
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
    document.getElementById('continueWatchingSection')?.classList.add('hidden');
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

      items.forEach(movie => {
        grid.appendChild(this.createMovieCard(movie));
      });

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
    try {
      const data = await API.search(query, 1);
      const items = (data.items || []).slice(0, 6);
      if (items.length === 0) {
        dropdown.innerHTML = '<div style="padding: 14px; text-align: center; color: var(--text-dim); font-size: 13px;">Không tìm thấy phim phù hợp</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = '';
      items.forEach(movie => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.onclick = () => {
          this.hideSearchDropdown();
          this.openMovieDetail(movie.slug);
        };

        const posterUrl = this.resolveImageUrl(movie.poster_url || movie.thumb_url);
        item.innerHTML = `
          <img class="search-thumb" src="${posterUrl}" alt="${this.escapeHtml(movie.name || 'Poster phim')}" />
          <div class="search-info">
            <div class="search-title">${this.escapeHtml(movie.name || 'Đang cập nhật')}</div>
            <div class="search-sub">${this.escapeHtml(movie.origin_name || '')} (${this.escapeHtml(movie.year || '2026')})</div>
          </div>
        `;
        this.attachPosterFallback(item.querySelector('.search-thumb'));
        dropdown.appendChild(item);
      });

      dropdown.classList.remove('hidden');
    } catch (err) {
      dropdown.classList.add('hidden');
    }
  },

  hideSearchDropdown() {
    document.getElementById('searchDropdown').classList.add('hidden');
  },

  async loadFullSearch(query, page = 1) {
    document.getElementById('heroBillboard')?.classList.add('hidden');
    document.getElementById('coverflowSection')?.classList.add('hidden');
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
    const modal = document.getElementById('movieModal');
    modal.classList.remove('hidden');
    const detailBody = modal.querySelector('.detail-body');
    if (detailBody) detailBody.scrollTop = 0;

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
      const data = await API.getDetail(slug);
      this.activeMovieDetail = data;
      this.activeServerIndex = 0;
      this.renderDetailModalContent(data);
    } catch (err) {
      document.getElementById('detailName').textContent = 'Không thể tải chi tiết phim';
      document.getElementById('detailContent').textContent = 'Đã có lỗi xảy ra hoặc phim này không tồn tại trên hệ thống.';
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
    this.attachPosterFallback(detailPoster);
    this.setBackgroundImage(document.getElementById('detailBackdrop'), thumbUrl);

    // Badges
    const badgesBox = document.getElementById('detailBadges');
    badgesBox.innerHTML = `
      <span class="detail-badge badge-red">${movie.quality || 'FHD'}</span>
      <span class="detail-badge">${movie.year || '2026'}</span>
      <span class="detail-badge">${movie.time || 'Đang cập nhật'}</span>
      <span class="detail-badge">${movie.episode_current || movie.episode_total || 'Trọn bộ'}</span>
      <span class="detail-badge">${movie.lang || 'Vietsub'}</span>
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
      <div><strong>Thể loại:</strong> ${categories}</div>
      <div><strong>Quốc gia:</strong> ${countries}</div>
      <div><strong>Đạo diễn:</strong> ${directors}</div>
      <div><strong>Diễn viên:</strong> ${actors}</div>
    `;

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
      btn.textContent = server.server_name || `Server #${idx + 1}`;
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
        Player.open(this.activeMovieDetail.movie, ep, epList, epIdx, this.activeMovieDetail.episodes, this.activeServerIndex);
      };
      listContainer.appendChild(epBtn);
    });
  },

  playCurrentFirstEpisode() {
    if (!this.activeMovieDetail) return;
    const episodes = this.activeMovieDetail.episodes || [];
    if (episodes.length > 0 && episodes[0].server_data?.length > 0) {
      const currentServer = episodes[this.activeServerIndex] || episodes[0];
      const epList = currentServer.server_data;
      Player.open(this.activeMovieDetail.movie, epList[0], epList, 0, this.activeMovieDetail.episodes, this.activeServerIndex);
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
          items.forEach(m => {
            container.appendChild(this.createMovieCard(m));
          });
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
