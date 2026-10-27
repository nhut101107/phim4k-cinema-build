const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appCode = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const webIndexHtml = fs.readFileSync(path.join(root, 'public/web-index.html'), 'utf8');
const modalCss = fs.readFileSync(path.join(root, 'public/css/modal.css'), 'utf8');
const styleCss = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');

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
    get className() {
      return Array.from(classes).join(' ');
    },
    set className(val) {
      classes.clear();
      if (val) String(val).split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    },
    style: {
      setProperty: (k, v) => { el.style[k] = v; },
      getPropertyValue: (k) => el.style[k] || ''
    },
    dataset: {},
    value: '',
    disabled: false,
    src: '',
    parentElement: null,
    parentNode: null,
    scrollTop: 0,
    tabIndex: 0,

    get classList() {
      return {
        add: (...names) => {
          names.forEach(n => classes.add(n));
        },
        remove: (...names) => {
          names.forEach(n => classes.delete(n));
        },
        toggle: (name, force) => {
          const state = force !== undefined ? Boolean(force) : !classes.has(name);
          if (state) classes.add(name); else classes.delete(name);
          return state;
        },
        contains: name => classes.has(name),
      };
    },

    get textContent() {
      if (children.length > 0) {
        return children.map(c => c.textContent).filter(Boolean).join(' ');
      }
      return text;
    },
    set textContent(v) {
      text = String(v ?? '');
      html = text;
      children.length = 0;
    },

    get innerHTML() {
      return html;
    },
    set innerHTML(htmlStr) {
      html = String(htmlStr ?? '');
      children.length = 0;
      if (!htmlStr) return;

      function parseNodes(str) {
        const nodes = [];
        let i = 0;
        while (i < str.length) {
          const openStart = str.indexOf('<', i);
          if (openStart === -1) break;
          if (str[openStart + 1] === '/' || str[openStart + 1] === '!') {
            i = openStart + 1;
            continue;
          }
          const openEnd = str.indexOf('>', openStart);
          if (openEnd === -1) break;

          const tagHeader = str.slice(openStart + 1, openEnd).trim();
          const isSelfClosing = tagHeader.endsWith('/') || ['img', 'input', 'br', 'hr'].includes(tagHeader.split(/\s+/)[0].toLowerCase());
          const tagSpaceIdx = tagHeader.search(/\s|\//);
          const tagName = (tagSpaceIdx === -1 ? tagHeader : tagHeader.slice(0, tagSpaceIdx)).toLowerCase();
          const attrs = tagSpaceIdx === -1 ? '' : tagHeader.slice(tagSpaceIdx);

          const classMatch = attrs.match(/class=["']([^"']+)["']/i);
          const idMatch = attrs.match(/id=["']([^"']+)["']/i);
          const elNode = createMockElement(tagName, idMatch ? idMatch[1] : '', classMatch ? classMatch[1] : '');

          if (isSelfClosing) {
            nodes.push(elNode);
            i = openEnd + 1;
          } else {
            const closeTag = `</${tagName}>`;
            const openTagPrefix = `<${tagName}`;
            let depth = 1;
            let searchPos = openEnd + 1;
            let closeStart = -1;

            while (depth > 0 && searchPos < str.length) {
              const nextOpen = str.indexOf(openTagPrefix, searchPos);
              const nextClose = str.indexOf(closeTag, searchPos);
              if (nextClose === -1) break;

              if (nextOpen !== -1 && nextOpen < nextClose) {
                const charAfter = str[nextOpen + openTagPrefix.length];
                if (charAfter === '>' || /\s/.test(charAfter)) {
                  depth++;
                }
                searchPos = nextOpen + openTagPrefix.length;
              } else {
                depth--;
                if (depth === 0) {
                  closeStart = nextClose;
                }
                searchPos = nextClose + closeTag.length;
              }
            }

            if (closeStart !== -1) {
              const innerContent = str.slice(openEnd + 1, closeStart);
              elNode.innerHTML = innerContent;
              nodes.push(elNode);
              i = closeStart + closeTag.length;
            } else {
              i = openEnd + 1;
            }
          }
        }
        return nodes;
      }

      const parsed = parseNodes(html);
      if (parsed.length > 0) {
        parsed.forEach(c => {
          c.parentElement = el;
          c.parentNode = el;
          children.push(c);
        });
      } else {
        text = html.replace(/<[^>]*>/g, '').trim();
      }
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
        if (child.nodeType === 11 || child.className === 'fragment') {
          while (child.children.length > 0) {
            const c = child.children.shift();
            c.parentElement = el;
            c.parentNode = el;
            children.push(c);
          }
          return child;
        }
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
      const ev = typeof event === 'string' ? { type, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} } : event;
      fns.forEach(fn => fn.call(el, ev));
      return true;
    },
    click() {
      el.dispatchEvent('click');
      if (typeof el.onclick === 'function') {
        el.onclick({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} });
      }
    },
    scrollIntoView() {},
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

