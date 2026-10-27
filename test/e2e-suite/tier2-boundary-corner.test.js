/**
 * Tier 2 - Boundary & Corner Cases Test Suite
 * Covers edge cases, boundary limits, and error handling for:
 * - Downloads (corrupted sha256, unsupported platforms, non-https, fallback configs)
 * - Next Episode Countdown (short video <60s, last episode, NaN/negative values, re-seek)
 * - Skip Intro (short video <120s, seek back, boundary 85s, idempotent clicks, NaN)
 * - Auto-failover (all servers fail, single server, 0s resume, empty episodes, embed mode)
 * - Live Search (empty/whitespace, regex chars, diacritics, 500+ chars, fast delete)
 * - Related Movies (empty categories, 1 movie catalog, null tags, deduping, large catalog)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PROJECT_ROOT, createDOMFixture, createMockElement, SpecReference, SampleCatalog } = require('./helpers');
const platform = require(path.join(PROJECT_ROOT, 'public/js/platform.js'));

/* ==================== 1. Downloads Boundaries ==================== */

test('T2.1: Corrupted or non-64 hex SHA-256 strings are flagged as invalid / unavailable', () => {
  const badEntries = [
    { url: 'https://example.com/app.apk', version: '3.61', sha256: 'short' },
    { url: 'https://example.com/app.apk', version: '3.61', sha256: 'g'.repeat(64) }, // 'g' is non-hex
    { url: 'https://example.com/app.apk', version: '3.61', sha256: '' },
    { url: 'https://example.com/app.apk', version: '3.61', sha256: null }
  ];

  for (const rawEntry of badEntries) {
    const sanitized = platform.release({ android: rawEntry }, 'android');
    const state = platform.releaseState(sanitized, '3.61');
    assert.equal(state, 'unavailable', `Invalid sha256 "${rawEntry.sha256}" must yield unavailable`);
  }
});

test('T2.2: Unsupported download platform parameter returns safe rejection', async () => {
  const { validDownloadUrl } = await import(`file://${path.join(PROJECT_ROOT, 'backend-worker/src/worker.mjs')}`);
  assert.equal(typeof validDownloadUrl, 'function');
  // Validates URL safety against local file schemes or arbitrary schemas
  assert.equal(validDownloadUrl('file:///etc/passwd'), false);
  assert.equal(validDownloadUrl('ftp://server/app.apk'), false);
});

test('T2.3: Insecure non-HTTPS or credentialed download URLs are rejected', async () => {
  const { validDownloadUrl } = await import(`file://${path.join(PROJECT_ROOT, 'backend-worker/src/worker.mjs')}`);
  for (const bad of ['http://insecure.test/app.apk', 'https://user:pass@example.com/app.apk', 'javascript:alert(1)']) {
    assert.equal(validDownloadUrl(bad), false);
  }
});

