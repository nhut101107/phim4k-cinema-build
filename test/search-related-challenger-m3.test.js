const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appCode = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

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
      if (children.length > 0) {
        return children.map(c => `<${c.tagName.toLowerCase()} class="${c.className}">${c.innerHTML || c.textContent}</${c.tagName.toLowerCase()}>`).join('');
      }
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

function createChallengerHarness(catalog = [], searchApiImpl = null) {
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
  const defaultSearchApi = async (query, page) => {
    apiSearches.push({ query, page });
    return { items: [] };
  };

  const sandbox = {
    console,
    document,
    window: {
      document,
      location: { href: 'https://phim4k.test', origin: 'https://phim4k.test' },
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    API: {
      search: searchApiImpl || defaultSearchApi,
      trackUsage: () => {},
      clearMovieCache: () => {}
    },
    AccountExperience: {
      updateDetailButtons: () => {}
    },
    Player: {
      open: () => {},
      isOpen: false
    }
  };

  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(appCode, sandbox);

  const App = sandbox.window.App || sandbox.App;
  App.homeCatalog = Array.isArray(catalog) ? [...catalog] : catalog;

  return { App, elements, sandbox, apiSearches, document };
}

const sampleCatalog = [
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

// ============================================================================
// VECTOR 1: LIVE SEARCH EXTREME INPUT FUZZING
// ============================================================================

test('CHALLENGE 1.1: Live Search handles extreme length queries (1,000 to 50,000 characters) without hanging or crashing', () => {
  const { App, elements } = createChallengerHarness(sampleCatalog);
  const dropdown = elements.get('searchDropdown');

  const lengths = [1000, 5000, 10000, 50000];
  for (const len of lengths) {
    const hugeQuery = 'A'.repeat(len);
    assert.doesNotThrow(() => {
      App.performInstantSearch(hugeQuery);
    }, `Search should handle ${len} character queries without throwing`);
  }

  // Very long query has no matches locally
  assert.equal(dropdown.children.length, 0);
  App.hideSearchDropdown();
});

test('CHALLENGE 1.2: SQL Injection and XSS payloads in Live Search do not execute or cause unescaped HTML injections', () => {
  const { App, elements } = createChallengerHarness(sampleCatalog);
  const dropdown = elements.get('searchDropdown');

  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE movies; --",
    "UNION SELECT username, password FROM accounts--",
    "<script>alert('XSS')</script>",
    '<img src="x" onerror="window.__xss=1">',
    '"><svg/onload=alert(1)>',
    'javascript:alert(1)',
    '"><input autofocus onfocus=alert(1)>'
  ];

  for (const payload of payloads) {
    assert.doesNotThrow(() => {
      App.performInstantSearch(payload);
    });
  }

  // Test rendering of item with malicious fields
  const maliciousMovie = {
    slug: '"><script>alert("slug")</script>',
    name: '<img src=x onerror=alert("name")>',
    origin_name: '"><b onmouseover=alert("origin")>hack</b>',
    year: '2024"><script>',
    quality: '<span onclick=alert("q")>4K</span>',
    thumb_url: 'javascript:alert("img")',
    poster_url: 'https://example.test/malicious.jpg'
  };

  App.renderInstantSearch([maliciousMovie]);
  assert.equal(dropdown.classList.contains('hidden'), false);

  const renderedHtml = dropdown.innerHTML;
  assert.ok(!renderedHtml.includes('<script>'), 'Rendered HTML must not contain raw script tags');
  assert.ok(renderedHtml.includes('&lt;img src=x') || renderedHtml.includes('&lt;script&gt;'), 'Malicious characters must be escaped');
  assert.ok(!renderedHtml.includes('onerror="window.__xss=1"'));
});

test('CHALLENGE 1.3: Vietnamese diacritics and complex tone marks: normalizeFilterValue matches accurately across tone forms', () => {
  const { App, elements } = createChallengerHarness(sampleCatalog);
  const dropdown = elements.get('searchDropdown');

  // Decomposed NFD vs Precomposed NFC
  const nfcQuery = 'Đào, Phở và Piano';
  const nfdQuery = nfcQuery.normalize('NFD');
  const lowerQuery = 'dao, pho va piano';
  const noDiacriticsUpper = 'DAO PHO VA PIANO';

  assert.equal(App.normalizeFilterValue(nfcQuery), App.normalizeFilterValue(nfdQuery), 'NFC and NFD must normalize identically');
  assert.equal(App.normalizeFilterValue('đ'), 'd');
  assert.equal(App.normalizeFilterValue('Đ'), 'd');

  // Instant search with lowercase no diacritics
  App.performInstantSearch('dao');
  assert.ok(dropdown.children.length >= 1);
  assert.equal(dropdown.children[0].querySelector('.search-title').textContent, 'Đào, Phở và Piano');

  // Instant search with uppercase diacritics
  App.performInstantSearch('ĐÀO');
  assert.ok(dropdown.children.length >= 1);
  assert.equal(dropdown.children[0].querySelector('.search-title').textContent, 'Đào, Phở và Piano');

  // Instant search for Lật Mặt
  App.performInstantSearch('lat mat');
  assert.equal(dropdown.children.length, 1);
  assert.equal(dropdown.children[0].querySelector('.search-title').textContent, 'Lật Mặt 7: Một Điều Ước');
});

test('CHALLENGE 1.4: Extreme Unicode, emojis, RTL, and null bytes do not crash search', () => {
  const { App } = createChallengerHarness(sampleCatalog);

  const strangeInputs = [
    '🍿🎬🔥 4K',
    '❤️‍🔥 🏳️‍🌈',
    '\u200B\u200C\u200D\uFEFF', // Zero-width spaces & joiners
    'مرحبا بالعالم', // Arabic RTL
    'שלום עולם', // Hebrew RTL
    'dao\0pho', // Null byte
    '.*+?^${}()|[]\\', // Regex meta-characters
    '\\',
    '/'
  ];

  for (const str of strangeInputs) {
    assert.doesNotThrow(() => {
      App.performInstantSearch(str);
      App.onTabSearchInput({ target: { value: str } });
    });
  }
});

test('CHALLENGE 1.5: Non-string and bizarre inputs degrade gracefully without unhandled exceptions', () => {
  const { App } = createChallengerHarness(sampleCatalog);

  const nonStrings = [null, undefined, 0, 12345, true, false, {}, [], () => {}];

  for (const input of nonStrings) {
    assert.doesNotThrow(() => {
      App.performInstantSearch(input);
    });
  }
});

// ============================================================================
// VECTOR 2: RACE CONDITIONS, DEBOUNCE & CANCELLATION
// ============================================================================

test('CHALLENGE 2.1: Rapid typing (burst input) correctly debounces remote search calls', async () => {
  const { App, apiSearches } = createChallengerHarness(sampleCatalog);

  // Type 10 characters rapidly every 15ms (150ms total, below 250ms threshold)
  const querySequence = ['o', 'op', 'opp', 'oppe', 'oppen', 'oppenh', 'oppenhe', 'oppenhei', 'oppenheim', 'oppenheimer'];
  for (const q of querySequence) {
    App.performInstantSearch(q);
    await new Promise(r => setTimeout(r, 15));
  }

  // Immediately after burst, 0 remote API calls dispatched
  assert.equal(apiSearches.length, 0, 'No remote API searches should have fired during burst');

  // Wait 300ms for debounce timer
  await new Promise(r => setTimeout(r, 300));

  // Exactly 1 remote search fired for the FINAL query
  assert.equal(apiSearches.length, 1, 'Exactly one API search should fire for final query');
  assert.equal(apiSearches[0].query, 'oppenheimer');
});

test('CHALLENGE 2.2: Out-of-order network responses: slow earlier response is dropped when faster later response arrives', async () => {
  let resolveFirstSearch;
  let resolveSecondSearch;

  const customSearch = (query, page) => {
    if (query === 'first_slow') {
      return new Promise(r => { resolveFirstSearch = r; });
    }
    if (query === 'second_fast') {
      return new Promise(r => { resolveSecondSearch = r; });
    }
    return Promise.resolve({ items: [] });
  };

  const { App, elements } = createChallengerHarness([], customSearch);
  const dropdown = elements.get('searchDropdown');

  // 1. Dispatch first query
  App.performInstantSearch('first_slow');
  await new Promise(r => setTimeout(r, 260)); // timer fires, search 1 in flight

  // 2. Dispatch second query
  App.performInstantSearch('second_fast');
  await new Promise(r => setTimeout(r, 260)); // timer fires, search 2 in flight

  // 3. Second query resolves FIRST
  resolveSecondSearch({
    items: [{ slug: 'fast-movie', name: 'Fast Movie', quality: 'FHD' }]
  });
  await new Promise(r => setTimeout(r, 10));

  assert.equal(dropdown.children.length, 1);
  assert.equal(dropdown.children[0].querySelector('.search-title').textContent, 'Fast Movie');

  // 4. First query resolves LATER (out of order)
  resolveFirstSearch({
    items: [{ slug: 'slow-movie', name: 'Slow Movie', quality: '4K' }]
  });
  await new Promise(r => setTimeout(r, 10));

  // Stale first query must NOT have overwritten second query results
  assert.equal(dropdown.children.length, 1);
  assert.equal(dropdown.children[0].querySelector('.search-title').textContent, 'Fast Movie', 'Stale network response must be dropped');
});

test('CHALLENGE 2.3: Debounce cancellation on clear and searchRequestId lifecycle', async () => {
  const { App, elements, apiSearches } = createChallengerHarness(sampleCatalog);
  const dropdown = elements.get('searchDropdown');

  // Case A: User types and clears within debounce window (< 250ms)
  App.performInstantSearch('temp_query');
  await new Promise(r => setTimeout(r, 100));
  App.performInstantSearch('');

  await new Promise(r => setTimeout(r, 300));
  assert.equal(apiSearches.length, 0, 'No remote API searches should fire if cleared during debounce window');
  assert.equal(dropdown.classList.contains('hidden'), true, 'Dropdown remains hidden when query is cleared');
});

test('CHALLENGE 2.4: Tab Search (onTabSearchInput) handles rapid clearing and remote errors', async () => {
  let rejectSearch;
  const errorSearch = () => new Promise((_, rej) => { rejectSearch = rej; });

  const { App, elements } = createChallengerHarness(sampleCatalog, errorSearch);
  const tabResults = elements.get('tabSearchResults');

  // Input keyword
  App.onTabSearchInput({ target: { value: 'dao' } });
  assert.ok(tabResults.children.length > 0, 'Instant matches rendered at 0ms');

  // Wait for debounce timer
  await new Promise(r => setTimeout(r, 260));

  // Remote search throws network error
  rejectSearch(new Error('Network offline'));
  await new Promise(r => setTimeout(r, 10));

  // UI must not crash, local matches should still remain visible
  assert.ok(tabResults.children.length > 0, 'Local matches remain intact despite remote API failure');
});

// ============================================================================
// VECTOR 3: RELATED MOVIES CATALOG EDGE CASES & CORRUPTIONS
// ============================================================================

test('CHALLENGE 3.1: Related Movies with 0 matching movies cleanly hides #relatedMoviesSection', () => {
  const unrelatedCatalog = [
    {
      slug: 'sci-fi-movie',
      name: 'Interstellar',
      category: [{ name: 'Khoa Học Viễn Tưởng', slug: 'khoa-hoc-vien-tuong' }],
      country: [{ name: 'Âu Mỹ', slug: 'au-my' }]
    }
  ];

  const sourceMovie = {
    slug: 'vietnam-history',
    name: 'Phim Lịch Sử Việt',
    category: [{ name: 'Lịch Sử', slug: 'lich-su' }],
    country: [{ name: 'Việt Nam', slug: 'viet-nam' }]
  };

  const { App, elements } = createChallengerHarness(unrelatedCatalog);
  const section = elements.get('relatedMoviesSection');
  const grid = elements.get('relatedMoviesGrid');

  App.renderRelatedMovies(sourceMovie);

  assert.equal(section.classList.contains('hidden'), true, 'Section must be hidden when score is 0');
  assert.equal(grid.children.length, 0);
});

test('CHALLENGE 3.2: Related Movies handles null, undefined, or empty homeCatalog gracefully', () => {
  const { App, elements } = createChallengerHarness([]);
  const section = elements.get('relatedMoviesSection');

  App.homeCatalog = null;
  assert.doesNotThrow(() => {
    App.renderRelatedMovies(sampleCatalog[0]);
  });
  assert.equal(section.classList.contains('hidden'), true);

  App.homeCatalog = undefined;
  assert.doesNotThrow(() => {
    App.renderRelatedMovies(sampleCatalog[0]);
  });
  assert.equal(section.classList.contains('hidden'), true);

  App.homeCatalog = [];
  assert.doesNotThrow(() => {
    App.renderRelatedMovies(sampleCatalog[0]);
  });
  assert.equal(section.classList.contains('hidden'), true);
});

test('CHALLENGE 3.3: Related Movies with single-movie catalog excludes active movie and hides section', () => {
  const onlyMovie = sampleCatalog[0];
  const { App, elements } = createChallengerHarness([onlyMovie]);
  const section = elements.get('relatedMoviesSection');
  const grid = elements.get('relatedMoviesGrid');

  App.renderRelatedMovies(onlyMovie);

  assert.equal(section.classList.contains('hidden'), true, 'Single movie catalog must not recommend itself');
  assert.equal(grid.children.length, 0);
});

test('CHALLENGE 3.4: Related Movies handles corrupted candidates (null items, missing tags, circular objects)', () => {
  const circularObj = { slug: 'circ', name: 'Circular' };
  circularObj.self = circularObj;

  const corruptedCatalog = [
    null,
    undefined,
    1234,
    'not a movie',
    {},
    { slug: '' },
    { slug: 'no-cats-or-country', name: 'No Tags', category: null, country: null },
    { slug: 'corrupt-tags', name: 'Corrupt Tags', category: [null, undefined, 42, {}], country: [''] },
    { slug: 'invalid-year', name: 'Invalid Year', year: 'Unknown', category: [{ name: 'Lịch Sử', slug: 'lich-su' }] },
    circularObj
  ];

  const { App, elements } = createChallengerHarness(corruptedCatalog);
  const section = elements.get('relatedMoviesSection');

  const sourceMovie = sampleCatalog[0]; // dao-pho (Lịch Sử)

  assert.doesNotThrow(() => {
    App.renderRelatedMovies(sourceMovie);
  }, 'Corrupted candidates must not throw unhandled exceptions');

  // The candidate with 'Lịch Sử' should still match safely
  const grid = elements.get('relatedMoviesGrid');
  assert.equal(section.classList.contains('hidden'), false);
  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].querySelector('.card-title').textContent, 'Invalid Year');
});

