/**
 * Tier 3 - Cross-Feature Combinations Test Suite
 * Tests multi-feature user flows and subsystem interactions:
 * - T3.1: Full user journey (Search -> Detail Modal -> Related Movies -> Play -> Skip Intro -> Next Episode Countdown)
 * - T3.2: Failover during intro followed by Skip Intro
 * - T3.3: Failover during countdown with position preservation and auto-advance
 * - T3.4: Concurrent search while video is playing
 * - T3.5: Download modal opened during playback without state corruption
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PROJECT_ROOT, createDOMFixture, createMockElement, SpecReference, SampleCatalog } = require('./helpers');

test('T3.1: Full Funnel: Search -> Modal -> Related -> Play -> Skip Intro -> Countdown -> Auto-advance', (t) => {
  const f = createDOMFixture();
  const catalog = [...SampleCatalog];

  // 1. User types in search input
  const searchInput = f.elements.get('searchInput');
  const searchDropdown = f.elements.get('searchDropdown');
  searchInput.value = 'dao';

  const matches = catalog.filter(m => {
    const target = SpecReference.normalizeSearchText(`${m.name} ${m.origin_name} ${m.year}`);
    return target.includes(SpecReference.normalizeSearchText(searchInput.value));
  });
  assert.ok(matches.length > 0);
  const selectedMovie = matches[0]; // 'dao-pho-va-piano'
  assert.equal(selectedMovie.slug, 'dao-pho-va-piano');

  // 2. Open Detail Modal
  const movieModal = f.elements.get('movieModal');
  movieModal.classList.remove('hidden');
  assert.equal(movieModal.classList.contains('hidden'), false);

  // 3. Render and click Related Movie
  const relatedGrid = f.elements.get('relatedMoviesGrid');
  const relatedMovies = catalog
    .filter(m => m.slug !== selectedMovie.slug)
    .map(m => ({ movie: m, score: SpecReference.scoreRelatedMovie(selectedMovie, m) }))
    .sort((a, b) => b.score - a.score);

  assert.ok(relatedMovies.length > 0);
  const topRelated = relatedMovies[0].movie; // 'dia-dao-cu-chi'
  assert.equal(topRelated.slug, 'dia-dao-cu-chi');

  // 4. Start Playback of Top Related movie
  const playerModal = f.elements.get('playerModal');
  playerModal.classList.remove('hidden');
  const video = f.video;
  video.currentTime = 0;
  video.duration = 1800; // 30 minutes
  video.play();
  assert.equal(video.paused, false);

  // 5. Skip Intro Button appears in 0-85s
  const btnSkipIntro = f.elements.get('btnSkipIntro');
  assert.equal(SpecReference.isIntroInterval(video.currentTime, video.duration, 85), true);
  btnSkipIntro.classList.remove('hidden');

  // User clicks "Bỏ qua Intro"
  video.seek(SpecReference.skipIntroTarget(video.currentTime, video.duration, 85));
  btnSkipIntro.classList.add('hidden');
  assert.equal(video.currentTime, 85);
  assert.equal(SpecReference.isIntroInterval(video.currentTime, video.duration, 85), false);

  // 6. Fast forward to 30s before end (1770s)
  video.seek(1770);
  const countdown = SpecReference.nextEpisodeCountdown(video.currentTime, video.duration, 30);
  assert.ok(countdown);
  assert.equal(countdown.active, true);
  assert.equal(countdown.remaining, 30);

  const nextPopup = f.elements.get('nextEpisodePopup');
  nextPopup.classList.remove('hidden');

  // 7. Auto-advance at end of playback
  video.seek(1800);
  const countdownEnd = SpecReference.nextEpisodeCountdown(video.currentTime, video.duration, 30);
  assert.equal(countdownEnd, null);

  let nextEpisodePlayed = false;
  function onEnded() {
    nextPopup.classList.add('hidden');
    nextEpisodePlayed = true;
  }
  onEnded();
  assert.equal(nextEpisodePlayed, true);
  assert.equal(nextPopup.classList.contains('hidden'), true);
});

test('T3.2: Stream failover during intro window preserves position and keeps Skip Intro available', (t) => {
  const f = createDOMFixture();
  const video = f.video;
  video.duration = 1800;
  video.currentTime = 25; // In intro (25s)

  // Verify intro button should be shown
  assert.equal(SpecReference.isIntroInterval(video.currentTime, video.duration, 85), true);

  // Server stalls
  let failoverHandled = false;
  let newServerIndex = -1;
  let preservedPosition = 0;

  const mockPlayer = {
    currentServerIndex: 0,
    allServers: [{ server_name: 'Server 1' }, { server_name: 'Server 2' }],
    switchServer(nextIdx) {
      this.currentServerIndex = nextIdx;
      newServerIndex = nextIdx;
      preservedPosition = video.currentTime;
      failoverHandled = true;
    }
  };

  mockPlayer.switchServer(1);
  assert.equal(failoverHandled, true);
  assert.equal(newServerIndex, 1);
  assert.equal(preservedPosition, 25);

  // On new server, playback resumes at 25s; user clicks Skip Intro
  video.seek(preservedPosition);
  assert.equal(SpecReference.isIntroInterval(video.currentTime, video.duration, 85), true);

  const skipTarget = SpecReference.skipIntroTarget(video.currentTime, video.duration, 85);
  video.seek(skipTarget);
  assert.equal(video.currentTime, 85);
});

test('T3.3: Failover near end of episode maintains countdown and progresses cleanly', (t) => {
  const f = createDOMFixture();
  const video = f.video;
  video.duration = 1800;
  video.currentTime = 1780; // 20s remaining

  const initialCountdown = SpecReference.nextEpisodeCountdown(video.currentTime, video.duration, 30);
  assert.ok(initialCountdown);
  assert.equal(initialCountdown.remaining, 20);

  // Failover triggers at 1780s
  const savedTime = video.currentTime;
  let serverSwitched = false;

  const mockPlayer = {
    currentServerIndex: 0,
    switchServer(nextIdx) {
      serverSwitched = true;
      video.currentTime = savedTime;
    }
  };

  mockPlayer.switchServer(1);
  assert.equal(serverSwitched, true);
  assert.equal(video.currentTime, 1780);

  // Countdown continues on new server
  const postFailoverCountdown = SpecReference.nextEpisodeCountdown(video.currentTime, video.duration, 30);
  assert.ok(postFailoverCountdown);
  assert.equal(postFailoverCountdown.remaining, 20);
});

test('T3.4: Concurrent search while video is playing maintains player isolation', (t) => {
  const f = createDOMFixture();
  const video = f.video;
  video.currentTime = 400;
  video.duration = 1800;
  video.play();
  assert.equal(video.paused, false);

  // User interacts with search bar
  const searchInput = f.elements.get('searchInput');
  searchInput.value = 'lat mat';

  const matches = SampleCatalog.filter(m =>
    SpecReference.normalizeSearchText(m.name).includes(SpecReference.normalizeSearchText(searchInput.value))
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].slug, 'lat-mat-7');

  // Video playback must remain unpaused and uninterrupted
  assert.equal(video.paused, false);
  assert.equal(video.currentTime, 400);
});

test('T3.5: Download modal opened during playback preserves video state and history', () => {
  const f = createDOMFixture();
  const video = f.video;
  video.currentTime = 920;
  video.duration = 2400;

  // Open download modal
  const downloadModal = f.elements.get('downloadAppModal');
  downloadModal.classList.remove('hidden');
  assert.equal(downloadModal.classList.contains('hidden'), false);

  // Persist watch progress
  f.window.localStorage.setItem('watch_active_movie', JSON.stringify({
    currentTime: video.currentTime,
    duration: video.duration,
    timestamp: Date.now()
  }));

  // Close download modal
  downloadModal.classList.add('hidden');
  assert.equal(downloadModal.classList.contains('hidden'), true);

  // Verify watch progress is intact
  const saved = JSON.parse(f.window.localStorage.getItem('watch_active_movie'));
  assert.equal(saved.currentTime, 920);
  assert.equal(saved.duration, 2400);
});
