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
  return {
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
    dataset: {},
    setAttribute: (k, v) => attributes.set(k, String(v)),
    getAttribute: (k) => attributes.get(k) || null,
    removeAttribute: (k) => attributes.delete(k),
    hasAttribute: (k) => attributes.has(k),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent: (event) => {
      const fns = listeners.get(event.type) || [];
      fns.forEach(fn => fn(event));
    },
    cloneNode: function() {
      const clone = createDOMElement(tag, id);
      classes.forEach(c => clone.classList.add(c));
      attributes.forEach((v, k) => clone.setAttribute(k, v));
      clone.muted = this.muted;
      clone.volume = this.volume;
      clone.src = this.src;
      clone.dataset = { ...this.dataset };
      return clone;
    },
    replaceWith: function(next) {
      Object.assign(this, next);
    },
    replaceChildren: function() {},
    canPlayType: function() { return ''; },
    pause: function() { this.paused = true; },
    load: function() {},
    play: function() { return Promise.resolve(); }
  };
}

function createPlayerContext() {
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
      postMessages.push({ msg, target });
    }
  };
  elements.set('playerEmbed', iframe);

  const video = createDOMElement('video', 'videoPlayer');
  video.pause = function() { this.paused = true; };
  video.load = function() {};
  elements.set('videoPlayer', video);

  const wrapper = createDOMElement('div', 'playerWrapper');
  elements.set('playerWrapper', wrapper);

  const volumeSlider = createDOMElement('input', 'volumeSlider');
  volumeSlider.value = '1';
  elements.set('volumeSlider', volumeSlider);

  const btnPlayerAudioTop = createDOMElement('button', 'btnPlayerAudioTop');
  elements.set('btnPlayerAudioTop', btnPlayerAudioTop);

  const btnUnmuteOverlay = createDOMElement('button', 'btnUnmuteOverlay');
  btnUnmuteOverlay.classList.add('hidden');
  elements.set('btnUnmuteOverlay', btnUnmuteOverlay);

  const playerControls = createDOMElement('div', 'playerControls');
  elements.set('playerControls', playerControls);

  const btnCenterPlayPause = createDOMElement('button', 'btnCenterPlayPause');
  elements.set('btnCenterPlayPause', btnCenterPlayPause);

  const iconVolHigh = createDOMElement('span', 'iconVolHigh');
  elements.set('iconVolHigh', iconVolHigh);

  const iconVolMute = createDOMElement('span', 'iconVolMute');
  elements.set('iconVolMute', iconVolMute);

  const alerts = [];
  const resumedContexts = [];

  const ctx = {
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
      setTimeout: (fn) => 1,
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      requestAnimationFrame: (fn) => 1,
      cancelAnimationFrame: () => {},
      addEventListener: () => {},
      Phim4KAudio: {
        resume: () => { resumedContexts.push(true); },
        release: () => true,
        toggle: () => Promise.resolve(true)
      }
    },
    performance: { now: () => 100 },
    localStorage: {
      _store: new Map(),
      getItem(k) { return this._store.get(k) || null; },
      setItem(k, v) { this._store.set(k, String(v)); },
      removeItem(k) { this._store.delete(k); }
    },
    clearTimeout: () => {},
    clearInterval: () => {},
    navigator: { userAgent: 'Mozilla/5.0 (NodeTest; Linux)' }
  };

  vm.runInNewContext(playerJs + '\nglobalThis.subject = Player;', ctx);
  const p = ctx.subject;
  p.wrapper = wrapper;
  p.video = video;
  p.modal = { classList: { contains: () => false, remove() {}, add() {} } };
  p.showAlert = (msg) => { alerts.push(msg); };

  return { player: p, elements, postMessages, alerts, resumedContexts, video, wrapper, iframe };
}

test('M7.1: public/index.html and public/web-index.html are 100% byte-for-byte identical', () => {
  assert.equal(indexHtml, webIndexHtml, 'public/index.html and public/web-index.html must be identical');
});