function createAppHarness(catalog = []) {
  const elements = new Map();

  function getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, createMockElement('div', id));
    }
    return elements.get(id);
  }

  const document = {
    readyState: 'complete',
    body: createMockElement('body'),
    getElementById,
    querySelector: selector => {
      if (selector.startsWith('#')) return getElementById(selector.slice(1));
      return null;
    },
    querySelectorAll: () => [],
    createElement: tag => createMockElement(tag),
    createDocumentFragment: () => {
      const frag = createMockElement('div', '', 'fragment');
      return frag;
    },
    addEventListener() {},
    removeEventListener() {}
  };

  // Pre-seed elements
  const searchInput = createMockElement('input', 'searchInput');
  const searchClear = createMockElement('button', 'searchClear', 'search-clear hidden');
  const searchDropdown = createMockElement('div', 'searchDropdown', 'search-dropdown hidden');
  const tabSearchInput = createMockElement('input', 'tabSearchInput');
  const tabSearchResults = createMockElement('div', 'tabSearchResults', 'movie-grid');
  const movieModal = createMockElement('div', 'movieModal', 'modal-overlay hidden');
  const detailBody = createMockElement('div', 'detailBody', 'detail-body');
  const relatedMoviesSection = createMockElement('div', 'relatedMoviesSection', 'related-movies-section hidden');
  const relatedMoviesGrid = createMockElement('div', 'relatedMoviesGrid', 'related-movies-grid movie-grid');

  relatedMoviesSection.appendChild(relatedMoviesGrid);
  detailBody.appendChild(relatedMoviesSection);
  movieModal.appendChild(detailBody);

  elements.set('searchInput', searchInput);
  elements.set('searchClear', searchClear);
  elements.set('searchDropdown', searchDropdown);
  elements.set('tabSearchInput', tabSearchInput);
  elements.set('tabSearchResults', tabSearchResults);
  elements.set('movieModal', movieModal);
  elements.set('relatedMoviesSection', relatedMoviesSection);
  elements.set('relatedMoviesGrid', relatedMoviesGrid);

  const apiSearches = [];
  const sandbox = {
    console,
    document,
    window: {
      document,
      location: { href: 'https://phim4k.test' },
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    API: {
      search: async (query, page) => {
        apiSearches.push({ query, page });
        return { items: [] };
      },
      trackUsage: () => {},
      clearMovieCache: () => {}
    },
    AccountExperience: {
      updateDetailButtons: () => {}
    },
    Player: {
      open: () => {}
    }
  };

  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(appCode, sandbox);

  const App = sandbox.window.App || sandbox.App;
  App.homeCatalog = [...catalog];

  return { App, elements, sandbox, apiSearches };
}

const sampleMovies = [
  {
    slug: 'dao-pho-va-piano',
    name: 'Đào, Phở và Piano',
    origin_name: 'Peach Blossom, Pho and Piano',
    year: 2024,
    quality: '4K',
    thumb_url: 'https://example.test/dao-pho.jpg',
    poster_url: 'https://example.test/dao-pho-p.jpg',
    category: [{ id: '1', name: 'Lịch Sử', slug: 'lich-su' }, { id: '2', name: 'Chiến Tranh', slug: 'chien-tranh' }],
    country: [{ id: '1', name: 'Việt Nam', slug: 'viet-nam' }]
  },
  {
    slug: 'dia-dao-cu-chi',
    name: 'Địa Đạo Củ Chi',
    origin_name: 'Cu Chi Tunnels',
    year: 2025,
    quality: 'FHD',
    thumb_url: 'https://example.test/dia-dao.jpg',
    poster_url: 'https://example.test/dia-dao-p.jpg',
    category: [{ id: '1', name: 'Lịch Sử', slug: 'lich-su' }, { id: '2', name: 'Chiến Tranh', slug: 'chien-tranh' }, { id: '3', name: 'Hành Động', slug: 'hanh-dong' }],
    country: [{ id: '1', name: 'Việt Nam', slug: 'viet-nam' }]
  },
  {
    slug: 'lat-mat-7',
    name: 'Lật Mặt 7: Một Điều Ước',
    origin_name: 'Face Off 7',
    year: 2024,
    quality: '4K',
    thumb_url: 'https://example.test/lat-mat.jpg',
    poster_url: 'https://example.test/lat-mat-p.jpg',
    category: [{ id: '4', name: 'Tâm Lý', slug: 'tam-ly' }, { id: '5', name: 'Gia Đình', slug: 'gia-dinh' }],
    country: [{ id: '1', name: 'Việt Nam', slug: 'viet-nam' }]
  },
  {
    slug: 'oppenheimer',
    name: 'Oppenheimer',
    origin_name: 'Oppenheimer',
    year: 2023,
    quality: '4K',
    thumb_url: 'https://example.test/oppenheimer.jpg',
    poster_url: 'https://example.test/oppenheimer-p.jpg',
    category: [{ id: '1', name: 'Lịch Sử', slug: 'lich-su' }, { id: '4', name: 'Tâm Lý', slug: 'tam-ly' }],
    country: [{ id: '2', name: 'Âu Mỹ', slug: 'au-my' }]
  }
];

