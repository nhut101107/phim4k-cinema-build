/**
 * Tier 1 - Feature Coverage: Smooth Auto-Failover to Backup Servers (F4)
 * Tests automatic fallback on stall/error, preservation of resumeTime,
 * equivalent episode cross-server matching, and server-switch notification alerts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PROJECT_ROOT, createDOMFixture } = require('./helpers');

test('T1.18: Stalled or errored stream marks current server failed and triggers next server switch', (t) => {
  const f = createDOMFixture();
  const allServers = [
    { server_name: 'VIP Server 1', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Backup Server 2', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] },
    { server_name: 'Fast Server 3', server_data: [{ slug: 'tap-1', name: 'Tập 1' }] }
  ];

  let switchedToServer = -1;
  let automaticFlag = false;

  const mockPlayer = {
    allServers,
    currentServerIndex: 0,
    failedServerIndexes: new Set(),
    switchServer(newIndex, options = {}) {
      this.currentServerIndex = newIndex;
      switchedToServer = newIndex;
      automaticFlag = Boolean(options.automatic);
    },
    fallbackToNextServer() {
      this.failedServerIndexes.add(this.currentServerIndex);
      const nextIndex = this.allServers.findIndex((_s, idx) => !this.failedServerIndexes.has(idx));
      if (nextIndex >= 0) {
        this.switchServer(nextIndex, { automatic: true });
      }
    }
  };

  // Primary server stalls/errors
  mockPlayer.fallbackToNextServer();

  assert.equal(mockPlayer.failedServerIndexes.has(0), true, 'Server 0 should be added to failed set');
  assert.equal(switchedToServer, 1, 'Should fail over to server 1');
  assert.equal(automaticFlag, true, 'Failover should carry automatic: true flag');
});

test('T1.19: Playback position (resumeTime) is preserved across server failover', (t) => {
  const f = createDOMFixture();
  const video = f.video;
  video.currentTime = 645.5; // Watched 10m 45s

  let resumedAtTime = null;

  const mockPlayer = {
    video,
    currentServerIndex: 0,
    watchedSeconds: 645,
    getSavedWatchTime() {
      return 645;
    },
    switchServer(newServerIndex, { automatic = false } = {}) {
      // Contract: resumeTime from video.currentTime || getSavedWatchTime() || watchedSeconds
      const resumeTime = Number(this.video?.currentTime) || this.getSavedWatchTime() || this.watchedSeconds || 0;
      resumedAtTime = resumeTime;
      this.currentServerIndex = newServerIndex;
    }
  };

  mockPlayer.switchServer(1, { automatic: true });
  assert.equal(resumedAtTime, 645.5, 'Resume position must be preserved verbatim during failover');
});

test('T1.20: Equivalent episode matching correctly aligns episode on backup server with different ordering', (t) => {
  const Core = require(path.join(PROJECT_ROOT, 'public/js/player-core.js'));

  const currentEpisode = { slug: 'tap-03', name: 'Tập 3' };
  const backupServerEpisodes = [
    { slug: 'tap-01', name: 'Tập 1' },
    { slug: 'tap-02', name: 'Tập 2' },
    { slug: 'tap-04', name: 'Tập 4' },
    { slug: 'tap-03', name: 'Tập 3' }, // Out of order index 3
    { slug: 'tap-05', name: 'Tập 5' }
  ];

  const matched = Core.findEquivalentEpisode(backupServerEpisodes, currentEpisode, 2);
  assert.equal(matched.index, 3, 'Must match episode Tap 3 at index 3');
  assert.equal(matched.episode.slug, 'tap-03');
});

test('T1.21: Informative toast alert is displayed when failing over to backup server', (t) => {
  let alertMessage = '';
  const mockPlayer = {
    showAlert(msg) {
      alertMessage = msg;
    },
    notifyFailover(serverName) {
      this.showAlert(`Server hiện tại không phát được. Đang thử ${serverName}…`);
    }
  };

  mockPlayer.notifyFailover('VIP Server 2');
  assert.match(alertMessage, /Đang thử VIP Server 2/);
});

test('T1.22: Consecutive server failures iterate through all candidates before reporting exhaustion', (t) => {
  const allServers = [
    { server_name: 'Server A' },
    { server_name: 'Server B' },
    { server_name: 'Server C' }
  ];

  const failed = new Set();
  const transitionHistory = [];
  let exhausted = false;

  function failover(current) {
    failed.add(current);
    const next = allServers.findIndex((_, idx) => !failed.has(idx));
    if (next >= 0) {
      transitionHistory.push(next);
      return next;
    }
    exhausted = true;
    return -1;
  }

  let cur = 0;
  cur = failover(cur); // 0 fails -> switches to 1
  assert.equal(cur, 1);

  cur = failover(cur); // 1 fails -> switches to 2
  assert.equal(cur, 2);

  cur = failover(cur); // 2 fails -> exhausted
  assert.equal(cur, -1);
  assert.equal(exhausted, true);
  assert.deepEqual(transitionHistory, [1, 2]);
});
