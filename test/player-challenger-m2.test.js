const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Core = require('../public/js/player-core.js');

function createPlayerHarness(overrides = {}) {
  const classes = new Set();
  const storage = new Map();
  const timeouts = new Map();
  let nextTimeoutId = 1;
  const elements = new Map();

  function getElement(id) {
    if (!elements.has(id)) {
      const elClasses = new Set();
      elements.set(id, {
        id,
        textContent: '',
        style: {},
        attributes: new Map(),
        classList: {
          add: (c) => elClasses.add(c),
          remove: (c) => elClasses.delete(c),
          toggle: (c, on) => (on ? elClasses.add(c) : elClasses.delete(c)),
          contains: (c) => elClasses.has(c),
        },
        setAttribute: (k, v) => elements.get(id).attributes.set(k, String(v)),
        getAttribute: (k) => elements.get(id).attributes.get(k),
        appendChild: () => {},
        replaceChildren: () => {},
        children: [],
        getBoundingClientRect: () => ({ left: 0, width: 1000 }),
        addEventListener: () => {},
        removeEventListener: () => {},
      });
    }
    return elements.get(id);
  }

  const wrapperClasses = new Set();
  const wrapperStyle = new Map();
  const wrapper = {
    style: {
      setProperty: (k, v) => wrapperStyle.set(k, String(v)),
      removeProperty: (k) => wrapperStyle.delete(k),
      get: (k) => wrapperStyle.get(k),
    },
    classList: {
      contains: (c) => wrapperClasses.has(c),
      add: (c) => wrapperClasses.add(c),
      remove: (c) => wrapperClasses.delete(c),
      toggle: (c, on) => (on ? wrapperClasses.add(c) : wrapperClasses.delete(c)),
    },
  };

  const modalClasses = new Set();
  const modalStyle = new Map();
  const modal = {
    style: {
      setProperty: (k, v) => modalStyle.set(k, String(v)),
      removeProperty: (k) => modalStyle.delete(k),
      get: (k) => modalStyle.get(k),
    },
    classList: {
      contains: (c) => modalClasses.has(c),
      add: (c) => modalClasses.add(c),
      remove: (c) => modalClasses.delete(c),
    },
  };

  const videoClasses = new Set();
  const video = {
    paused: false,
    ended: false,
    currentTime: 0,
    duration: 1800,
    volume: 1.0,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    classList: {
      add: (c) => videoClasses.add(c),
      remove: (c) => videoClasses.delete(c),
      contains: (c) => videoClasses.has(c),
    },
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); },
    removeAttribute() {},
    load() {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  elements.set('playerWrapper', wrapper);
  elements.set('playerModal', modal);
  elements.set('videoPlayer', video);

  const alerts = [];
  const trackedEvents = [];

  const ctx = {
    URL,
    API: {
      trackUsage: (event, payload) => trackedEvents.push({ event, payload }),
      flushUsage: () => {},
    },
    PlayerCore: Core,
    document: {
      readyState: 'loading',
      body: { classList: { add: () => {}, remove: () => {} } },
      addEventListener: () => {},
      getElementById: (id) => getElement(id),
      querySelectorAll: () => [],
      createElement: (tag) => ({
        tag,
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {},
      }),
    },
    window: {
      matchMedia: () => ({ matches: true }),
      setTimeout: (fn, ms) => {
        const id = nextTimeoutId++;
        timeouts.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => {
        timeouts.delete(id);
      },
      setInterval: () => nextTimeoutId++,
      clearInterval: () => {},
      requestAnimationFrame: (fn) => { fn(); return 1; },
      cancelAnimationFrame: () => {},
      innerWidth: 1920,
      innerHeight: 1080,
    },
    performance: { now: () => 1000 },
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    clearTimeout: (id) => timeouts.delete(id),
    setTimeout: (fn, ms) => {
      const id = nextTimeoutId++;
      timeouts.set(id, { fn, ms });
      return id;
    },
    ...overrides,
  };

  const code = fs.readFileSync('public/js/player.js', 'utf8') + '\nglobalThis.subject = Player;';
  vm.runInNewContext(code, ctx);
  const p = ctx.subject;
  p.wrapper = wrapper;
  p.modal = modal;
  p.video = video;
  p.showAlert = (msg) => alerts.push(msg);

  return { p, ctx, elements, timeouts, alerts, trackedEvents, storage, wrapper, modal, video, getElement };
}

// ---------------------------------------------------------------------------
// 1. BOUNDARY COUNTDOWN VALUES
// ---------------------------------------------------------------------------

test('CHALLENGE 1.1: nextEpisodeCountdown with extreme duration boundaries', () => {
  // Short videos (dur <= 60) must never trigger countdown
  assert.equal(Core.nextEpisodeCountdown(50, 60, 30), null);
  assert.equal(Core.nextEpisodeCountdown(20, 59.999, 30), null);
  assert.equal(Core.nextEpisodeCountdown(0, 0, 30), null);
  assert.equal(Core.nextEpisodeCountdown(10, -100, 30), null);
  assert.equal(Core.nextEpisodeCountdown(10, -1, 30), null);

  // Video just above 60s
  assert.deepEqual(Core.nextEpisodeCountdown(31, 60.5, 30), { active: true, remaining: 30 });
  assert.deepEqual(Core.nextEpisodeCountdown(45, 60.5, 30), { active: true, remaining: 16 });
  assert.equal(Core.nextEpisodeCountdown(10, 60.5, 30), null);

  // Huge durations
  assert.deepEqual(Core.nextEpisodeCountdown(999975, 1000000, 30), { active: true, remaining: 25 });
  assert.equal(Core.nextEpisodeCountdown(999000, 1000000, 30), null);

  // Non-finite durations
  assert.equal(Core.nextEpisodeCountdown(100, Number.POSITIVE_INFINITY, 30), null);
  assert.equal(Core.nextEpisodeCountdown(100, Number.NEGATIVE_INFINITY, 30), null);
  assert.equal(Core.nextEpisodeCountdown(100, Number.NaN, 30), null);
  assert.equal(Core.nextEpisodeCountdown(100, null, 30), null);
  assert.equal(Core.nextEpisodeCountdown(100, undefined, 30), null);
});

test('CHALLENGE 1.2: nextEpisodeCountdown with extreme currentTime boundaries', () => {
  const dur = 1800;
  // Sub-zero / negative currentTime
  assert.equal(Core.nextEpisodeCountdown(-0.0001, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown(-1000, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown(0, dur, 30), null);

  // Exact 30s threshold boundary
  assert.equal(Core.nextEpisodeCountdown(1769.99, dur, 30), null);
  assert.deepEqual(Core.nextEpisodeCountdown(1770.0, dur, 30), { active: true, remaining: 30 });
  assert.deepEqual(Core.nextEpisodeCountdown(1770.0001, dur, 30), { active: true, remaining: 30 });

  // Floating point sub-second checks
  assert.deepEqual(Core.nextEpisodeCountdown(1799.0001, dur, 30), { active: true, remaining: 1 });
  assert.deepEqual(Core.nextEpisodeCountdown(1799.9999, dur, 30), { active: true, remaining: 1 });

  // End of video / overshoot
  assert.equal(Core.nextEpisodeCountdown(1800.0, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown(1800.001, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown(1850, dur, 30), null);

  // Corrupted / non-finite currentTimes
  assert.equal(Core.nextEpisodeCountdown(Number.NaN, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown(Number.POSITIVE_INFINITY, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown(Number.NEGATIVE_INFINITY, dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown('corrupt', dur, 30), null);
  assert.equal(Core.nextEpisodeCountdown({}, dur, 30), null);
});

test('CHALLENGE 1.3: nextEpisodeCountdown threshold stress variations', () => {
  const dur = 1800;
  // Custom threshold 15s
  assert.equal(Core.nextEpisodeCountdown(1775, dur, 15), null);
  assert.deepEqual(Core.nextEpisodeCountdown(1785, dur, 15), { active: true, remaining: 15 });
  assert.deepEqual(Core.nextEpisodeCountdown(1790, dur, 15), { active: true, remaining: 10 });

  // Zero and negative thresholds must never activate
  assert.equal(Core.nextEpisodeCountdown(1795, dur, 0), null);
  assert.equal(Core.nextEpisodeCountdown(1795, dur, -10), null);
  assert.equal(Core.nextEpisodeCountdown(1795, dur, Number.NaN), null);
});

test('CHALLENGE 1.4: Player countdown UI lifecycle & seek cancellation', () => {
  const { p, getElement, video } = createPlayerHarness();
  const popup = getElement('nextEpisodePopup');
  const timer = getElement('nextEpTimer');
  const title = getElement('nextEpTitle');

  p.episodesList = [
    { slug: 'ep-1', name: 'Tập 1' },
    { slug: 'ep-2', name: 'Tập 2' },
  ];
  p.currentEpIndex = 0;
  p.currentEpisode = p.episodesList[0];
  video.duration = 1800;

  // 1. Playback before countdown window (100s) -> popup is hidden
  video.currentTime = 100;
  p.checkNextEpisodeCountdown();
  assert.equal(popup.classList.contains('hidden'), true);
  assert.equal(p.nextEpPopupActive, false);

  // 2. Playback enters countdown window (1775s) -> popup shows 25s and next episode name
  video.currentTime = 1775;
  p.checkNextEpisodeCountdown();
  assert.equal(popup.classList.contains('hidden'), false);
  assert.equal(p.nextEpPopupActive, true);
  assert.equal(timer.textContent, '25s');
  assert.equal(title.textContent, 'Tập 2');

  // 3. User seeks backward to 1200s -> popup must immediately hide
  video.currentTime = 1200;
  p.checkNextEpisodeCountdown();
  assert.equal(popup.classList.contains('hidden'), true);
  assert.equal(p.nextEpPopupActive, false);

  // 4. Return to countdown window -> popup activates again
  video.currentTime = 1785;
  p.checkNextEpisodeCountdown();
  assert.equal(popup.classList.contains('hidden'), false);
  assert.equal(p.nextEpPopupActive, true);
  assert.equal(timer.textContent, '15s');

  // 5. User clicks cancel (dismiss) -> popup hides and permanently stays dismissed for current episode
  p.dismissNextEpisodePopup();
  assert.equal(popup.classList.contains('hidden'), true);
  assert.equal(p.nextEpPopupDismissed, true);

  // Further timeupdates within countdown interval do not re-show dismissed popup
  video.currentTime = 1795;
  p.checkNextEpisodeCountdown();
  assert.equal(popup.classList.contains('hidden'), true);

  // Even at end of video, auto-advance does NOT fire if dismissed
  let advanced = false;
  p.playNextEpisode = () => { advanced = true; };
  video.currentTime = 1800;
  p.checkNextEpisodeCountdown();
  assert.equal(advanced, false);
});

test('CHALLENGE 1.5: Player auto-advance when countdown completes at video end', () => {
  const { p, video } = createPlayerHarness();
  p.episodesList = [
    { slug: 'ep-1', name: 'Tập 1' },
    { slug: 'ep-2', name: 'Tập 2' },
  ];
  p.currentEpIndex = 0;
  video.duration = 1800;

  // Enter countdown
  video.currentTime = 1798;
  p.checkNextEpisodeCountdown();
  assert.equal(p.nextEpPopupActive, true);

  // Playback reaches completion at 1800 (within 0.5s of end and countdown reaches 0)
  let advanced = false;
  p.playNextEpisode = () => { advanced = true; };
  video.currentTime = 1800;
  p.checkNextEpisodeCountdown();
  assert.equal(advanced, true);
  assert.equal(p.nextEpPopupActive, false);
});

// ---------------------------------------------------------------------------
// 2. SKIP INTRO SEEK BOUNDS
// ---------------------------------------------------------------------------

test('CHALLENGE 2.1: isIntroInterval boundary inputs and durations', () => {
  // Short videos (dur <= 120) must never show skip intro
  assert.equal(Core.isIntroInterval(10, 120, 85), false);
  assert.equal(Core.isIntroInterval(10, 119.99, 85), false);
  assert.equal(Core.isIntroInterval(0, 60, 85), false);
  assert.equal(Core.isIntroInterval(0, 0, 85), false);
  assert.equal(Core.isIntroInterval(0, -100, 85), false);

  // Valid duration > 120
  assert.equal(Core.isIntroInterval(0, 1800, 85), true);
  assert.equal(Core.isIntroInterval(0.001, 1800, 85), true);
  assert.equal(Core.isIntroInterval(42.5, 1800, 85), true);
  assert.equal(Core.isIntroInterval(84.999, 1800, 85), true);
  assert.equal(Core.isIntroInterval(85.0, 1800, 85), false);
  assert.equal(Core.isIntroInterval(85.001, 1800, 85), false);
  assert.equal(Core.isIntroInterval(100, 1800, 85), false);

  // Negative currentTime
  assert.equal(Core.isIntroInterval(-0.0001, 1800, 85), false);
  assert.equal(Core.isIntroInterval(-100, 1800, 85), false);

  // Non-finite values
  assert.equal(Core.isIntroInterval(Number.NaN, 1800, 85), false);
  assert.equal(Core.isIntroInterval(10, Number.NaN, 85), false);
  assert.equal(Core.isIntroInterval(Number.POSITIVE_INFINITY, 1800, 85), false);
  assert.equal(Core.isIntroInterval(10, Number.POSITIVE_INFINITY, 85), false);
  assert.equal(Core.isIntroInterval(undefined, 1800, 85), false);
});

test('CHALLENGE 2.2: skipIntroTarget bounds clamping', () => {
  // Standard video > 85s
  assert.equal(Core.skipIntroTarget(10, 1800, 85), 85);
  assert.equal(Core.skipIntroTarget(84, 1800, 85), 85);
  assert.equal(Core.skipIntroTarget(86, 1800, 85), 85);

  // Video duration between 1 and 85s: must be safely clamped to dur - 1
  assert.equal(Core.skipIntroTarget(10, 80, 85), 79);
  assert.equal(Core.skipIntroTarget(10, 50, 85), 49);
  assert.equal(Core.skipIntroTarget(10, 85, 85), 84);
  assert.equal(Core.skipIntroTarget(10, 86, 85), 85);

  // Very short video (dur <= 1)
  assert.equal(Core.skipIntroTarget(0, 1, 85), 85);
  assert.equal(Core.skipIntroTarget(0, 0.5, 85), 85);
  assert.equal(Core.skipIntroTarget(0, 0, 85), 85);
  assert.equal(Core.skipIntroTarget(0, -10, 85), 85);

  // Non-finite duration
  assert.equal(Core.skipIntroTarget(10, Number.NaN, 85), 85);
  assert.equal(Core.skipIntroTarget(10, Number.POSITIVE_INFINITY, 85), 85);
  assert.equal(Core.skipIntroTarget(10, undefined, 85), 85);
});

test('CHALLENGE 2.3: Player.skipIntro() execution and button state', () => {
  const { p, video, alerts, getElement } = createPlayerHarness();
  const btn = getElement('btnSkipIntro');
  video.currentTime = 25;
  video.duration = 1800;

  // Button visible during intro
  p.updateSkipIntroButton();
  assert.equal(btn.classList.contains('hidden'), false);

  // Trigger skipIntro
  p.skipIntro();
  assert.equal(video.currentTime, 85);
  assert.equal(btn.classList.contains('hidden'), true);
  assert.ok(alerts.includes('Đã bỏ qua đoạn mở đầu (Intro)'));

  // After skipIntro, updateSkipIntroButton must keep it hidden
  p.updateSkipIntroButton();
  assert.equal(btn.classList.contains('hidden'), true);
});

// ---------------------------------------------------------------------------
// 3. SERVER FAILOVER WITH CORRUPTED TIMESTAMPS
// ---------------------------------------------------------------------------

test('CHALLENGE 3.1: switchServer with corrupted video.currentTime, localStorage, and watchedSeconds', () => {
  const { p, video, storage } = createPlayerHarness();

  p.allServers = [
    { server_name: 'Server 1', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server 2', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server 3', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
  ];
  p.currentServerIndex = 0;
  p.currentEpisode = p.allServers[0].server_data[0];
  p.currentEpIndex = 0;
  p.episodesList = p.allServers[0].server_data;
  p.currentMovie = { slug: 'test-movie', name: 'Test Movie' };

  let capturedResumeTime = null;
  p.loadEpisode = (_ep, opts) => {
    capturedResumeTime = opts.resumeTime;
  };

  // Subcase A: video.currentTime is NaN, storage corrupted with "invalid_number", watchedSeconds is NaN
  video.currentTime = Number.NaN;
  storage.set('watch_test-movie_tap-1', 'invalid_number');
  p.watchedSeconds = Number.NaN;
  p.switchServer(1, { automatic: true });
  assert.equal(p.currentServerIndex, 1);
  assert.equal(capturedResumeTime, 0, 'corrupted state must cleanly resolve to 0');

  // Subcase B: video.currentTime is null, storage has valid timestamp 450.5
  video.currentTime = null;
  storage.set('watch_test-movie_tap-1', '450.5');
  p.watchedSeconds = 120;
  p.switchServer(2, { automatic: true });
  assert.equal(p.currentServerIndex, 2);
  assert.equal(capturedResumeTime, 450.5, 'valid saved storage timestamp is preserved');

  // Subcase C: video.currentTime is 0, storage is empty, watchedSeconds is 215.8
  video.currentTime = 0;
  storage.clear();
  p.watchedSeconds = 215.8;
  p.switchServer(0, { automatic: true });
  assert.equal(p.currentServerIndex, 0);
  assert.equal(capturedResumeTime, 216, 'watchedSeconds integer rounded fallback');
});

test('CHALLENGE 3.2: clampResumeTime resilience against corrupted resume values', () => {
  const dur = 1800;
  assert.equal(Core.clampResumeTime(-500, dur), 0);
  assert.equal(Core.clampResumeTime(0, dur), 0);
  assert.equal(Core.clampResumeTime(Number.NaN, dur), 0);
  assert.equal(Core.clampResumeTime(Number.POSITIVE_INFINITY, dur), 0);
  assert.equal(Core.clampResumeTime(Number.NEGATIVE_INFINITY, dur), 0);
  assert.equal(Core.clampResumeTime('garbage', dur), 0);
  assert.equal(Core.clampResumeTime(9999999, dur), 1799.5, 'capped at total - 0.5');
  assert.equal(Core.clampResumeTime(500, Number.NaN), 500);
  assert.equal(Core.clampResumeTime(500, 0), 500);
});

test('CHALLENGE 3.3: Embed load watchdog failover on unresponsive provider', () => {
  const { p, timeouts, alerts, wrapper, modal } = createPlayerHarness();
  wrapper.classList.add('embed-active');

  p.allServers = [
    { server_name: 'Fast Server', server_data: [{ slug: 'tap-1', name: 'Tập 1', link_embed: 'https://cdn1.test/embed/1' }] },
    { server_name: 'Backup Server', server_data: [{ slug: 'tap-1', name: 'Tập 1', link_embed: 'https://cdn2.test/embed/1' }] },
  ];
  p.currentServerIndex = 0;
  p.currentEpisode = p.allServers[0].server_data[0];
  p.episodesList = p.allServers[0].server_data;
  p.currentMovie = { slug: 'movie-x', name: 'Movie X' };

  p.playEmbedStream('https://cdn1.test/embed/1');
  assert.ok(p.embedLoadWatchdogTimer !== null, 'watchdog timer must be armed');
  assert.equal(p.embedReady, false);

  // Find the armed 10000ms timer
  let timerEntry = null;
  for (const [id, entry] of timeouts.entries()) {
    if (entry.ms === 10000) {
      timerEntry = { id, entry };
      break;
    }
  }
  assert.ok(timerEntry, '10s embed watchdog timer must be registered');

  // Trigger timeout callback
  timerEntry.entry.fn();
  assert.equal(p.currentServerIndex, 1, 'must automatically advance to backup server');
  assert.ok(alerts.some((msg) => msg.includes('Trình phát phản hồi chậm')));
});

test('CHALLENGE 3.4: Complete server exhaustion terminates gracefully without looping', () => {
  const { p, alerts } = createPlayerHarness();
  p.allServers = [
    { server_name: 'Server 1', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server 2', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
  ];
  p.currentServerIndex = 0;
  p.currentEpisode = p.allServers[0].server_data[0];
  p.episodesList = p.allServers[0].server_data;
  p.currentMovie = { slug: 'movie-x', name: 'Movie X' };

  // First failover -> to server 2
  p.fallbackToNextServer();
  assert.equal(p.currentServerIndex, 1);

  // Second failover -> all servers exhausted
  p.fallbackToNextServer();
  assert.equal(p.suppressBuffering, true);
  assert.ok(alerts.some((msg) => msg.includes('Tất cả server hiện có đều không phản hồi')));

  // Calling it again must remain safe and not throw or crash
  assert.doesNotThrow(() => p.fallbackToNextServer());
});

// ---------------------------------------------------------------------------
// 4. RAPID USER INTERACTIONS & RACE CONDITIONS
// ---------------------------------------------------------------------------

test('CHALLENGE 4.1: Rapid spam-clicking skipIntro() 100 times', () => {
  const { p, video, alerts } = createPlayerHarness();
  video.currentTime = 10;
  video.duration = 1800;

  for (let i = 0; i < 100; i++) {
    p.skipIntro();
  }

  assert.equal(video.currentTime, 85);
  assert.equal(alerts.length, 100);
});

test('CHALLENGE 4.2: Rapid alternating countdown seek boundaries (flutter)', () => {
  const { p, video, getElement } = createPlayerHarness();
  const popup = getElement('nextEpisodePopup');
  p.episodesList = [
    { slug: 'ep-1', name: 'Tập 1' },
    { slug: 'ep-2', name: 'Tập 2' },
  ];
  p.currentEpIndex = 0;
  video.duration = 1800;

  // Flutter back and forth across 1770s (threshold) 50 times
  for (let i = 0; i < 50; i++) {
    video.currentTime = 1775; // in countdown
    p.checkNextEpisodeCountdown();
    assert.equal(popup.classList.contains('hidden'), false);
    assert.equal(p.nextEpPopupActive, true);

    video.currentTime = 1765; // outside countdown
    p.checkNextEpisodeCountdown();
    assert.equal(popup.classList.contains('hidden'), true);
    assert.equal(p.nextEpPopupActive, false);
  }
});

test('CHALLENGE 4.3: Rapid server switching across multiple targets in immediate succession', () => {
  const { p, video } = createPlayerHarness();
  p.allServers = [
    { server_name: 'Server A', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server B', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server C', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server D', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
  ];
  p.currentServerIndex = 0;
  p.currentEpisode = p.allServers[0].server_data[0];
  p.episodesList = p.allServers[0].server_data;
  p.currentMovie = { slug: 'movie-fast', name: 'Fast Movie' };
  video.currentTime = 300;

  p.loadEpisode = () => {};

  // Switch rapidly: 0 -> 1 -> 2 -> 3 -> 1 -> 2
  p.switchServer(1);
  assert.equal(p.currentServerIndex, 1);
  p.switchServer(2);
  assert.equal(p.currentServerIndex, 2);
  p.switchServer(3);
  assert.equal(p.currentServerIndex, 3);
  p.switchServer(1);
  assert.equal(p.currentServerIndex, 1);
  p.switchServer(2);
  assert.equal(p.currentServerIndex, 2);

  // Invalid index switches should be safely ignored
  p.switchServer(-1);
  assert.equal(p.currentServerIndex, 2);
  p.switchServer(99);
  assert.equal(p.currentServerIndex, 2);
  p.switchServer(2); // Same index
  assert.equal(p.currentServerIndex, 2);
});

test('CHALLENGE 4.4: Modal close during active countdown and watchdog timers', () => {
  const { p, video, timeouts, getElement } = createPlayerHarness();
  const popup = getElement('nextEpisodePopup');
  const btnSkip = getElement('btnSkipIntro');

  p.episodesList = [
    { slug: 'ep-1', name: 'Tập 1' },
    { slug: 'ep-2', name: 'Tập 2' },
  ];
  p.currentEpIndex = 0;
  video.duration = 1800;
  video.currentTime = 1780;

  p.checkNextEpisodeCountdown();
  assert.equal(popup.classList.contains('hidden'), false);
  assert.equal(p.nextEpPopupActive, true);

  p.activeStreamUrl = 'https://cdn.example.test/stream.m3u8';
  p.armStallWatchdog('waiting');
  p.armEmbedLoadWatchdog();
  assert.ok(p.stallWatchdogTimer !== null);
  assert.ok(p.embedLoadWatchdogTimer !== null);

  // Close player
  p.close();

  assert.equal(popup.classList.contains('hidden'), true);
  assert.equal(btnSkip.classList.contains('hidden'), true);
  assert.equal(p.nextEpPopupActive, false);
  assert.equal(p.nextEpPopupDismissed, false);
  assert.equal(p.stallWatchdogTimer, null);
  assert.equal(p.embedLoadWatchdogTimer, null);
  assert.equal(p.activeStreamUrl, '');
});

test('CHALLENGE 4.5: playNextEpisode on terminal episode', () => {
  const { p, alerts } = createPlayerHarness();
  p.episodesList = [{ slug: 'ep-solo', name: 'Tập 1 duy nhất' }];
  p.currentEpIndex = 0;

  p.playNextEpisode();
  assert.ok(alerts.some((msg) => msg.includes('Bạn đã xem đến tập cuối cùng.')));
});

// ---------------------------------------------------------------------------
// 5. EXTENDED ADVERSARIAL STRESS CASES
// ---------------------------------------------------------------------------

test('CHALLENGE 5.1: Numeric string coercion and precision edge cases in nextEpisodeCountdown', () => {
  assert.deepEqual(Core.nextEpisodeCountdown('1770', '1800', '30'), { active: true, remaining: 30 });
  assert.deepEqual(Core.nextEpisodeCountdown('1785.5', '1800', 30), { active: true, remaining: 15 });
  assert.deepEqual(Core.nextEpisodeCountdown(1799.99999999, 1800, 30), { active: true, remaining: 1 });
  assert.deepEqual(Core.nextEpisodeCountdown(1770.00000001, 1800, 30), { active: true, remaining: 30 });
  // Large threshold (e.g. 120s)
  assert.deepEqual(Core.nextEpisodeCountdown(1690, 1800, 120), { active: true, remaining: 110 });
  assert.equal(Core.nextEpisodeCountdown(1679, 1800, 120), null);
});

test('CHALLENGE 5.2: Cross-origin iframe postMessage error tolerance in skipIntro', () => {
  const { p, wrapper, elements } = createPlayerHarness();
  wrapper.classList.add('embed-active');

  // Iframe whose contentWindow.postMessage throws (e.g. cross-origin restriction or detached frame)
  elements.set('playerEmbed', {
    id: 'playerEmbed',
    classList: { add: () => {}, remove: () => {} },
    contentWindow: {
      postMessage: () => {
        throw new Error('Blocked a frame with origin from accessing a cross-origin frame');
      },
    },
  });

  p.video.duration = 1800;
  p.video.currentTime = 10;

  // Must not throw despite iframe postMessage throwing
  assert.doesNotThrow(() => p.skipIntro());
  assert.equal(p.video.currentTime, 85);
});

test('CHALLENGE 5.3: skipIntro when video is null or has short duration', () => {
  const { p, alerts } = createPlayerHarness();
  p.video = null;

  // When video is null, skipIntro must not throw
  assert.doesNotThrow(() => p.skipIntro());
  assert.ok(alerts.includes('Đã bỏ qua đoạn mở đầu (Intro)'));

  // When video duration is only 40s (shorter than 85s intro)
  const harness2 = createPlayerHarness();
  harness2.p.video.duration = 40;
  harness2.p.video.currentTime = 5;
  harness2.p.skipIntro();
  assert.equal(harness2.p.video.currentTime, 39, 'safely clamped to dur - 1');
});

test('CHALLENGE 5.4: switchServer target missing equivalent episode and same-index guard', () => {
  const { p, alerts, video } = createPlayerHarness();
  p.allServers = [
    { server_name: 'Server 1', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Server 2', server_data: [] }, // Empty episodes list
  ];
  p.currentServerIndex = 0;
  p.currentEpisode = p.allServers[0].server_data[0];
  p.episodesList = p.allServers[0].server_data;
  p.currentMovie = { slug: 'test-m', name: 'Test' };
  video.currentTime = 50;

  // Attempting to switch to same index: must no-op
  p.switchServer(0);
  assert.equal(p.currentServerIndex, 0);

  // Attempting to switch to server with no matching episode: must alert and remain on current server
  p.switchServer(1);
  assert.equal(p.currentServerIndex, 0, 'must not advance to server without equivalent episode');
  assert.ok(alerts.includes('Server này chưa có tập tương ứng.'));
});

test('CHALLENGE 5.5: onTimeUpdate with corrupted or uninitialized video state', () => {
  const { p } = createPlayerHarness();

  // Null video
  p.video = null;
  assert.doesNotThrow(() => p.onTimeUpdate());

  // Duration 0
  p.video = { duration: 0, currentTime: 0 };
  assert.doesNotThrow(() => p.onTimeUpdate());

  // Duration NaN
  p.video = { duration: Number.NaN, currentTime: 10 };
  assert.doesNotThrow(() => p.onTimeUpdate());

  // Duration negative
  p.video = { duration: -100, currentTime: 10 };
  assert.doesNotThrow(() => p.onTimeUpdate());
});
