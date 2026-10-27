/**
 * Shared Test Helpers & Fixtures for Phim4K Cinema 4-Tier E2E Test Suite
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Creates an in-memory mock DOM element
 */
function createMockElement(tagName = 'div', id = '', classNames = '') {
  const classes = new Set(classNames ? classNames.split(/\s+/).filter(Boolean) : []);
  const attributes = new Map();
  const children = [];
  const listeners = new Map();
  let text = '';
  let html = '';

  const el = {
    tagName: tagName.toUpperCase(),
    id,
    className: classNames,
    style: {},
    dataset: {},
    href: '',
    value: '',
    disabled: false,
    src: '',
    parentElement: null,
    parentNode: null,

    get classList() {
      return {
        add: (...names) => {
          names.forEach(n => classes.add(n));
          el.className = Array.from(classes).join(' ');
        },
        remove: (...names) => {
          names.forEach(n => classes.delete(n));
          el.className = Array.from(classes).join(' ');
        },
        toggle: (name, force) => {
          const state = force !== undefined ? Boolean(force) : !classes.has(name);
          if (state) classes.add(name); else classes.delete(name);
          el.className = Array.from(classes).join(' ');
          return state;
        },
        contains: name => classes.has(name),
      };
    },

    get textContent() {
      return text;
    },
    set textContent(v) {
      text = String(v ?? '');
      html = text;
    },

    get innerHTML() {
      return html;
    },
    set innerHTML(v) {
      html = String(v ?? '');
      text = html.replace(/<[^>]*>/g, '');
    },

    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    },

    appendChild(child) {
      if (child) {
        child.parentElement = el;
        child.parentNode = el;
        children.push(child);
      }
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) {
        children.splice(idx, 1);
        child.parentElement = null;
        child.parentNode = null;
      }
      return child;
    },
    get children() {
      return children;
    },
    get firstElementChild() {
      return children[0] || null;
    },

    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners.has(event)) {
        const arr = listeners.get(event).filter(f => f !== fn);
        listeners.set(event, arr);
      }
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event?.type;
      const fns = listeners.get(type) || [];
      const ev = typeof event === 'string' ? { type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} } : event;
      fns.forEach(fn => fn.call(el, ev));
      return true;
    },
    click() {
      el.dispatchEvent('click');
      if (typeof el.onclick === 'function') {
        el.onclick({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} });
      }
    },
    focus() {
      el.dispatchEvent('focus');
    },
    blur() {
      el.dispatchEvent('blur');
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (selector.startsWith('.') && cur.classList.contains(selector.slice(1))) return cur;
        if (selector.startsWith('#') && cur.id === selector.slice(1)) return cur;
        if (cur.tagName.toLowerCase() === selector.toLowerCase()) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      const queue = [...children];
      while (queue.length > 0) {
        const curr = queue.shift();
        if (selector.startsWith('.') && curr.classList.contains(selector.slice(1))) return curr;
        if (selector.startsWith('#') && curr.id === selector.slice(1)) return curr;
        if (curr.tagName.toLowerCase() === selector.toLowerCase()) return curr;
        queue.push(...curr.children);
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      const queue = [...children];
      while (queue.length > 0) {
        const curr = queue.shift();
        if (selector.startsWith('.') && curr.classList.contains(selector.slice(1))) results.push(curr);
        else if (selector.startsWith('#') && curr.id === selector.slice(1)) results.push(curr);
        else if (curr.tagName.toLowerCase() === selector.toLowerCase()) results.push(curr);
        queue.push(...curr.children);
      }
      return results;
    }
  };

  return el;
}

/**
 * Creates a simulated HTML5 video element with playback and event support
 */
function createMockVideo() {
  const el = createMockElement('video', 'videoPlayer', 'video-element');
  el.currentTime = 0;
  el.duration = 1800; // default 30 min
  el.paused = true;
  el.ended = false;
  el.muted = false;
  el.volume = 1;
  el.playbackRate = 1;
  el.readyState = 4;

  el.play = async function() {
    el.paused = false;
    el.dispatchEvent('play');
    el.dispatchEvent('playing');
  };

  el.pause = function() {
    el.paused = true;
    el.dispatchEvent('pause');
  };

  el.load = function() {
    el.dispatchEvent('loadstart');
  };

  el.seek = function(seconds) {
    el.currentTime = Math.max(0, Math.min(seconds, el.duration));
    el.dispatchEvent('timeupdate');
  };

  el.simulateStall = function() {
    el.dispatchEvent('waiting');
    el.dispatchEvent('stalled');
  };

  el.simulateError = function(error = new Error('Media error')) {
    el.error = error;
    el.dispatchEvent('error');
  };

  el.simulateEnd = function() {
    el.currentTime = el.duration;
    el.ended = true;
    el.paused = true;
    el.dispatchEvent('timeupdate');
    el.dispatchEvent('ended');
  };

  return el;
}

