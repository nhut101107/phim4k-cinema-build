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
      img.src = App.resolveImageUrl(item.movie.poster_url || item.movie.thumb_url || '');
      img.alt = item.movie.name || 'Poster';
      img.loading = 'eager';
      App.attachPosterFallback(img);

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

    if (titleEl) titleEl.textContent = cur.name || 'Người Nhện: Khởi Đầu Mới';
    if (subEl) subEl.textContent = cur.origin_name || 'Spider-Man: Brand New Day';
    if (qualityEl) qualityEl.textContent = cur.quality || 'CAM';
    if (yearEl) yearEl.textContent = cur.year || '2026';
    if (statusEl) statusEl.textContent = cur.episode_current || 'Full';

    if (catEl) {
      const cats = cur.category || ['Phim Hành Động', 'Phim Khoa Học Viễn Tưởng'];
      catEl.textContent = Array.isArray(cats) 
        ? cats.map(c => typeof c === 'object' ? c.name : c).join(', ')
        : cats;
    }

    if (synEl) {
      synEl.textContent = cur.content 
        ? cur.content.replace(/<[^>]*>?/gm, '').trim()
        : 'Không còn Tony Stark, MJ hay Ned kề cận, Peter buộc phải đứng dậy bảo vệ thành phố một lần nữa...';
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
    this.autoTimer = setInterval(() => {
      this.next();
    }, 4500);
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

  getDefaultSeed() {
    return [
      {
        slug: 'cua-hang-sat-thu',
        name: 'Cửa Hàng Sát Thủ',
        epName: 'Tập 01',
        timeText: '04:43 / 50:08',
        progressPercent: 12,
        thumb: 'https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=500'
      },
      {
        slug: 'the-boys-season-2',
        name: 'The Boys (Phần 2)',
        epName: 'Tập 01',
        timeText: '31:51 / 1:00:52',
        progressPercent: 52,
        thumb: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=500'
      },
      {
        slug: 'sieu-anh-hung',
        name: 'Siêu Anh Hùng Ph...',
        epName: 'Tập 08',
        timeText: '01:42 / 1:04:15',
        progressPercent: 6,
        thumb: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500'
      }
    ];
  },

  getItems() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return this.getDefaultSeed();
  },

  saveItem(movie, epName, currentTime, duration) {
    if (!movie || !duration) return;
    let list = this.getItems();
    list = list.filter(item => item.slug !== movie.slug);

    const percent = Math.min(100, Math.round((currentTime / duration) * 100));
    const formatSec = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
    };

    list.unshift({
      slug: movie.slug,
      name: movie.name,
      epName: epName || 'Tập 1',
      timeText: `${formatSec(currentTime)} / ${formatSec(duration)}`,
      progressPercent: percent,
      thumb: movie.thumb_url || movie.poster_url || ''
    });

    if (list.length > 10) list = list.slice(0, 10);
    localStorage.setItem(this.storageKey, JSON.stringify(list));
    this.render();
  },

  clearAll() {
    localStorage.setItem(this.storageKey, JSON.stringify([]));
    this.render();
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

      card.innerHTML = `
        <div class="cw-thumb-wrapper">
          <img src="${App.resolveImageUrl(item.thumb)}" class="cw-thumb" alt="${item.name}" />
          <div class="cw-progress-bar">
            <div class="cw-progress-fill" style="width: ${item.progressPercent || 30}%"></div>
          </div>
        </div>
        <div class="cw-meta">${item.epName} • ${item.timeText}</div>
        <div class="cw-name">${item.name}</div>
      `;

      App.attachPosterFallback(card.querySelector('.cw-thumb'));
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

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAccountTab() {
  const session = window.Auth?.activeKeyData;
  const isAuthenticated = Boolean(session?.active !== false && session?.telegramId && session?.key);
  const teleId = isAuthenticated ? String(session.telegramId) : 'Chưa đăng nhập';
  const plan = isAuthenticated ? (session.isAdmin ? 'SUPER ADMIN' : (session.plan || 'VIP')) : 'Chưa kích hoạt';
  const key = isAuthenticated ? `${String(session.key).slice(0, 4)}••••${String(session.key).slice(-4)}` : 'Chưa có key';
  const isSuperAdmin = Boolean(isAuthenticated && session.isAdmin);

  const teleEl = document.getElementById('accTelegramId');
  const planEl = document.getElementById('accPlan');
  const keyEl = document.getElementById('accKey');
  const adminBtn = document.getElementById('accAdminBtn');

  if (teleEl) teleEl.textContent = teleId;
  if (planEl) planEl.textContent = isSuperAdmin ? '👑 SUPER ADMIN' : plan;
  if (keyEl) keyEl.textContent = key;
  const versionEl = document.getElementById('accAppVersion');
  if (versionEl) versionEl.textContent = `v${window.API?.getVersion?.() || '3.4.3'}`;

  if (adminBtn) {
    adminBtn.classList.toggle('hidden', !isSuperAdmin);
  }
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
