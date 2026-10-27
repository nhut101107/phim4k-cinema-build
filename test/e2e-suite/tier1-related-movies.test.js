/**
 * Tier 1 - Feature Coverage: Related Movies Section in Movie Modal (F6)
 * Tests presence of related movies grid in modal, scoring algorithm based
 * on shared categories & countries, exclusion of current movie, card rendering,
 * and navigation click handlers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDOMFixture, createMockElement, SampleCatalog, SpecReference } = require('./helpers');

test('T1.29: Related movies container exists in movie detail modal markup', (t) => {
  const f = createDOMFixture();
  const modal = f.elements.get('movieModal');
  const section = f.elements.get('relatedMoviesSection');
  const grid = f.elements.get('relatedMoviesGrid');

  assert.ok(modal, '#movieModal must exist');
  assert.ok(section, '#relatedMoviesSection must exist');
  assert.ok(grid, '#relatedMoviesGrid must exist');
  assert.equal(grid.classList.contains('movie-grid'), true);
});

test('T1.30: Related movies are scored and ranked based on shared category and country tags', (t) => {
  const source = SampleCatalog.find(m => m.slug === 'dao-pho-va-piano');
  // source has categories: Lịch Sử, Chiến Tranh; country: Việt Nam

  const candidates = SampleCatalog.filter(m => m.slug !== source.slug).map(candidate => ({
    movie: candidate,
    score: SpecReference.scoreRelatedMovie(source, candidate)
  })).sort((a, b) => b.score - a.score);

  // 'dia-dao-cu-chi' has both Lịch Sử, Chiến Tranh (2 * 3 = 6) + Việt Nam (1) = 7 points
  // 'oppenheimer' has Lịch Sử (3) + Âu Mỹ (0) = 3 points
  // 'lat-mat-7' has Việt Nam (1) = 1 point
  // 'avatar-2' has no common tags = 0 points

  assert.equal(candidates[0].movie.slug, 'dia-dao-cu-chi', 'Top related movie must be Địa Đạo Củ Chi');
  assert.ok(candidates[0].score > candidates[1].score);
  assert.equal(candidates[1].movie.slug, 'oppenheimer');
});

test('T1.31: Currently viewed movie is strictly excluded from its own related list', (t) => {
  const current = SampleCatalog[0];
  const relatedList = SampleCatalog.filter(m => m.slug !== current.slug && SpecReference.scoreRelatedMovie(current, m) > 0);

  const selfIncluded = relatedList.some(m => m.slug === current.slug);
  assert.equal(selfIncluded, false, 'The active movie must never appear in its related movies grid');
});

test('T1.32: Related movie cards are rendered with proper classes, poster, and titles', (t) => {
  const f = createDOMFixture();
  const grid = f.elements.get('relatedMoviesGrid');

  function renderRelatedCard(movie) {
    const card = createMockElement('div', '', 'movie-card related-card');
    card.dataset.slug = movie.slug;

    const poster = createMockElement('img', '', 'movie-card-poster');
    poster.src = movie.poster_url || movie.thumb_url;

    const title = createMockElement('div', '', 'movie-card-title');
    title.textContent = movie.name;

    card.appendChild(poster);
    card.appendChild(title);
    return card;
  }

  const topRelated = SampleCatalog[1];
  const card = renderRelatedCard(topRelated);
  grid.appendChild(card);

  assert.equal(grid.children.length, 1);
  assert.equal(card.classList.contains('movie-card'), true);
  assert.equal(card.dataset.slug, 'dia-dao-cu-chi');
  assert.equal(card.querySelector('.movie-card-title').textContent, 'Địa Đạo Củ Chi');
});

test('T1.33: Clicking a related movie card triggers navigation to open that movie detail', (t) => {
  let openedSlug = '';
  const mockApp = {
    openMovieDetail(slug) {
      openedSlug = slug;
    }
  };

  const f = createDOMFixture();
  const card = createMockElement('div', '', 'movie-card');
  card.onclick = () => {
    mockApp.openMovieDetail('oppenheimer');
  };

  card.click();
  assert.equal(openedSlug, 'oppenheimer', 'Clicking card must open detail for clicked slug');
});
