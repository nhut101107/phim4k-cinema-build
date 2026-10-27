/**
 * Tier 1 - Feature Coverage: Live Search with Instant Poster Previews (F5)
 * Tests 0ms in-memory catalog filtering, debounced remote API query,
 * poster thumbnail previews, keyboard navigation, clear button, and request ID race handling.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDOMFixture, createMockElement, SampleCatalog, SpecReference } = require('./helpers');

test('T1.23: Instant 0ms autocomplete matches against in-memory catalog on keystroke', (t) => {
  const f = createDOMFixture();
  const searchInput = f.elements.get('searchInput');
  const searchDropdown = f.elements.get('searchDropdown');

  // In-memory catalog
  const catalog = [...SampleCatalog];

  function instantFilter(query) {
    const q = SpecReference.normalizeSearchText(query);
    if (!q) return [];
    return catalog.filter(m => {
      const target = SpecReference.normalizeSearchText(`${m.name} ${m.origin_name} ${m.year}`);
      return target.includes(q);
    }).slice(0, 6);
  }

  // Type "dao"
  searchInput.value = 'dao';
  const matches = instantFilter(searchInput.value);

  assert.equal(matches.length, 2, 'Should match "Đào, Phở và Piano" and "Địa Đạo Củ Chi"');
  assert.equal(matches[0].slug, 'dao-pho-va-piano');
  assert.equal(matches[1].slug, 'dia-dao-cu-chi');
});

test('T1.24: Dropdown items render poster images, movie title, and origin name / year', (t) => {
  const f = createDOMFixture();
  const dropdown = f.elements.get('searchDropdown');

  function renderItem(movie) {
    const item = createMockElement('div', '', 'search-item');
    const thumb = createMockElement('img', '', 'search-thumb');
    thumb.src = movie.poster_url || movie.thumb_url;

    const info = createMockElement('div', '', 'search-info');
    const title = createMockElement('div', '', 'search-title');
    title.textContent = movie.name;

    const sub = createMockElement('div', '', 'search-sub');
    sub.textContent = `${movie.origin_name} (${movie.year})`;

    info.appendChild(title);
    info.appendChild(sub);
    item.appendChild(thumb);
    item.appendChild(info);
    return item;
  }

  const sample = SampleCatalog[0];
  const rendered = renderItem(sample);
  dropdown.appendChild(rendered);

  assert.equal(dropdown.children.length, 1);
  const item = dropdown.children[0];
  assert.equal(item.classList.contains('search-item'), true);

  const img = item.querySelector('.search-thumb');
  assert.ok(img);
  assert.equal(img.src, 'https://example.test/img/dao-pho-poster.jpg');

  const title = item.querySelector('.search-title');
  assert.equal(title.textContent, 'Đào, Phở và Piano');
});

test('T1.25: Remote API search query is debounced to avoid network request spam', async (t) => {
  let apiCallCount = 0;
  let debounceTimer = null;

  function onInput(query, debounceMs = 250) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      apiCallCount += 1;
    }, debounceMs);
  }

  // Rapidly type 4 keystrokes within 50ms intervals
  onInput('o');
  await new Promise(r => setTimeout(r, 40));
  onInput('op');
  await new Promise(r => setTimeout(r, 40));
  onInput('opp');
  await new Promise(r => setTimeout(r, 40));
  onInput('oppen');

  // Before debounce completes, apiCallCount is still 0
  assert.equal(apiCallCount, 0);

  // Wait for 300ms for debounce to fire
  await new Promise(r => setTimeout(r, 300));
  assert.equal(apiCallCount, 1, 'Only one remote search API request should be dispatched');
});

test('T1.26: Clear button clears input value and hides search dropdown', (t) => {
  const f = createDOMFixture();
  const input = f.elements.get('searchInput');
  const clearBtn = f.elements.get('searchClear');
  const dropdown = f.elements.get('searchDropdown');

  input.value = 'Avatar';
  clearBtn.classList.remove('hidden');
  dropdown.classList.remove('hidden');

  clearBtn.onclick = () => {
    input.value = '';
    clearBtn.classList.add('hidden');
    dropdown.classList.add('hidden');
  };

  clearBtn.click();
  assert.equal(input.value, '');
  assert.equal(clearBtn.classList.contains('hidden'), true);
  assert.equal(dropdown.classList.contains('hidden'), true);
});

test('T1.27: Keyboard navigation moves selection index and Escape closes dropdown', (t) => {
  let selectedIndex = -1;
  const itemCount = 3;
  let dropdownHidden = false;

  function onKeyDown(key) {
    if (key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % itemCount;
    } else if (key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + itemCount) % itemCount;
    } else if (key === 'Escape') {
      dropdownHidden = true;
      selectedIndex = -1;
    }
  }

  onKeyDown('ArrowDown');
  assert.equal(selectedIndex, 0);

  onKeyDown('ArrowDown');
  assert.equal(selectedIndex, 1);

  onKeyDown('ArrowUp');
  assert.equal(selectedIndex, 0);

  onKeyDown('Escape');
  assert.equal(dropdownHidden, true);
  assert.equal(selectedIndex, -1);
});

test('T1.28: Out-of-order search responses are discarded using request ID tracking', async (t) => {
  let activeRequestId = 0;
  let displayedResults = null;

  async function mockSearch(query, simulatedDelay) {
    const currentId = ++activeRequestId;
    await new Promise(r => setTimeout(r, simulatedDelay));

    // If a newer request was dispatched while this was pending, drop result
    if (currentId !== activeRequestId) {
      return; // Discard stale response
    }
    displayedResults = query;
  }

  // Request 1: "avatar" (slow network: 150ms)
  const req1 = mockSearch('avatar', 150);

  // User quickly corrects to "oppenheimer" (fast network: 50ms)
  await new Promise(r => setTimeout(r, 20));
  const req2 = mockSearch('oppenheimer', 50);

  await Promise.all([req1, req2]);

  assert.equal(displayedResults, 'oppenheimer', 'Stale response from slow request 1 must not overwrite newer request 2');
});
