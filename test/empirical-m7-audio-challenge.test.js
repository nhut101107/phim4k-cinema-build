const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const webIndexHtml = fs.readFileSync(path.join(root, 'public/web-index.html'), 'utf8');
const playerCss = fs.readFileSync(path.join(root, 'public/css/player.css'), 'utf8');
const playerJs = fs.readFileSync(path.join(root, 'public/js/player.js'), 'utf8');
const enhancerJs = fs.readFileSync(path.join(root, 'public/js/audio-enhancer.js'), 'utf8');

function createDOMElement(tag = 'div', id = '') {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    id,
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => {
        if (typeof on === 'boolean') {
          if (on) classes.add(c); else classes.delete(c);
          return on;
        }
        if (classes.has(c)) { classes.delete(c); return false; }
        classes.add(c); return true;
      }
    },
    textContent: '',
    value: '',
    src: '',
    muted: false,
    volume: 1,
    playbackRate: 1,
    crossOrigin: '',
    dataset: {},
    setAttribute: (k, v) => {
      attributes.set(k, String(v));
      if (k === 'src') el.src = String(v);
    },
    getAttribute: (k) => attributes.get(k) || null,
    removeAttribute: (k) => {
      attributes.delete(k);
      if (k === 'src') el.src = '';
    },
    hasAttribute: (k) => attributes.has(k),
    addEventListener: (type, fn, opts) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, opts });
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type);
      if (list) {
        const idx = list.findIndex(item => item.fn === fn);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
    dispatchEvent: (event) => {
      const list = listeners.get(event.type) || [];
      list.forEach(item => item.fn(event));
    },
    cloneNode: function() {
      const clone = createDOMElement(tag, id);
      classes.forEach(c => clone.classList.add(c));
      attributes.forEach((v, k) => clone.setAttribute(k, v));
      clone.muted = this.muted;
      clone.volume = this.volume;
      clone.playbackRate = this.playbackRate;
      clone.crossOrigin = this.crossOrigin;
      clone.src = this.src;
      clone.dataset = { ...this.dataset };
      return clone;
    },
    replaceWith: function(next) {
      this.replacedWith = next;
      Object.assign(this, next);
    },
    replaceChildren: function() {},
    canPlayType: function(type) {
      if (type.includes('mpegurl')) return 'maybe';
      return 'probably';
    },
    pause: function() { this.paused = true; this.pausedCalls = (this.pausedCalls || 0) + 1; },
    load: function() { this.loadCalls = (this.loadCalls || 0) + 1; },
    play: function() { this.paused = false; return Promise.resolve(); }
  };
  return el;
}