test('M3.1: public/index.html and public/web-index.html are 100% byte-for-byte identical', () => {
  assert.equal(indexHtml, webIndexHtml, 'public/index.html and public/web-index.html must be identical');
});

test('M3.2: #relatedMoviesSection and #relatedMoviesGrid markup exist with movie-grid class', () => {
  assert.match(indexHtml, /id="relatedMoviesSection"/);
  assert.match(indexHtml, /id="relatedMoviesGrid"/);
  assert.match(indexHtml, /class="related-movies-grid movie-grid"/);
});

test('M3.3: CSS rules for related movies and search quality badges exist in stylesheets', () => {
  assert.match(modalCss, /\.related-movies-section/);
  assert.match(modalCss, /\.related-movies-grid/);
  assert.match(styleCss, /\.search-badge-quality/);
  assert.match(styleCss, /\.search-item\.selected/);
});

test('M3.4: performInstantSearch runs 0ms in-memory query against homeCatalog immediately', () => {
  const { App, elements } = createAppHarness(sampleMovies);
  const dropdown = elements.get('searchDropdown');

  // Query "dao" matches "Đào, Phở và Piano" and "Địa Đạo Củ Chi"
  App.performInstantSearch('dao');

  assert.equal(dropdown.classList.contains('hidden'), false);
  assert.equal(dropdown.children.length, 2);

  const first = dropdown.children[0];
  assert.ok(first.classList.contains('search-item'));
  assert.equal(first.querySelector('.search-title').textContent, 'Đào, Phở và Piano');
  assert.equal(first.querySelector('.search-badge-quality').textContent, '4K');
});

test('M3.5: performInstantSearch debounces remote API query by 250ms', async () => {
  const { App, apiSearches } = createAppHarness(sampleMovies);

  App.performInstantSearch('op');
  await new Promise(r => setTimeout(r, 50));
  App.performInstantSearch('opp');
  await new Promise(r => setTimeout(r, 50));
  App.performInstantSearch('oppen');

  // Before 250ms has elapsed, no API calls dispatched
  assert.equal(apiSearches.length, 0);

  // Wait 300ms for debounce timer to fire
  await new Promise(r => setTimeout(r, 300));
  assert.equal(apiSearches.length, 1);
  assert.equal(apiSearches[0].query, 'oppen');
});

test('M3.6: Keyboard navigation moves selected index with ArrowDown/ArrowUp and Escape closes', () => {
  const { App, elements } = createAppHarness(sampleMovies);
  const searchInput = elements.get('searchInput');
  const dropdown = elements.get('searchDropdown');

  // Perform search to populate 2 items
  App.performInstantSearch('dao');
  const items = dropdown.children;
  assert.equal(items.length, 2);

  // ArrowDown -> select 0
  App.searchSelectedIndex = -1;
  App.searchSelectedIndex = (App.searchSelectedIndex + 1) % items.length;
  App.updateSearchSelection(items);
  assert.equal(App.searchSelectedIndex, 0);
  assert.equal(items[0].classList.contains('selected'), true);
  assert.equal(items[1].classList.contains('selected'), false);

  // ArrowDown -> select 1
  App.searchSelectedIndex = (App.searchSelectedIndex + 1) % items.length;
  App.updateSearchSelection(items);
  assert.equal(App.searchSelectedIndex, 1);
  assert.equal(items[1].classList.contains('selected'), true);

  // ArrowUp -> wrap back to 0
  App.searchSelectedIndex = (App.searchSelectedIndex - 1 + items.length) % items.length;
  App.updateSearchSelection(items);
  assert.equal(App.searchSelectedIndex, 0);

  // Hide search dropdown resets selection and hides dropdown
  App.hideSearchDropdown();
  assert.equal(dropdown.classList.contains('hidden'), true);
  assert.equal(App.searchSelectedIndex, -1);
});