/**
 * Creates mock LocalStorage
 */
function createMockStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    _dump: () => Object.fromEntries(store.entries())
  };
}

/**
 * Creates simulated browser DOM environment for Phim4K
 */
function createDOMFixture(htmlContent = '') {
  const elements = new Map();

  function getElementById(id) {
    if (!elements.has(id)) {
      const el = createMockElement('div', id);
      elements.set(id, el);
    }
    return elements.get(id);
  }

  function registerElement(id, el) {
    elements.set(id, el);
    return el;
  }

  // Pre-register standard player elements
  const video = createMockVideo();
  registerElement('videoPlayer', video);

  const playerModal = createMockElement('div', 'playerModal', 'player-modal-overlay hidden');
  registerElement('playerModal', playerModal);

  const playerWrapper = createMockElement('div', 'playerWrapper', 'cinema-player-wrapper aspect-contain');
  registerElement('playerWrapper', playerWrapper);

  const playerEmbed = createMockElement('iframe', 'playerEmbed', 'video-element hidden');
  registerElement('playerEmbed', playerEmbed);

  const btnSkipIntro = createMockElement('button', 'btnSkipIntro', 'btn-skip-intro hidden');
  btnSkipIntro.textContent = '⏩ Bỏ qua Intro';
  registerElement('btnSkipIntro', btnSkipIntro);

  const nextEpisodePopup = createMockElement('div', 'nextEpisodePopup', 'next-episode-popup hidden');
  const nextEpTimer = createMockElement('span', 'nextEpTimer', 'countdown-timer');
  const nextEpTitle = createMockElement('span', 'nextEpTitle', 'next-ep-title');
  const btnNextEpWatchNow = createMockElement('button', 'btnNextEpWatchNow', 'btn-watch-now');
  const btnNextEpCancel = createMockElement('button', 'btnNextEpCancel', 'btn-cancel');
  nextEpisodePopup.appendChild(nextEpTimer);
  nextEpisodePopup.appendChild(nextEpTitle);
  nextEpisodePopup.appendChild(btnNextEpWatchNow);
  nextEpisodePopup.appendChild(btnNextEpCancel);
  registerElement('nextEpisodePopup', nextEpisodePopup);
  registerElement('nextEpTimer', nextEpTimer);
  registerElement('nextEpTitle', nextEpTitle);
  registerElement('btnNextEpWatchNow', btnNextEpWatchNow);
  registerElement('btnNextEpCancel', btnNextEpCancel);

  // Search elements
  const searchInput = createMockElement('input', 'searchInput');
  const searchClear = createMockElement('button', 'searchClear', 'search-clear hidden');
  const searchDropdown = createMockElement('div', 'searchDropdown', 'search-dropdown hidden');
  const tabSearchInput = createMockElement('input', 'tabSearchInput');
  const tabSearchResults = createMockElement('div', 'tabSearchResults', 'movie-grid');
  registerElement('searchInput', searchInput);
  registerElement('searchClear', searchClear);
  registerElement('searchDropdown', searchDropdown);
  registerElement('tabSearchInput', tabSearchInput);
  registerElement('tabSearchResults', tabSearchResults);

  // Detail Modal & Related movies
  const movieModal = createMockElement('div', 'movieModal', 'modal-overlay hidden');
  const relatedMoviesSection = createMockElement('div', 'relatedMoviesSection', 'related-section');
  const relatedMoviesGrid = createMockElement('div', 'relatedMoviesGrid', 'movie-grid related-grid');
  relatedMoviesSection.appendChild(relatedMoviesGrid);
  movieModal.appendChild(relatedMoviesSection);
  registerElement('movieModal', movieModal);
  registerElement('relatedMoviesSection', relatedMoviesSection);
  registerElement('relatedMoviesGrid', relatedMoviesGrid);

  // Download modal elements
  const downloadAppModal = createMockElement('div', 'downloadAppModal', 'modal-overlay hidden');
  const btnDownloadApk = createMockElement('a', 'btnDownloadApk', 'btn-download-action btn-apk');
  const btnDownloadTv = createMockElement('a', 'btnDownloadTv', 'btn-download-action btn-tv');
  const btnDownloadIpa = createMockElement('a', 'btnDownloadIpa', 'btn-download-action btn-ipa');
  const btnDownloadExe = createMockElement('a', 'btnDownloadExe', 'btn-download-action btn-exe');
  registerElement('downloadAppModal', downloadAppModal);
  registerElement('btnDownloadApk', btnDownloadApk);
  registerElement('btnDownloadTv', btnDownloadTv);
  registerElement('btnDownloadIpa', btnDownloadIpa);
  registerElement('btnDownloadExe', btnDownloadExe);

  const document = {
    readyState: 'complete',
    getElementById,
    querySelector: selector => {
      if (selector.startsWith('#')) return getElementById(selector.slice(1));
      return null;
    },
    querySelectorAll: () => [],
    createElement: tag => createMockElement(tag),
    addEventListener() {},
    removeEventListener() {},
    body: createMockElement('body')
  };

  const window = {
    document,
    localStorage: createMockStorage(),
    setTimeout: (fn, delay) => setTimeout(fn, delay),
    clearTimeout: id => clearTimeout(id),
    setInterval: (fn, delay) => setInterval(fn, delay),
    clearInterval: id => clearInterval(id),
    requestAnimationFrame: fn => setTimeout(fn, 16),
    cancelAnimationFrame: id => clearTimeout(id),
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    PHIM4K_PLATFORM: 'web',
    location: { origin: 'https://phim4k.test', href: 'https://phim4k.test' }
  };

  return { document, window, elements, video, registerElement };
}