function createPlayerHarness(options = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createDOMElement('div', id));
    }
    return elements.get(id);
  };

  const iframe = createDOMElement('iframe', 'playerEmbed');
  const postMessages = [];
  iframe.contentWindow = {
    postMessage: (msg, target) => {
      postMessages.push({ msg, target, timestamp: Date.now() });
    }
  };
  elements.set('playerEmbed', iframe);

  const video = createDOMElement('video', 'videoPlayer');
  video.pause = function() { this.paused = true; this.pausedCalls = (this.pausedCalls || 0) + 1; };
  video.load = function() { this.loadCalls = (this.loadCalls || 0) + 1; };
  elements.set('videoPlayer', video);

  const wrapper = createDOMElement('div', 'playerWrapper');
  elements.set('playerWrapper', wrapper);

  const modal = createDOMElement('div', 'playerModal');
  elements.set('playerModal', modal);

  const volumeSlider = createDOMElement('input', 'volumeSlider');
  volumeSlider.value = '1';
  elements.set('volumeSlider', volumeSlider);

  const playerControls = createDOMElement('div', 'playerControls');
  elements.set('playerControls', playerControls);

  const btnCenterPlayPause = createDOMElement('button', 'btnCenterPlayPause');
  elements.set('btnCenterPlayPause', btnCenterPlayPause);

  const iconVolHigh = createDOMElement('span', 'iconVolHigh');
  elements.set('iconVolHigh', iconVolHigh);

  const iconVolMute = createDOMElement('span', 'iconVolMute');
  iconVolMute.classList.add('hidden');
  elements.set('iconVolMute', iconVolMute);

  const btnAudioMode = createDOMElement('button', 'btnAudioMode');
  elements.set('btnAudioMode', btnAudioMode);

  const playerBuffering = createDOMElement('div', 'playerBuffering');
  elements.set('playerBuffering', playerBuffering);

  const realResolutionBadge = createDOMElement('span', 'realResolutionBadge');
  elements.set('realResolutionBadge', realResolutionBadge);

  const alerts = [];
  const resumedContexts = [];
  const timeouts = [];
  let nextTimerId = 1;

  let audioGraphAttached = options.audioGraphAttached !== false;

  const mockAudioContext = {
    state: options.audioContextState || 'suspended',
    resumeCount: 0,
    resume: async function() {
      this.resumeCount++;
      if (options.audioContextResumeFails) {
        throw new Error('NotAllowedError: play request was interrupted');
      }
      this.state = 'running';
    },
    close: async function() {
      this.state = 'closed';
    }
  };

  const ctx = {
    URL,
    API: { trackUsage: () => {} },
    PlayerCore: require('../public/js/player-core'),
    document: {
      readyState: 'complete',
      body: { classList: { add() {}, remove() {}, contains: () => false } },
      addEventListener: () => {},
      getElementById: (id) => getEl(id),
      querySelectorAll: () => [],
      querySelector: () => null
    },
    window: {
      matchMedia: () => ({ matches: true }),
      setTimeout: (fn, delay) => {
        const id = nextTimerId++;
        timeouts.push({ id, fn, delay, cleared: false });
        return id;
      },
      clearTimeout: (id) => {
        const t = timeouts.find(item => item.id === id);
        if (t) t.cleared = true;
      },
      setInterval: () => 1,
      clearInterval: () => {},
      requestAnimationFrame: (fn) => 1,
      cancelAnimationFrame: () => {},
      addEventListener: () => {},
      Phim4KAudio: {
        resume: () => {
          resumedContexts.push(Date.now());
          return mockAudioContext.resume();
        },
        release: (v) => {
          if (!audioGraphAttached) return false;
          audioGraphAttached = false;
          return true;
        },
        toggle: () => Promise.resolve(true),
        attach: () => { audioGraphAttached = true; }
      }
    },
    performance: { now: () => 100 },
    localStorage: {
      _store: new Map(),
      getItem(k) { return this._store.get(k) || null; },
      setItem(k, v) { this._store.set(k, String(v)); },
      removeItem(k) { this._store.delete(k); }
    },
    clearTimeout: (id) => {
      const t = timeouts.find(item => item.id === id);
      if (t) t.cleared = true;
    },
    clearInterval: () => {},
    navigator: { userAgent: 'Mozilla/5.0 (NodeEmpiricalChallenge; Linux)' }
  };

  vm.runInNewContext(playerJs + '\nglobalThis.subject = Player;', ctx);
  const p = ctx.subject;
  p.wrapper = wrapper;
  p.video = video;
  p.modal = modal;
  p.showAlert = (msg) => { alerts.push(msg); };

  const flushTimers = (maxDelay = Infinity) => {
    timeouts
      .filter(t => !t.cleared && t.delay <= maxDelay)
      .sort((a, b) => a.delay - b.delay)
      .forEach(t => {
        t.cleared = true;
        t.fn();
      });
  };

  return {
    player: p,
    elements,
    postMessages,
    alerts,
    resumedContexts,
    timeouts,
    flushTimers,
    video,
    wrapper,
    modal,
    iframe,
    mockAudioContext,
    setAudioGraphAttached: (v) => { audioGraphAttached = v; }
  };
}

// ============================================================================
// CHALLENGE 1: AudioContext Suspended State & Concurrency Stress Test
// ============================================================================