test('M7.2: HTML markup includes wildcard iframe permissions and fallback video attributes', () => {
  assert.match(indexHtml, /<iframe id="playerEmbed" class="video-element hidden" src="about:blank" allow="accelerometer \*; autoplay \*; clipboard-write \*; encrypted-media \*; gyroscope \*; picture-in-picture \*; fullscreen \*" allowfullscreen loading="eager"><\/iframe>/);
  assert.match(indexHtml, /<video id="videoPlayer" class="video-element hidden" crossorigin="anonymous" playsinline webkit-playsinline preload="metadata"><\/video>/);
});

test('M7.3: HTML markup exposes #btnPlayerAudioTop and #btnUnmuteOverlay with Player.unmuteAllMedia()', () => {
  assert.match(indexHtml, /id="btnPlayerAudioTop"[^>]*class="[^"]*btn-player-audio[^"]*"[^>]*onclick="Player\.unmuteAllMedia\(\)"/);
  assert.match(indexHtml, /id="btnUnmuteOverlay"[^>]*class="[^"]*btn-unmute-overlay hidden[^"]*"[^>]*onclick="Player\.unmuteAllMedia\(\)"/);
  assert.doesNotMatch(indexHtml, /id="btnAudioMode"/, 'btnAudioMode must not be reintroduced');
});