/**
 * Checks if a specific feature contract is implemented in the codebase
 */
function isFeatureImplemented(featureKey) {
  try {
    switch (featureKey) {
      case 'downloadBuild43': {
        const workerContent = fs.readFileSync(path.join(PROJECT_ROOT, 'backend-worker/src/worker.mjs'), 'utf8');
        return workerContent.includes('build=43');
      }
      case 'downloadAdminTv': {
        const serverContent = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
        return serverContent.includes('android_tv');
      }
      case 'nextEpisodeCountdownCore': {
        const coreContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/player-core.js'), 'utf8');
        return coreContent.includes('nextEpisodeCountdown');
      }
      case 'nextEpisodeCountdownPlayer': {
        const playerContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/player.js'), 'utf8');
        return playerContent.includes('nextEpisodeCountdown') || playerContent.includes('nextEpPopup');
      }
      case 'skipIntroCore': {
        const coreContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/player-core.js'), 'utf8');
        return coreContent.includes('isIntroInterval') || coreContent.includes('skipIntroTarget');
      }
      case 'skipIntroPlayer': {
        const playerContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/player.js'), 'utf8');
        return playerContent.includes('skipIntro');
      }
      case 'skipIntroHtml': {
        const htmlContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/index.html'), 'utf8');
        return htmlContent.includes('btnSkipIntro');
      }
      case 'autoFailoverEnhanced': {
        const playerContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/player.js'), 'utf8');
        return playerContent.includes('fallbackToNextServer') && (playerContent.includes('8000') || playerContent.includes('resumeTime'));
      }
      case 'liveSearchAutocomplete': {
        const appContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/app.js'), 'utf8');
        return appContent.includes('performInstantSearch') && appContent.includes('renderInstantSearch');
      }
      case 'relatedMovies': {
        const appContent = fs.readFileSync(path.join(PROJECT_ROOT, 'public/js/app.js'), 'utf8');
        return appContent.includes('renderRelatedMovies') || appContent.includes('relatedMoviesGrid');
      }
      default:
        return false;
    }
  } catch (err) {
    return false;
  }
}

/**
 * Authoritative Specification Reference Models
 * Derived directly from PROJECT.md § Interface Contracts
 */