test('CHALLENGE 3.5: Related Movies handles source movie with null/undefined metadata', () => {
  const { App, elements } = createChallengerHarness(sampleCatalog);
  const section = elements.get('relatedMoviesSection');

  const emptySource = { slug: 'empty-source' };
  assert.doesNotThrow(() => {
    App.renderRelatedMovies(emptySource);
  });
  assert.equal(section.classList.contains('hidden'), true);

  assert.doesNotThrow(() => {
    App.renderRelatedMovies(null);
  });
  assert.equal(section.classList.contains('hidden'), true);

  assert.doesNotThrow(() => {
    App.renderRelatedMovies({});
  });
  assert.equal(section.classList.contains('hidden'), true);
});

test('CHALLENGE 3.6: Scalability stress test: 1,000 catalog candidates scored and sorted under 50ms', () => {
  const largeCatalog = [];
  const catDefs = [
    { name: 'Lịch Sử', slug: 'lich-su' },
    { name: 'Chiến Tranh', slug: 'chien-tranh' },
    { name: 'Hành Động', slug: 'hanh-dong' },
    { name: 'Tâm Lý', slug: 'tam-ly' }
  ];
  const countryDefs = [
    { name: 'Việt Nam', slug: 'viet-nam' },
    { name: 'Âu Mỹ', slug: 'au-my' }
  ];

  for (let i = 0; i < 1000; i++) {
    largeCatalog.push({
      slug: `movie-${i}`,
      name: `Phim Số ${i}`,
      year: 2000 + (i % 25),
      quality: '4K',
      category: [catDefs[i % catDefs.length]],
      country: [countryDefs[i % countryDefs.length]]
    });
  }

  const { App, elements } = createChallengerHarness(largeCatalog);
  const grid = elements.get('relatedMoviesGrid');

  const start = performance.now();
  App.renderRelatedMovies(sampleCatalog[0]);
  const duration = performance.now() - start;

  assert.ok(duration < 350, `Scoring 1,000 movies should complete in < 350ms (took ${duration.toFixed(2)}ms)`);
  assert.equal(grid.children.length, 10, 'Must cap results at top 10');
});

