import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const index = read('public/index.html');
const app = read('public/js/app.js');
const coverflow = read('public/js/coverflow.js');
const runtime = read('public/js/runtime-config.js');
const css = read('public/css/mnhut-projection.css');

test('account experience uses server-owned viewing stats and library data', () => {
  assert.match(coverflow, /API\.getAccountOverview\(\)/);
  assert.match(coverflow, /API\.saveLibraryMovie\(movie, list\)/);
  assert.match(coverflow, /API\.removeLibraryMovie\(movie\.slug, list\)/);
  assert.match(coverflow, /stats\.watchedSeconds/);
  assert.doesNotMatch(index, />120<|>37<|>12<\/strong><small>Ngày liên tiếp/);
  assert.match(runtime, /\/api\/account\/overview/);
  assert.match(runtime, /\/api\/account\/library/);
});

test('mood discovery and saved lists contain only catalog movies', () => {
  assert.match(index, /id="moodDiscovery"/);
  assert.match(app, /this\.homeCatalog\.filter/);
  assert.match(app, /showPersonalLibrary\(libraryItems = \[\], list = 'watchlist'\)/);
  assert.match(app, /API\.getDetail\(item\.slug\)/);
  assert.match(app, /AccountExperience\?\.updateDetailButtons/);
});

test('each mood uses its own real genres and rotates away from the previous selection', () => {
  assert.match(app, /expectedTags = new Set\(definition\.tags\.map/);
  assert.match(app, /const matches = this\.homeCatalog\.filter/);
  assert.doesNotMatch(app, /matches\.length >= 6 \? matches : this\.homeCatalog/);
  assert.match(app, /lastMoodSelections\.get\(mood\)/);
  assert.match(app, /const unseen = randomized\.filter/);
  assert.match(app, /this\.shuffleMovies\(matches\)/);
});

test('adaptive effects preserve reduced-motion and low-power paths', () => {
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /navigator\.hardwareConcurrency/);
  assert.match(app, /navigator\.deviceMemory/);
  assert.match(app, /navigator\.connection\?\.saveData/);
  assert.match(css, /body\[data-motion-tier="low"\]/);
  assert.match(css, /content-visibility: auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('visible home branding stays compact instead of repeating a wordmark strip', () => {
  assert.doesNotMatch(css, /content:\s*"MNHUT ORIGINAL SELECTION/);
  assert.doesNotMatch(css, /content:\s*"MNHUT FEATURE/);
  assert.doesNotMatch(index, /MNHUT MASTER/);
  assert.match(index, /class="brand-avatar mnhut-brand-chip"/);
});