test('M7.4: CSS rules exist for .btn-player-audio.active and .btn-unmute-overlay', () => {
  assert.match(playerCss, /\.btn-player-audio\.active\s*\{/);
  assert.match(playerCss, /\.btn-unmute-overlay\s*\{/);
  assert.match(playerCss, /z-index:\s*60/);
});

test('M7.5: Player.loadStream restores fallback HTML5 video surface, unhides controls, and cleans up embed', () => {
  const env = createPlayerContext();
  const p = env.player;

  // Simulate embed state before failover
  env.wrapper.classList.add('embed-active');
  env.video.classList.add('hidden');
  env.video.muted = true;
  env.video.volume = 0;
  env.iframe.classList.remove('hidden');
  env.iframe.src = 'https://player.phimapi.com/player/?url=test';
  env.elements.get('playerControls').classList.add('hidden');
  env.elements.get('btnCenterPlayPause').classList.add('hidden');
  env.elements.get('btnUnmuteOverlay').classList.remove('hidden');

  // Trigger fallback loadStream
  p.loadStream('https://cdn.example.com/fallback/stream.m3u8', { autoplay: true });

  assert.equal(env.wrapper.classList.contains('embed-active'), false, 'embed-active must be removed from wrapper');
  assert.equal(p.video.classList.contains('hidden'), false, 'hidden must be removed from videoPlayer');
  assert.equal(p.video.crossOrigin, 'anonymous', 'videoPlayer must have crossOrigin = anonymous');
  assert.equal(p.video.muted, false, 'videoPlayer must be unmuted');
  assert.ok(p.video.volume >= 0.9, 'videoPlayer volume must be restored to 1');
  assert.equal(env.iframe.classList.contains('hidden'), true, 'playerEmbed iframe must be hidden');
  assert.equal(env.iframe.src, 'about:blank', 'playerEmbed src must be set to about:blank');
  assert.equal(env.elements.get('playerControls').classList.contains('hidden'), false, 'playerControls must be visible');
  assert.equal(env.elements.get('btnCenterPlayPause').classList.contains('hidden'), false, 'btnCenterPlayPause must be visible');
  assert.equal(env.elements.get('btnUnmuteOverlay').classList.contains('hidden'), true, 'btnUnmuteOverlay must be hidden');
});

test('M7.6: Player.toggleMute recovers from zero-volume trap and dispatches iframe audio commands', () => {
  const env = createPlayerContext();
  const p = env.player;

  // Case 1: Video is muted and at 0 volume
  env.video.muted = true;
  env.video.volume = 0;
  env.elements.get('volumeSlider').value = '0';

  p.toggleMute();

  assert.equal(env.video.muted, false, 'video should be unmuted');
  assert.equal(env.video.volume, 1, 'zero-volume should be recovered to 1');
  assert.equal(env.elements.get('volumeSlider').value, 1, 'slider value should update to 1');
  assert.equal(env.resumedContexts.length, 1, 'Phim4KAudio.resume should be called');

  const unmuteMsg = env.postMessages.find(m => m.msg.command === 'unmute');
  assert.ok(unmuteMsg, 'postIframeAudioCommand must send unmute');

  // Case 2: Video is unmuted and at 1 volume -> mute it
  p.toggleMute();
  assert.equal(env.video.muted, true, 'video should be muted');
  const muteMsg = env.postMessages.find(m => m.msg.command === 'mute');
  assert.ok(muteMsg, 'postIframeAudioCommand must send mute');
});

test('M7.7: Player.unmuteAllMedia unpauses audio, sets volume to 1, posts cross-origin commands, and updates UI', () => {
  const env = createPlayerContext();
  const p = env.player;

  env.video.muted = true;
  env.video.volume = 0;
  env.elements.get('btnUnmuteOverlay').classList.remove('hidden');

  p.unmuteAllMedia();

  assert.equal(env.video.muted, false, 'video must be unmuted');
  assert.equal(env.video.volume, 1, 'volume must be restored to 1');
  assert.equal(env.elements.get('volumeSlider').value, 1, 'slider must be set to 1');
  assert.equal(env.elements.get('btnPlayerAudioTop').textContent, '🔊 Âm thanh');
  assert.equal(env.elements.get('btnPlayerAudioTop').classList.contains('active'), true);
  assert.equal(env.elements.get('btnUnmuteOverlay').classList.contains('hidden'), true, 'overlay must be hidden');
  assert.ok(env.alerts.some(a => a.includes('Đã bật âm thanh')), 'alert must be shown');

  // Check all expected cross-origin iframe postMessage formats
  const commands = env.postMessages.map(m => m.msg.command || m.msg.func || m.msg.action);
  assert.ok(commands.includes('unmute'));
  assert.ok(commands.includes('setVolume'));
  assert.ok(commands.includes('unMute'));
});

test('M7.8: Player.postIframeAudioCommand forwards structured postMessage variants without throwing', () => {
  const env = createPlayerContext();
  const p = env.player;

  env.postMessages.length = 0;
  p.postIframeAudioCommand('setVolume', 0.8);
  assert.ok(env.postMessages.some(m => m.msg.command === 'setVolume' && m.msg.volume === 0.8));

  // Error safety test: cross-origin iframe throwing should not bubble
  env.iframe.contentWindow.postMessage = () => { throw new Error('Blocked a frame with origin'); };
  assert.doesNotThrow(() => {
    p.postIframeAudioCommand('unmute');
  });
});

test('M7.9: Waking embed chrome via pointerdown on .inactive.embed-active surface invokes unmuteAllMedia', () => {
  const env = createPlayerContext();
  const p = env.player;

  let unmuteCalled = false;
  p.unmuteAllMedia = () => { unmuteCalled = true; };

  // Set up wrapper in inactive embed-active state
  env.wrapper.classList.add('embed-active');
  env.wrapper.classList.add('inactive');

  // Simulate pointerdown on wrapper (intercepted by ::after pseudo-element)
  env.wrapper.dispatchEvent({
    type: 'pointerdown',
    target: env.wrapper,
    closest: () => null
  });

  assert.equal(unmuteCalled, true, 'unmuteAllMedia must be invoked when tapping inactive embed overlay');
});

test('M7.10: Player.releaseAudioVideo strips reliabilityHotfix350 marker to preserve stall watchdog continuity', () => {
  const env = createPlayerContext();
  const p = env.player;

  env.video.dataset.reliabilityHotfix350 = '1';
  env.video.setAttribute('data-reliability-hotfix350', '1');

  p.releaseAudioVideo();

  assert.equal(p.video.dataset.reliabilityHotfix350, undefined, 'dataset.reliabilityHotfix350 must be removed from replacement node');
  assert.equal(p.video.hasAttribute('data-reliability-hotfix350'), false, 'data-reliability-hotfix350 attribute must be removed');
  assert.equal(p.video.crossOrigin, 'anonymous', 'replacement node must preserve crossOrigin');
});

test('M7.11: AudioEnhancer resumes suspended AudioContext on resume() and video play event', async () => {
  let resumed = 0;
  const mockContext = {
    state: 'suspended',
    resume: async () => { resumed++; mockContext.state = 'running'; },
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
  assert.ok(typeof audio.resume === 'function', 'Phim4KAudio.resume must be exported');

  // Setup mock video
  const playListeners = [];
  const mockVideo = {
    isConnected: true,
    src: 'https://localhost/media/qa-test.mp4',
    currentSrc: 'https://localhost/media/qa-test.mp4',
    addEventListener: (type, fn) => {
      if (type === 'play') playListeners.push(fn);
    }
  };

  await audio.toggle(mockVideo);
  assert.equal(resumed, 1, 'toggle should resume context');

  // Simulate context becoming suspended (e.g. backgrounding / tab switch)
  mockContext.state = 'suspended';

  // Test explicit resume()
  audio.resume();
  assert.equal(resumed, 2, 'audio.resume() should resume suspended context');

  // Simulate video play event
  mockContext.state = 'suspended';
  playListeners.forEach(fn => fn());
  assert.equal(resumed, 3, 'play event listener on video should resume suspended context');
});

test('M7.12: AudioEnhancer uses unity gain and guards against WebKit iOS streaming media silence', async () => {
  let createdGain = null;
  const mockContext = {
    state: 'running',
    resume: async () => {},
    close: async () => {},
    createBiquadFilter: () => ({ connect() {}, frequency: {}, Q: {}, gain: {} }),
    createDynamicsCompressor: () => ({ connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
    createGain: () => {
      createdGain = { connect() {}, gain: { value: 0 } };
      return createdGain;
    },
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    destination: {}
  };

  const sandbox = {
    window: {
      location: { href: 'https://localhost/' },
      AudioContext: function() { return mockContext; }
    },
    URL,
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
  };

  vm.runInNewContext(enhancerJs, sandbox);
  const audio = sandbox.window.Phim4KAudio;

  // iOS WebKit guard on streaming blob URL
  const iosBlobVideo = {
    isConnected: true,
    src: 'blob:https://localhost/uuid-stream',
    currentSrc: 'blob:https://localhost/uuid-stream',
    addEventListener: () => {}
  };

  await assert.rejects(
    () => audio.toggle(iosBlobVideo),
    /giữ âm gốc/,
    'iOS WebKit must reject capturing blob streams to prevent silent audio bug'
  );

  // Normal mp4 on standard browser
  sandbox.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const standardVideo = {
    isConnected: true,
    src: 'https://localhost/media/test.mp4',
    currentSrc: 'https://localhost/media/test.mp4',
    addEventListener: () => {}
  };

  await audio.toggle(standardVideo);
  assert.ok(createdGain, 'GainNode must be created');
  assert.equal(createdGain.gain.value, 1.0, 'GainNode must use unity gain (1.0) rather than attenuating by 25%');
});

test('M7.13: Keyboard ArrowUp and ArrowDown adjust volume and synchronize iframe audio state', () => {
  const env = createPlayerContext();
  const p = env.player;

  env.video.volume = 0.5;
  env.video.muted = true;

  // ArrowUp
  p.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(env.video.volume, 0.6);
  assert.equal(env.video.muted, false);
  assert.ok(env.postMessages.some(m => m.msg.command === 'setVolume' && m.msg.volume === 0.6));

  // ArrowDown
  p.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(env.video.volume, 0.5);
  assert.ok(env.postMessages.some(m => m.msg.command === 'setVolume' && m.msg.volume === 0.5));
});

test('M7.14: Player.open initializes unmuted audio and resets audio UI state', () => {
  const env = createPlayerContext();
  const p = env.player;

  // Pre-condition: player was previously muted
  env.video.muted = true;
  env.video.volume = 0.2;
  env.elements.get('btnPlayerAudioTop').classList.remove('active');
  env.elements.get('btnUnmuteOverlay').classList.remove('hidden');

  p.loadEpisode = () => {};
  p.getSavedWatchTime = () => 0;
  p.enterCinemaFullscreen = () => Promise.resolve();

  p.open({ name: 'Test Movie' }, { name: 'Ep 1' });

  assert.equal(env.video.muted, false, 'Player.open must reset muted to false');
  assert.equal(env.video.volume, 1, 'Player.open must reset volume to 1');
  assert.equal(env.elements.get('btnPlayerAudioTop').textContent, '🔊 Âm thanh');
  assert.equal(env.elements.get('btnPlayerAudioTop').classList.contains('active'), true);
  assert.equal(env.elements.get('btnUnmuteOverlay').classList.contains('hidden'), true);
});
