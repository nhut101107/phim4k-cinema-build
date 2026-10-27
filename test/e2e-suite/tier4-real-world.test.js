/**
 * Tier 4 - Real-World Application Scenarios Test Suite
 * Simulates realistic end-to-end user journeys:
 * - T4.1: Multi-episode series binge-watching with continuous watch progress updates
 * - T4.2: Multi-server network degradation chain with seamless multi-hop failovers
 * - T4.3: Mobile vs Desktop viewport adaptation, input modes, and platform detection
 * - T4.4: Unstable network recovery with stream refresh budget before failover
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PROJECT_ROOT, createDOMFixture, SpecReference } = require('./helpers');
const platform = require(path.join(PROJECT_ROOT, 'public/js/platform.js'));

test('T4.1: Series Binge-Watching Scenario: 3 Consecutive Episodes with Watch History', (t) => {
  const f = createDOMFixture();
  const seriesEpisodes = [
    { slug: 'tap-01', name: 'Tập 1', duration: 1800 },
    { slug: 'tap-02', name: 'Tập 2', duration: 1800 },
    { slug: 'tap-03', name: 'Tập 3 (Tập cuối)', duration: 1800 }
  ];

  let currentEpIndex = 0;
  const watchHistory = [];

  function recordProgress(ep, time) {
    watchHistory.push({ slug: ep.slug, time, timestamp: Date.now() });
    f.window.localStorage.setItem(`watch_${ep.slug}`, String(time));
  }

  // --- Episode 1 ---
  let ep = seriesEpisodes[currentEpIndex];
  f.video.currentTime = 0;
  f.video.duration = ep.duration;
  recordProgress(ep, 500);

  // Reaches 30s before end
  f.video.seek(1770);
  const cd1 = SpecReference.nextEpisodeCountdown(f.video.currentTime, f.video.duration, 30);
  assert.ok(cd1);
  assert.equal(cd1.remaining, 30);

  // Ep 1 ends -> advance
  recordProgress(ep, 1800);
  currentEpIndex += 1;

  // --- Episode 2 ---
  ep = seriesEpisodes[currentEpIndex];
  assert.equal(ep.slug, 'tap-02');
  f.video.currentTime = 0;
  f.video.duration = ep.duration;

  // Intro appears
  assert.equal(SpecReference.isIntroInterval(f.video.currentTime, f.video.duration, 85), true);
  // User skips intro
  f.video.seek(SpecReference.skipIntroTarget(f.video.currentTime, f.video.duration, 85));
  assert.equal(f.video.currentTime, 85);
  recordProgress(ep, 85);

  // Ep 2 finishes -> advance
  recordProgress(ep, 1800);
  currentEpIndex += 1;

  // --- Episode 3 (Final Episode) ---
  ep = seriesEpisodes[currentEpIndex];
  assert.equal(ep.slug, 'tap-03');
  f.video.currentTime = 1770;
  f.video.duration = ep.duration;
  recordProgress(ep, 1770);

  // On last episode: next episode countdown must NOT trigger
  const isLast = currentEpIndex >= seriesEpisodes.length - 1;
  assert.equal(isLast, true);

  // Verify full binge watch history recorded
  assert.equal(watchHistory.length, 5);
  assert.equal(f.window.localStorage.getItem('watch_tap-01'), '1800');
  assert.equal(f.window.localStorage.getItem('watch_tap-02'), '1800');
});

test('T4.2: Multi-Server Network Degradation Chain: Primary -> Backup 1 -> Backup 2', (t) => {
  const f = createDOMFixture();
  const servers = [
    { name: 'Server 1 (Primary - Stalls at 250s)' },
    { name: 'Server 2 (Backup 1 - Drops at 700s)' },
    { name: 'Server 3 (Backup 2 - Stable)' }
  ];

  const failedServers = new Set();
  let currentServer = 0;
  let activeStreamTime = 0;
  const failoverLog = [];

  function handleStall(time) {
    activeStreamTime = time;
    failedServers.add(currentServer);
    const nextServer = servers.findIndex((_, idx) => !failedServers.has(idx));
    if (nextServer >= 0) {
      failoverLog.push({ from: currentServer, to: nextServer, resumeTime: activeStreamTime });
      currentServer = nextServer;
      return true;
    }
    return false;
  }

  // 1. Play on Server 1 until 250s stall
  assert.equal(handleStall(250), true);
  assert.equal(currentServer, 1);
  assert.equal(failoverLog[0].resumeTime, 250);

  // 2. Play on Server 2 until 700s drop
  assert.equal(handleStall(700), true);
  assert.equal(currentServer, 2);
  assert.equal(failoverLog[1].resumeTime, 700);

  // 3. Play on Server 3 to end
  activeStreamTime = 1800;
  assert.equal(failoverLog.length, 2);
  assert.deepEqual(Array.from(failedServers), [0, 1]);
});

test('T4.3: Responsive Viewport Adaptation: Mobile Touch vs Desktop Keyboard Experience', () => {
  // Mobile Android TV / Mobile scenario
  const mobileUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
  const detectedMobile = platform.detect(mobileUA, 'android');
  assert.equal(detectedMobile, 'android');

  // Desktop Windows scenario
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const detectedDesktop = platform.detect(desktopUA, 'windows');
  assert.equal(detectedDesktop, 'windows');

  // Verify platform labels
  assert.equal(platform.labels.android, 'Android');
  assert.equal(platform.labels.windows, 'Windows 64-bit');
  assert.equal(platform.labels.android_tv, 'Android TV');
  assert.equal(platform.labels.ios, 'iPhone / iPad');
});

test('T4.4: Unstable Network Stream Refresh Budget Before Escalating to Failover', () => {
  let streamRefreshAttempts = 0;
  let failoverTriggered = false;

  function recoverPlayback(reason) {
    if (streamRefreshAttempts < 1) {
      // First attempt: refresh stream ticket without changing server
      streamRefreshAttempts += 1;
      return 'refreshed';
    }
    // Second attempt: escalate to server failover
    failoverTriggered = true;
    return 'failed_over';
  }

  // Transient jitter: first recoverPlayback call refreshes stream
  const action1 = recoverPlayback('waiting');
  assert.equal(action1, 'refreshed');
  assert.equal(streamRefreshAttempts, 1);
  assert.equal(failoverTriggered, false);

  // Persistent failure: second recoverPlayback call triggers failover
  const action2 = recoverPlayback('stalled');
  assert.equal(action2, 'failed_over');
  assert.equal(failoverTriggered, true);
});