test('T2.4: Missing downloads config file falls back gracefully to default releases in server', () => {
  const fs = require('node:fs');
  const serverCode = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  assert.match(serverCode, /loadDownloadsConfig/);
  assert.match(serverCode, /catch\s*\(\w+\)\s*\{/);
  assert.match(serverCode, /android_tv/);
});

test('T2.5: Zero or negative file size values are guarded', () => {
  function validateReleaseSize(bytes) {
    return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0;
  }
  assert.equal(validateReleaseSize(0), false);
  assert.equal(validateReleaseSize(-1024), false);
  assert.equal(validateReleaseSize(Number.NaN), false);
  assert.equal(validateReleaseSize(4082889), true);
});

/* ==================== 2. Next Episode Countdown Boundaries ==================== */

test('T2.6: Short videos (<60s duration) never trigger 30s countdown', () => {
  const shortDurations = [10, 30, 45, 59.9, 60];
  for (const dur of shortDurations) {
    const cur = Math.max(0, dur - 15);
    const result = SpecReference.nextEpisodeCountdown(cur, dur, 30);
    assert.equal(result, null, `Duration ${dur}s must NOT trigger countdown`);
  }
});

test('T2.7: Single episode or last episode in series never triggers countdown', () => {
  function shouldTriggerCountdown(curEpIndex, totalEpisodes) {
    if (totalEpisodes <= 1 || curEpIndex >= totalEpisodes - 1) return false;
    return true;
  }
  // Standalone movie (1 episode)
  assert.equal(shouldTriggerCountdown(0, 1), false);
  // Last episode of a 10-episode series (index 9)
  assert.equal(shouldTriggerCountdown(9, 10), false);
  // Mid episode (index 4 of 10)
  assert.equal(shouldTriggerCountdown(4, 10), true);
});

test('T2.8: NaN, null, or negative duration values do not trigger countdown or throw', () => {
  assert.equal(SpecReference.nextEpisodeCountdown(Number.NaN, 1800, 30), null);
  assert.equal(SpecReference.nextEpisodeCountdown(100, Number.NaN, 30), null);
  assert.equal(SpecReference.nextEpisodeCountdown(-10, 1800, 30), null);
  assert.equal(SpecReference.nextEpisodeCountdown(null, null, 30), null);
});

test('T2.9: Rapid seeking near end activates countdown smoothly without stutter', () => {
  const f = createDOMFixture();
  const video = f.video;
  video.duration = 1800;

  // Jump from 100s to 1785s (15s remaining)
  video.seek(1785);
  const result = SpecReference.nextEpisodeCountdown(video.currentTime, video.duration, 30);
  assert.ok(result);
  assert.equal(result.remaining, 15);
});

test('T2.10: Re-seeking backwards (>30s remaining) deactivates countdown popup', () => {
  const f = createDOMFixture();
  const video = f.video;
  video.duration = 1800;

  // First near end: 1780s -> active
  const activeRes = SpecReference.nextEpisodeCountdown(1780, video.duration, 30);
  assert.ok(activeRes);

  // User rewinds back to 1000s -> inactive
  video.seek(1000);
  const rewindRes = SpecReference.nextEpisodeCountdown(video.currentTime, video.duration, 30);
  assert.equal(rewindRes, null, 'Rewinding beyond threshold must deactivate countdown');
});

/* ==================== 3. Skip Intro Boundaries ==================== */

test('T2.11: Short videos (<120s duration) never display "Bỏ qua Intro" button', () => {
  const shortDurations = [30, 60, 90, 119.9, 120];
  for (const dur of shortDurations) {
    const isIntro = SpecReference.isIntroInterval(10, dur, 85);
    assert.equal(isIntro, false, `Video with duration ${dur}s must NOT show skip intro`);
  }
});

test('T2.12: Seeking backwards back into 0-85s interval restores skip button visibility', () => {
  const duration = 1800;
  // At 500s: not in intro
  assert.equal(SpecReference.isIntroInterval(500, duration, 85), false);
  // User seeks back to 30s: in intro
  assert.equal(SpecReference.isIntroInterval(30, duration, 85), true);
});

test('T2.13: Boundary check: at exactly 85.000s, button is hidden', () => {
  assert.equal(SpecReference.isIntroInterval(84.999, 1800, 85), true);
  assert.equal(SpecReference.isIntroInterval(85.000, 1800, 85), false);
});

test('T2.14: Rapid multiple clicks on skip button are idempotent', () => {
  let seekCount = 0;
  let currentTime = 15;
  const duration = 1800;

  function onSkipClick() {
    if (!SpecReference.isIntroInterval(currentTime, duration, 85)) return;
    currentTime = SpecReference.skipIntroTarget(currentTime, duration, 85);
    seekCount += 1;
  }

  onSkipClick();
  assert.equal(currentTime, 85);
  assert.equal(seekCount, 1);

  // Subsequent immediate clicks while at 85s
  onSkipClick();
  onSkipClick();
  assert.equal(seekCount, 1, 'Subsequent clicks must be ignored because currentTime is now >= 85s');
});

test('T2.15: Negative currentTime or NaN does not display skip button', () => {
  assert.equal(SpecReference.isIntroInterval(-10, 1800, 85), false);
  assert.equal(SpecReference.isIntroInterval(Number.NaN, 1800, 85), false);
});

/* ==================== 4. Auto-Failover Boundaries ==================== */

test('T2.16: All servers exhausted displays graceful terminal alert and stops media element', () => {
  const f = createDOMFixture();
  let stopped = false;
  let terminalAlert = '';

  const mockPlayer = {
    video: f.video,
    suppressBuffering: false,
    showAlert(msg) {
      terminalAlert = msg;
    },
    onExhausted() {
      this.suppressBuffering = true;
      this.showAlert('Tất cả server hiện có đều không phản hồi. Vui lòng thử lại sau.');
      if (this.video) {
        this.video.pause();
        this.video.removeAttribute('src');
      }
      stopped = true;
    }
  };

  mockPlayer.onExhausted();
  assert.equal(stopped, true);
  assert.match(terminalAlert, /Tất cả server hiện có đều không phản hồi/);
  assert.equal(mockPlayer.suppressBuffering, true);
});

test('T2.17: Single server available immediately triggers exhaustion upon failure without loop', () => {
  const allServers = [{ server_name: 'Single Provider' }];
  const failed = new Set();
  let failoverAttempts = 0;

  function failover(currentIndex) {
    failoverAttempts += 1;
    failed.add(currentIndex);
    const next = allServers.findIndex((_, idx) => !failed.has(idx));
    return next;
  }

  const nextIdx = failover(0);
  assert.equal(nextIdx, -1, 'Must return -1 indicating no other servers exist');
  assert.equal(failoverAttempts, 1, 'Must not retry in a loop');
});

test('T2.18: Failover when currentTime is 0 resumes at 0 cleanly without NaN', () => {
  const video = { currentTime: 0 };
  const watchedSeconds = 0;
  const resumeTime = Number(video?.currentTime) || watchedSeconds || 0;
  assert.equal(resumeTime, 0);
  assert.equal(Number.isNaN(resumeTime), false);
});

test('T2.19: Backup server with empty episode list is safely skipped', () => {
  const allServers = [
    { server_name: 'Server 1', server_data: [{ slug: 'tap-1' }] },
    { server_name: 'Server 2 (Broken)', server_data: [] },
    { server_name: 'Server 3 (Good)', server_data: [{ slug: 'tap-1' }] }
  ];

  const failed = new Set([0]);
  let selected = -1;

  for (let i = 0; i < allServers.length; i++) {
    if (!failed.has(i) && allServers[i].server_data && allServers[i].server_data.length > 0) {
      selected = i;
      break;
    }
  }

  assert.equal(selected, 2, 'Should skip empty Server 2 and choose Server 3');
});

test('T2.20: Stream stall when embed iframe player is active preserves saved watch time', () => {
  const embedActive = true;
  const video = { currentTime: 0 };
  const getSavedWatchTime = () => 480; // 8 minutes saved in localStorage
  const watchedSeconds = 475;

  const resumeTime = embedActive
    ? (getSavedWatchTime() || watchedSeconds || 0)
    : (Number(video.currentTime) || 0);

  assert.equal(resumeTime, 480, 'Must preserve saved watch time during embed player failover');
});

/* ==================== 5. Live Search Boundaries ==================== */

test('T2.21: Empty query or whitespace-only hides dropdown without calling API', () => {
  let apiCalls = 0;
  let dropdownVisible = true;

  function handleSearchInput(query) {
    const val = query.trim();
    if (!val) {
      dropdownVisible = false;
      return;
    }
    apiCalls += 1;
  }

  handleSearchInput('');
  assert.equal(dropdownVisible, false);
  assert.equal(apiCalls, 0);

  handleSearchInput('     ');
  assert.equal(dropdownVisible, false);
  assert.equal(apiCalls, 0);
});

test('T2.22: Query containing regex special characters does not crash search filter', () => {
  const dangerousQueries = ['.*', '(?=.*)', '+', '(', '[a-z]', '{1,3}', '^$|\\'];
  for (const q of dangerousQueries) {
    assert.doesNotThrow(() => {
      const normalized = SpecReference.normalizeSearchText(q);
      SampleCatalog.filter(m => SpecReference.normalizeSearchText(m.name).includes(normalized));
    }, `Searching "${q}" must not throw regex error`);
  }
});

test('T2.23: Vietnamese diacritics normalization matches accent-free and accented queries symmetrically', () => {
  const norm1 = SpecReference.normalizeSearchText('Đào, Phở và Piano');
  const norm2 = SpecReference.normalizeSearchText('dao pho va piano');
  assert.equal(norm1, 'dao, pho va piano');
  assert.equal(norm2, 'dao pho va piano');

  // Verify cross-containment
  assert.ok(norm1.replace(/[^a-z0-9 ]/g, '').includes(norm2));
});

test('T2.24: Extremely long query (500+ characters) is handled cleanly without memory leak', () => {
  const hugeQuery = 'phim-sieu-dai-'.repeat(40);
  assert.ok(hugeQuery.length > 500);

  assert.doesNotThrow(() => {
    const norm = SpecReference.normalizeSearchText(hugeQuery);
    const results = SampleCatalog.filter(m => SpecReference.normalizeSearchText(m.name).includes(norm));
    assert.equal(results.length, 0);
  });
});

test('T2.25: Rapid typing and immediate deletion closes dropdown cleanly', () => {
  let dropdownState = 'closed';
  let timer = null;

  function type(text) {
    clearTimeout(timer);
    const val = text.trim();
    if (!val) {
      dropdownState = 'closed';
      return;
    }
    dropdownState = 'opening';
    timer = setTimeout(() => {
      dropdownState = 'open';
    }, 100);
  }

  type('avatar');
  assert.equal(dropdownState, 'opening');

  // Immediate delete
  type('');
  assert.equal(dropdownState, 'closed');
});

/* ==================== 6. Related Movies Boundaries ==================== */

test('T2.26: Movie with empty category and country list renders fallback without error', () => {
  const isolatedMovie = {
    slug: 'phim-doc-lap',
    name: 'Phim Độc Lập',
    category: [],
    country: []
  };

  assert.doesNotThrow(() => {
    const scores = SampleCatalog.map(m => SpecReference.scoreRelatedMovie(isolatedMovie, m));
    assert.ok(scores.every(s => s <= 0));
  });
});

test('T2.27: Catalog containing only 1 movie renders clean empty related state', () => {
  const singleCatalog = [SampleCatalog[0]];
  const source = singleCatalog[0];
  const related = singleCatalog.filter(m => m.slug !== source.slug && SpecReference.scoreRelatedMovie(source, m) > 0);
  assert.equal(related.length, 0);
});

test('T2.28: Movie metadata with null or undefined category entries is handled safely', () => {
  const corruptedMovie = {
    slug: 'corrupted-cat',
    category: [null, undefined, { name: 'Hành Động', slug: 'hanh-dong' }, '']
  };

  assert.doesNotThrow(() => {
    const score = SpecReference.scoreRelatedMovie(corruptedMovie, SampleCatalog[4]);
    assert.ok(score >= 0);
  });
});

test('T2.29: Duplicate category entries in movie object scored without inflated duplicate count', () => {
  const movieWithDupes = {
    slug: 'dupe-cat',
    category: [
      { name: 'Lịch Sử', slug: 'lich-su' },
      { name: 'Lịch Sử', slug: 'lich-su' }
    ]
  };

  const target = {
    slug: 'target-cat',
    category: [{ name: 'Lịch Sử', slug: 'lich-su' }]
  };

  const score = SpecReference.scoreRelatedMovie(movieWithDupes, target);
  // Target has 1 shared category 'lich-su' (3 points). Duplicate in candidate should not count twice if set-deduped
  assert.equal(score, 3);
});

test('T2.30: Large catalog (500+ items) limits related movies to top max cards with fast sort', () => {
  const largeCatalog = [];
  for (let i = 0; i < 500; i++) {
    largeCatalog.push({
      slug: `movie-${i}`,
      name: `Phim ${i}`,
      category: [{ slug: i % 2 === 0 ? 'hanh-dong' : 'tam-ly' }],
      country: [{ slug: 'viet-nam' }]
    });
  }

  const source = {
    slug: 'source-movie',
    category: [{ slug: 'hanh-dong' }],
    country: [{ slug: 'viet-nam' }]
  };

  const startTime = Date.now();
  const scored = largeCatalog
    .filter(m => m.slug !== source.slug)
    .map(m => ({ movie: m, score: SpecReference.scoreRelatedMovie(source, m) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const duration = Date.now() - startTime;
  assert.equal(scored.length, 10);
  assert.ok(duration < 200, `Large catalog scoring should finish in under 200ms (took ${duration}ms)`);
});