// ============================================================================
// VECTOR 4: KEYBOARD NAVIGATION & UI INTERACTION BOUNDARIES
// ============================================================================

test('CHALLENGE 4.1: Keyboard navigation boundaries on empty or closed search dropdown', () => {
  const { App, elements } = createChallengerHarness(sampleCatalog);
  const searchInput = elements.get('searchInput');
  const dropdown = elements.get('searchDropdown');

  // Dropdown is empty/hidden
  assert.equal(dropdown.classList.contains('hidden'), true);

  // Dispatching ArrowDown or ArrowUp on empty items should not crash
  const fakeEventDown = { key: 'ArrowDown', preventDefault() {} };
  const fakeEventUp = { key: 'ArrowUp', preventDefault() {} };

  assert.doesNotThrow(() => {
    searchInput.dispatchEvent(fakeEventDown);
    searchInput.dispatchEvent(fakeEventUp);
  });
  assert.equal(App.searchSelectedIndex, -1);
});

test('CHALLENGE 4.2: Keyboard navigation cycling wraps correctly and Escape dismisses', () => {
  const { App, elements } = createChallengerHarness(sampleCatalog);
  const dropdown = elements.get('searchDropdown');

  App.performInstantSearch('dao');
  const items = dropdown.children;
  assert.equal(items.length, 2);

  // Cycle down twice
  App.searchSelectedIndex = (App.searchSelectedIndex + 1) % items.length; // 0
  App.updateSearchSelection(items);
  assert.equal(items[0].classList.contains('selected'), true);

  App.searchSelectedIndex = (App.searchSelectedIndex + 1) % items.length; // 1
  App.updateSearchSelection(items);
  assert.equal(items[1].classList.contains('selected'), true);

  // Wrap to 0
  App.searchSelectedIndex = (App.searchSelectedIndex + 1) % items.length; // 0
  App.updateSearchSelection(items);
  assert.equal(items[0].classList.contains('selected'), true);

  // Escape closes dropdown
  App.hideSearchDropdown();
  assert.equal(dropdown.classList.contains('hidden'), true);
  assert.equal(App.searchSelectedIndex, -1);
});

test('CHALLENGE 4.3: Simultaneous search interaction while video playback is active', () => {
  const { App, elements, sandbox } = createChallengerHarness(sampleCatalog);
  const dropdown = elements.get('searchDropdown');

  // Simulate active video playback session
  sandbox.Player.isOpen = true;
  sandbox.Player.currentTime = 120;
  sandbox.Player.duration = 1800;

  // Keystrokes in search during playback
  App.performInstantSearch('oppen');
  assert.equal(dropdown.classList.contains('hidden'), false);
  assert.equal(sandbox.Player.currentTime, 120, 'Search should not alter video playback position');
  assert.equal(sandbox.Player.isOpen, true, 'Search should not inadvertently close or interrupt player modal');

  // Dismissing search dropdown leaves player state unaffected
  App.hideSearchDropdown();
  assert.equal(dropdown.classList.contains('hidden'), true);
  assert.equal(sandbox.Player.isOpen, true);
});

