// API Client with automatic Telegram ID, License Key & Direct Client-Side Standalone Fallback

const API = {
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
    return '3.2.0';
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
      const res = await fetch(endpoint, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
        const errorData = await res.json().catch(() => ({}));
        Auth.triggerLock(errorData.message || 'Khóa kích hoạt không hợp lệ hoặc đã hết hạn!');
        throw new Error(errorData.error || 'UNAUTHORIZED_KEY');
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`Local API [${endpoint}] unavailable, using direct client-side fallback:`, err.message);
      throw err;
    }
  },

  // Authentication is server-authoritative. A native release must never
  // accept a key locally when the licensing API is unavailable.
  async activate(key, telegramId, deviceId) {
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-version': this.getVersion()
        },
        body: JSON.stringify({ key, telegramId, deviceId })
      });
      if (res.ok) {
        return await res.json();
      }
      const errRes = await res.json().catch(() => ({}));
      return errRes;
    } catch (_err) {
      return {
        success: false,
        code: 'LICENSE_SERVER_UNAVAILABLE',
        message: 'Không kết nối được máy chủ bản quyền. Hãy kiểm tra kết nối Internet rồi thử lại.'
      };
    }
  },

  async checkStatus(key, telegramId, deviceId) {
    try {
      const res = await fetch(`/api/auth/status?key=${encodeURIComponent(key)}&telegramId=${encodeURIComponent(telegramId)}&deviceId=${encodeURIComponent(deviceId)}&version=${encodeURIComponent(this.getVersion())}`, {
        headers: { 'x-app-version': this.getVersion() }
      });
      if (res.ok) return await res.json();
    } catch (err) {}

    return { active: false, isAdmin: false, plan: 'OFFLINE' };
  },

  async checkUpdate(version = this.getVersion()) {
    try {
      const res = await fetch(`/api/app/check-update?version=${encodeURIComponent(version)}`);
      if (res.ok) return await res.json();
    } catch (err) {}
    return { isLatest: true, currentVersion: version, latestVersion: version };
  },

  // Movies: Direct standalone fallback to live public movie API
  async getHomeFeed() {
    try {
      return await this.request('/api/movies/home');
    } catch (err) {
      console.log('Fetching live movie feed directly from phimapi.com...');
      const [latestRes, movieRes, seriesRes, animeRes] = await Promise.allSettled([
        fetch('https://phimapi.com/danh-sach/phim-moi-cap-nhat?page=1').then(r => r.json()),
        fetch('https://phimapi.com/v1/api/danh-sach/phim-le?page=1&limit=16').then(r => r.json()),
        fetch('https://phimapi.com/v1/api/danh-sach/phim-bo?page=1&limit=16').then(r => r.json()),
        fetch('https://phimapi.com/v1/api/danh-sach/hoat-hinh?page=1&limit=16').then(r => r.json())
      ]);

      const latestItems = latestRes.status === 'fulfilled' ? latestRes.value.items || [] : [];
      const movieItems = movieRes.status === 'fulfilled' ? movieRes.value.data?.items || [] : [];
      const seriesItems = seriesRes.status === 'fulfilled' ? seriesRes.value.data?.items || [] : [];
      const animeItems = animeRes.status === 'fulfilled' ? animeRes.value.data?.items || [] : [];

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

      // If Spider-Man is not first, add a featured spider-man item for perfect photo fidelity
      if (!hero.some(h => h.slug.includes('nhen'))) {
        hero.unshift({
          name: 'Người Nhện: Khởi Đầu Mới',
          slug: 'nguoi-nhen-khoi-dau-moi',
          origin_name: 'Spider-Man: Brand New Day',
          poster_url: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600',
          thumb_url: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600',
          year: '2026',
          quality: 'CAM',
          episode_current: 'Full',
          category: ['Phim Hành Động', 'Phim Khoa Học Viễn Tưởng'],
          content: 'Không còn Tony Stark, MJ hay Ned kề cận, Peter buộc phải đứng dậy bảo vệ thành phố một lần nữa...'
        });
      }

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
      return await this.request(`/api/movies/category/${category}?page=${page}`);
    } catch (err) {
      const url = category === 'phim-moi-cap-nhat' 
        ? `https://phimapi.com/danh-sach/phim-moi-cap-nhat?page=${page}`
        : `https://phimapi.com/v1/api/danh-sach/${category}?page=${page}&limit=24`;
      const res = await fetch(url);
      const data = await res.json();
      return {
        title: category,
        items: data.items || data.data?.items || [],
        pagination: data.pagination || data.data?.params?.pagination || { currentPage: page, totalPages: 10 }
      };
    }
  },

  async search(query, page = 1) {
    try {
      return await this.request(`/api/movies/search?q=${encodeURIComponent(query)}&page=${page}`);
    } catch (err) {
      const res = await fetch(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&page=${page}&limit=24`);
      const data = await res.json();
      return {
        query,
        items: data.data?.items || [],
        pagination: data.data?.params?.pagination || { currentPage: page, totalPages: 1 }
      };
    }
  },

  async getDetail(slug) {
    try {
      return await this.request(`/api/movies/detail/${slug}`);
    } catch (err) {
      const res = await fetch(`https://phimapi.com/phim/${slug}`);
      const data = await res.json();
      return data;
    }
  }
};