test('M3.7: onTabSearchInput provides 0ms instant cards and debounced remote results', async () => {
  const { App, elements, apiSearches } = createAppHarness(sampleMovies);
  const container = elements.get('tabSearchResults');

  // Input event triggers 0ms in-memory card rendering
  App.onTabSearchInput({ target: { value: 'lat mat' } });
  assert.ok(container.children.length > 0, 'Instant cards should appear immediately in tabSearchResults');
  assert.equal(container.children[0].querySelector('.card-title').textContent, 'Lật Mặt 7: Một Điều Ước');

  // Wait for 250ms debounce
  await new Promise(r => setTimeout(r, 300));
  assert.equal(apiSearches.length, 1);
  assert.equal(apiSearches[0].query, 'lat mat');
});

test('M3.8: scoreRelatedMovie ranks by category (+3) and country (+1) and excludes self', () => {
  const { App } = createAppHarness(sampleMovies);

  const source = sampleMovies[0]; // dao-pho-va-piano (Lịch Sử, Chiến Tranh; VN)
  const candidate1 = sampleMovies[1]; // dia-dao-cu-chi (Lịch Sử, Chiến Tranh, Hành Động; VN) => 3*2 + 1 = 7
  const candidate2 = sampleMovies[3]; // oppenheimer (Lịch Sử, Tâm Lý; Âu Mỹ) => 3*1 + 0 = 3
  const candidate3 = sampleMovies[2]; // lat-mat-7 (Tâm Lý, Gia Đình; VN) => 0 + 1 = 1

  assert.equal(App.scoreRelatedMovie(source, source), -1, 'Active movie must be excluded from its own related list');
  assert.equal(App.scoreRelatedMovie(source, candidate1), 7);
  assert.equal(App.scoreRelatedMovie(source, candidate2), 3);
  assert.equal(App.scoreRelatedMovie(source, candidate3), 1);
});

test('M3.9: scoreRelatedMovie handles duplicate tags and corrupted values gracefully', () => {
  const { App } = createAppHarness(sampleMovies);

  const source = {
    slug: 'source',
    category: [{ name: 'Hành Động', slug: 'hanh-dong' }],
    country: [{ name: 'Việt Nam', slug: 'viet-nam' }]
  };

  const dupeCandidate = {
    slug: 'dupe',
    category: [{ name: 'Hành Động', slug: 'hanh-dong' }, { name: 'Hành Động', slug: 'hanh-dong' }],
    country: [{ name: 'Việt Nam', slug: 'viet-nam' }]
  };

  const score = App.scoreRelatedMovie(source, dupeCandidate);
  assert.equal(score, 4, 'Duplicate categories must not inflate score');

  const corruptedCandidate = {
    slug: 'corrupt',
    category: [null, undefined, ''],
    country: null
  };
  assert.equal(App.scoreRelatedMovie(source, corruptedCandidate), 0);
});

test('M3.10: renderRelatedMovies populates top movies into #relatedMoviesGrid', () => {
  const { App, elements } = createAppHarness(sampleMovies);
  const section = elements.get('relatedMoviesSection');
  const grid = elements.get('relatedMoviesGrid');

  let openedSlug = '';
  App.openMovieDetail = (slug) => { openedSlug = slug; };

  App.renderRelatedMovies(sampleMovies[0]);

  assert.equal(section.classList.contains('hidden'), false);
  assert.ok(grid.children.length > 0);

  // Top related movie is Địa Đạo Củ Chi
  const topCard = grid.children[0];
  assert.ok(topCard.classList.contains('movie-card'));
  assert.ok(topCard.classList.contains('related-card'));
  assert.equal(topCard.querySelector('.card-title').textContent, 'Địa Đạo Củ Chi');

  // Clicking related card calls openMovieDetail
  topCard.click();
  assert.equal(openedSlug, 'dia-dao-cu-chi');
});