test('CHALLENGE 1.1: AudioEnhancer.resume() recovers suspended AudioContext without throwing, even under concurrent burst', async () => {
  let resumeAttempts = 0;
  const mockContext = {
    state: 'suspended',
    resume: async () => {
      resumeAttempts++;
      mockContext.state = 'running';
    },
    close: async () => {},
    createBiquadFilter: () => ({ connect() {}, frequency: {}, Q: {}, gain: {} }),
    createDynamicsCompressor: () => ({ connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
    createGain: () => ({ connect() {}, gain: { value: 0 } }),
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    destination: {}
  };

  const sandbox = {
    window: {
      location: { href: 'https://localhost/' },
      AudioContext: function() { return mockContext; }
    },
    URL,
    navigator: { userAgent: 'Mozilla/5.0 (Linux)' }
  };

  vm.runInNewContext(enhancerJs, sandbox);
  const audio = sandbox.window.Phim4KAudio;

  const mockVideo = {
    isConnected: true,
    src: 'https://localhost/media/test.mp4',
    currentSrc: 'https://localhost/media/test.mp4',
    addEventListener: () => {}
  };

  await audio.toggle(mockVideo);
  assert.equal(resumeAttempts, 1);
  assert.equal(mockContext.state, 'running');

  // Simulate suspension
  mockContext.state = 'suspended';

  // Stress: 100 concurrent resume calls
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(Promise.resolve().then(() => audio.resume()));
  }
  await Promise.all(promises);

  assert.ok(resumeAttempts >= 2, 'AudioContext must have been resumed');
  assert.equal(mockContext.state, 'running');
});

test('CHALLENGE 1.2: AudioEnhancer.resume() suppresses rejection when browser blocks autoplay', async () => {
  const mockContext = {
    state: 'suspended',
    resume: async () => {
      throw new Error('NotAllowedError: play() failed because the user didn\'t interact');
    },
    close: async () => {},
    createBiquadFilter: () => ({ connect() {}, frequency: {}, Q: {}, gain: {} }),
    createDynamicsCompressor: () => ({ connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
    createGain: () => ({ connect() {}, gain: { value: 0 } }),
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    destination: {}
  };

  const sandbox = {
    window: {
      location: { href: 'https://localhost/' },
      AudioContext: function() { return mockContext; }
    },
    URL,
    navigator: { userAgent: 'Mozilla/5.0 (Linux)' }
  };

  vm.runInNewContext(enhancerJs, sandbox);
  const audio = sandbox.window.Phim4KAudio;

  // resume() should never reject or throw
  assert.doesNotThrow(() => {
    audio.resume();
  });
});

// ============================================================================
// CHALLENGE 2: Adversarial Video Node Cloning & Property Retention in releaseAudioVideo()
// ============================================================================

test('CHALLENGE 2.1: releaseAudioVideo() guarantees unmuted audio (muted=false, volume=1) on replacement node even if old video was muted with zero volume', () => {
  const h = createPlayerHarness({ audioGraphAttached: true });
  const p = h.player;
  const oldVideo = p.video;

  // Corrupt old video with muted state and zero volume
  oldVideo.muted = true;
  oldVideo.volume = 0;
  oldVideo.setAttribute('src', 'https://example.com/stale-stream.m3u8');
  oldVideo.dataset.reliabilityHotfix350 = 'stale-token';
  oldVideo.setAttribute('data-reliability-hotfix350', 'stale-token');
  oldVideo.playbackRate = 1.25;

  let timeupdateFired = 0;
  p.videoBindings = [
    { type: 'timeupdate', listener: () => { timeupdateFired++; }, options: { passive: true } }
  ];

  p.releaseAudioVideo();

  const newVideo = p.video;
  assert.notEqual(newVideo, oldVideo, 'releaseAudioVideo must replace the video element');
  assert.equal(newVideo.muted, false, 'replacement video must have muted === false unconditionally');
  assert.equal(newVideo.volume, 1, 'replacement video must have volume === 1 unconditionally');
  assert.equal(newVideo.playbackRate, 1.25, 'playbackRate must be retained');
  assert.equal(newVideo.crossOrigin, 'anonymous', 'crossOrigin must be anonymous');
  assert.equal(newVideo.dataset.reliabilityHotfix350, undefined, 'reliabilityHotfix350 marker must be removed');
  assert.equal(newVideo.hasAttribute('data-reliability-hotfix350'), false, 'data-reliability-hotfix350 attribute must be removed');

  // Verify old video was paused and unloaded
  assert.ok(oldVideo.pausedCalls >= 1, 'old video must be paused');
  assert.ok(oldVideo.loadCalls >= 1, 'old video must be unloaded');
  assert.equal(oldVideo.src, '', 'old video src attribute must be removed');

  // Verify re-bound event listeners fire on new video
  newVideo.dispatchEvent({ type: 'timeupdate' });
  assert.equal(timeupdateFired, 1, 'videoBindings listeners must be transferred to new video');
});

test('CHALLENGE 2.2: releaseAudioVideo() loop stress test (50 sequential cycles)', () => {
  const h = createPlayerHarness();
  const p = h.player;

  for (let i = 0; i < 50; i++) {
    h.setAudioGraphAttached(true);
    p.video.muted = (i % 2 === 0);
    p.video.volume = (i % 2 === 0) ? 0 : 0.5;

    p.releaseAudioVideo();

    assert.equal(p.video.muted, false, `Cycle ${i}: video must be unmuted`);
    assert.equal(p.video.volume, 1, `Cycle ${i}: video volume must be 1`);
  }
});

// ============================================================================
// CHALLENGE 3: Stream Switching & Adverse Failover Audio Invariants
// ============================================================================

test('CHALLENGE 3.1: Switching from Embed -> HTML5 Fallback unconditionally enforces unmuted audio', () => {
  const h = createPlayerHarness();
  const p = h.player;

  // Start in embed mode
  p.playEmbedStream('https://player.phimapi.com/player/?url=test');
  assert.equal(h.wrapper.classList.contains('embed-active'), true);
  assert.equal(h.iframe.classList.contains('hidden'), false);

  // Mute video element behind the scenes
  p.video.muted = true;
  p.video.volume = 0;

  // User or failover triggers loadStream
  p.loadStream('https://cdn.example.com/stream.m3u8', { autoplay: true });

  assert.equal(h.wrapper.classList.contains('embed-active'), false, 'embed-active class must be removed');
  assert.equal(h.iframe.classList.contains('hidden'), true, 'iframe must be hidden');
  assert.equal(h.iframe.src, 'about:blank', 'iframe src must be cleared to about:blank');
  assert.equal(p.video.classList.contains('hidden'), false, 'video must be visible');
  assert.equal(p.video.muted, false, 'video must be strictly unmuted');
  assert.equal(p.video.volume, 1, 'video volume must be restored to 1.0');
});

test('CHALLENGE 3.2: Rapid stream switching stress harness (50 back-and-forth switches)', () => {
  const h = createPlayerHarness();
  const p = h.player;

  for (let i = 0; i < 50; i++) {
    if (i % 2 === 0) {
      p.playEmbedStream(`https://player.phimapi.com/player/?url=test_${i}`);
      assert.equal(h.wrapper.classList.contains('embed-active'), true);
      assert.ok(h.postMessages.some(m => m.msg.command === 'unmute'));
    } else {
      p.loadStream(`https://cdn.example.com/stream_${i}.m3u8`, { autoplay: true });
      assert.equal(h.wrapper.classList.contains('embed-active'), false);
      assert.equal(p.video.muted, false);
      assert.equal(p.video.volume, 1);
    }
  }
});

test('CHALLENGE 3.3: Player.open() initializes unmuted state even if user previously muted playback', () => {
  const h = createPlayerHarness();
  const p = h.player;

  // Stale muted state from prior playback session
  p.video.muted = true;
  p.video.volume = 0;

  p.loadEpisode = () => {};
  p.getSavedWatchTime = () => 0;
  p.enterCinemaFullscreen = () => Promise.resolve();

  p.open({ name: 'Batman' }, { name: 'Tập 1' });

  assert.equal(p.video.muted, false, 'Player.open must force video.muted = false');
  assert.equal(p.video.volume, 1, 'Player.open must force video.volume = 1');
  assert.ok(h.resumedContexts.length >= 1, 'Audio context must be resumed');
});

// ============================================================================
// CHALLENGE 4: User Playback Interactions & Rapid Gesture Stress
// ============================================================================

test('CHALLENGE 4.1: Rapid play/pause toggling (50 cycles) preserves unmuted audio', () => {
  const h = createPlayerHarness();
  const p = h.player;

  p.video.muted = false;
  p.video.volume = 1;

  for (let i = 0; i < 50; i++) {
    p.togglePlayPause();
    assert.equal(p.video.muted, false, `Iteration ${i}: video.muted must remain false`);
    assert.equal(p.video.volume, 1, `Iteration ${i}: video.volume must remain 1`);
  }
});

test('CHALLENGE 4.2: Progress bar seeking preserves unmuted audio state', () => {
  const h = createPlayerHarness();
  const p = h.player;

  p.video.duration = 6000;
  p.video.currentTime = 100;
  p.video.muted = false;
  p.video.volume = 1;

  // Simulate progress bar click at 50%
  const fakeEvent = {
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) },
    clientX: 500
  };

  p.onProgressBarClick(fakeEvent);

  assert.equal(p.video.currentTime, 3000, 'currentTime should update to 3000');
  assert.equal(p.video.muted, false, 'video.muted must remain false after seek');
  assert.equal(p.video.volume, 1, 'video.volume must remain 1 after seek');
});

test('CHALLENGE 4.3: toggleMute() from zero-volume or near-zero restores volume to 1.0', () => {
  const h = createPlayerHarness();
  const p = h.player;

  // Test recovering from near-zero (0.02)
  p.video.muted = true;
  p.video.volume = 0.02;

  p.toggleMute();

  assert.equal(p.video.muted, false, 'video must be unmuted');
  assert.equal(p.video.volume, 1, 'near-zero volume must be recovered to 1.0');

  // Test muting
  p.toggleMute();
  assert.equal(p.video.muted, true, 'video must be muted');

  // Test unmuting from volume 1
  p.toggleMute();
  assert.equal(p.video.muted, false, 'video must be unmuted');
  assert.equal(p.video.volume, 1, 'volume should remain 1');
});

// ============================================================================
// CHALLENGE 5: Exhaustive DOM, CSS, and Asset Audit for Zero Manual Controls
// ============================================================================

test('CHALLENGE 5.1: Zero manual unmute button IDs and classes exist in public/index.html & public/web-index.html', () => {
  const forbiddenSelectors = [
    'btnPlayerAudioTop',
    'btnUnmuteOverlay',
    'btn-player-audio',
    'btn-unmute-overlay'
  ];

  forbiddenSelectors.forEach(sel => {
    assert.doesNotMatch(indexHtml, new RegExp(`\\b${sel}\\b`), `public/index.html must not contain ${sel}`);
    assert.doesNotMatch(webIndexHtml, new RegExp(`\\b${sel}\\b`), `public/web-index.html must not contain ${sel}`);
  });

  // Verify no text prompting user to unmute
  assert.doesNotMatch(indexHtml, /Bấm để bật âm thanh/i);
  assert.doesNotMatch(webIndexHtml, /Bấm để bật âm thanh/i);
});

test('CHALLENGE 5.2: Zero manual unmute rules exist in public/css/player.css while wake-up layer is intact', () => {
  assert.doesNotMatch(playerCss, /\.btn-player-audio/);
  assert.doesNotMatch(playerCss, /\.btn-unmute-overlay/);

  // Assert wake-up pseudo element is preserved
  assert.match(playerCss, /\.cinema-player-wrapper\.inactive\.embed-active::after/);
  assert.match(playerCss, /z-index:\s*45/);
});

test('CHALLENGE 5.3: HTML byte-for-byte identity between public/index.html and public/web-index.html', () => {
  assert.equal(indexHtml, webIndexHtml, 'HTML files must have 100% byte-for-byte parity');
});

// ============================================================================
// CHALLENGE 6: Iframe Embed Retries and Teardown Lifecycle
// ============================================================================

test('CHALLENGE 6.1: Embed load triggers initial postMessages and scheduled retries', () => {
  const h = createPlayerHarness();
  const p = h.player;

  p.wrapper.classList.add('embed-active');
  p.modal.classList.remove('hidden');

  // Trigger embed load
  p.embedReady = false;
  h.iframe.dispatchEvent({ type: 'load' });

  // Initial postMessages sent
  const initialUnmute = h.postMessages.filter(m => m.msg.command === 'unmute');
  assert.ok(initialUnmute.length >= 1, 'Initial unmute command must be sent');

  // Fast forward to 800ms
  h.flushTimers(800);
  const midUnmute = h.postMessages.filter(m => m.msg.command === 'unmute');
  assert.ok(midUnmute.length >= 3, 'Retries at 300ms and 800ms must be sent');

  // Fast forward through all retries (2500ms)
  h.flushTimers(3000);
  const finalUnmute = h.postMessages.filter(m => m.msg.command === 'unmute');
  assert.ok(finalUnmute.length >= 5, 'All 4 staggered retries must be sent');
});

test('CHALLENGE 6.2: Embed retries are cleanly cancelled/ignored if player is closed before timers expire', () => {
  const h = createPlayerHarness();
  const p = h.player;

  p.wrapper.classList.add('embed-active');
  p.modal.classList.remove('hidden');

  p.embedReady = false;
  h.iframe.dispatchEvent({ type: 'load' });

  const initialCount = h.postMessages.length;

  // User closes player at 100ms
  p.modal.classList.add('hidden');
  p.wrapper.classList.remove('embed-active');

  // Now flush remaining timers (300, 800, 1500, 2500ms)
  h.flushTimers(3000);

  assert.equal(h.postMessages.length, initialCount, 'No postMessages should be sent when player is closed');
});