const SpecReference = {
  /**
   * Evaluates next episode countdown state
   * Returns { active: boolean, remaining: number } | null
   */
  nextEpisodeCountdown(currentTime, duration, threshold = 30) {
    const cur = Number(currentTime);
    const dur = Number(duration);
    if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= 60) return null;
    const remaining = Math.max(0, Math.ceil(dur - cur));
    if (remaining <= threshold && remaining > 0) {
      return { active: true, remaining };
    }
    return null;
  },

  /**
   * Evaluates if playback is within intro window
   */
  isIntroInterval(currentTime, duration, introSeconds = 85) {
    const cur = Number(currentTime);
    const dur = Number(duration);
    if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= 120) return false;
    return cur >= 0 && cur < introSeconds;
  },

  /**
   * Computes safe seek target timestamp when skipping intro
   */
  skipIntroTarget(currentTime, duration, introSeconds = 85) {
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur <= 1) return introSeconds;
    return Math.max(0, Math.min(introSeconds, dur - 1));
  },

  /**
   * Normalizes search and filter strings, handling diacritics and Vietnamese đ/Đ
   */
  normalizeSearchText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .trim();
  },

  /**
   * Scores movie relationship based on shared categories and countries
   */
  scoreRelatedMovie(sourceMovie, candidateMovie) {
    if (!sourceMovie || !candidateMovie || sourceMovie.slug === candidateMovie.slug) return -1;
    let score = 0;
    const extractTags = (list) => (Array.isArray(list) ? list : [])
      .filter(Boolean)
      .map(item => (typeof item === 'object' ? String(item.slug || item.name || '') : String(item)).toLowerCase())
      .filter(Boolean);

    const srcCats = new Set(extractTags(sourceMovie.category));
    const candCats = extractTags(candidateMovie.category);
    candCats.forEach(c => { if (srcCats.has(c)) score += 3; });

    const srcCountries = new Set(extractTags(sourceMovie.country));
    const candCountries = extractTags(candidateMovie.country);
    candCountries.forEach(c => { if (srcCountries.has(c)) score += 1; });

    return score;
  }
};

/**
 * Sample Catalog Fixtures for Search and Related Movies Testing
 */
const SampleCatalog = [
  {
    slug: 'dao-pho-va-piano',
    name: 'Đào, Phở và Piano',
    origin_name: 'Peach Blossom, Pho and Piano',
    year: 2024,
    thumb_url: 'https://example.test/img/dao-pho-thumb.jpg',
    poster_url: 'https://example.test/img/dao-pho-poster.jpg',
    category: [{ id: '1', name: 'Lịch Sử', slug: 'lich-su' }, { id: '2', name: 'Chiến Tranh', slug: 'chien-tranh' }],
    country: [{ id: '1', name: 'Việt Nam', slug: 'viet-nam' }]
  },
  {
    slug: 'dia-dao-cu-chi',
    name: 'Địa Đạo Củ Chi',
    origin_name: 'Cu Chi Tunnels',
    year: 2025,
    thumb_url: 'https://example.test/img/dia-dao-thumb.jpg',
    poster_url: 'https://example.test/img/dia-dao-poster.jpg',
    category: [{ id: '1', name: 'Lịch Sử', slug: 'lich-su' }, { id: '2', name: 'Chiến Tranh', slug: 'chien-tranh' }, { id: '3', name: 'Hành Động', slug: 'hanh-dong' }],
    country: [{ id: '1', name: 'Việt Nam', slug: 'viet-nam' }]
  },
  {
    slug: 'lat-mat-7',
    name: 'Lật Mặt 7: Một Điều Ước',
    origin_name: 'Face Off 7',
    year: 2024,
    thumb_url: 'https://example.test/img/lat-mat-7.jpg',
    poster_url: 'https://example.test/img/lat-mat-7-poster.jpg',
    category: [{ id: '4', name: 'Tâm Lý', slug: 'tam-ly' }, { id: '5', name: 'Gia Đình', slug: 'gia-dinh' }],
    country: [{ id: '1', name: 'Việt Nam', slug: 'viet-nam' }]
  },
  {
    slug: 'oppenheimer',
    name: 'Oppenheimer',
    origin_name: 'Oppenheimer',
    year: 2023,
    thumb_url: 'https://example.test/img/oppenheimer.jpg',
    poster_url: 'https://example.test/img/oppenheimer-poster.jpg',
    category: [{ id: '1', name: 'Lịch Sử', slug: 'lich-su' }, { id: '4', name: 'Tâm Lý', slug: 'tam-ly' }],
    country: [{ id: '2', name: 'Âu Mỹ', slug: 'au-my' }]
  },
  {
    slug: 'avatar-2',
    name: 'Avatar: Dòng Chảy Của Nước',
    origin_name: 'Avatar: The Way of Water',
    year: 2022,
    thumb_url: 'https://example.test/img/avatar-2.jpg',
    poster_url: 'https://example.test/img/avatar-2-poster.jpg',
    category: [{ id: '6', name: 'Khoa Học Viễn Tưởng', slug: 'khoa-hoc-vien-tuong' }, { id: '3', name: 'Hành Động', slug: 'hanh-dong' }],
    country: [{ id: '2', name: 'Âu Mỹ', slug: 'au-my' }]
  }
];

module.exports = {
  PROJECT_ROOT,
  createMockElement,
  createMockVideo,
  createMockStorage,
  createDOMFixture,
  isFeatureImplemented,
  SpecReference,
  SampleCatalog
};
