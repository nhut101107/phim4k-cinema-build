(() => {
  const start = performance.now();
  const heartbeat = () => {
    if (document.hidden) return;
    const video = document.querySelector('video');
    const context = { ...API.getOperationalContext(), visibility: 'visible', uptime: Math.round((performance.now() - start) / 1000) };
    if (video && !video.paused) {
      context.seconds = Math.round(video.currentTime || 0);
      context.readyState = video.readyState;
      context.buffered = video.buffered.length ? Math.max(0, Math.round(video.buffered.end(video.buffered.length - 1) - video.currentTime)) : 0;
    }
    API.trackUsage('heartbeat', context);
  };
  setInterval(heartbeat, 60000);
  document.addEventListener('visibilitychange', () => API.trackUsage('app_visibility', { visibility: document.hidden ? 'hidden' : 'visible' }));
  for (const event of ['online', 'offline']) window.addEventListener(event, () => API.trackUsage('network_change', { network: event }));
  // Never ship raw error messages, stack traces, URLs or user-entered text.
  let lastError = 0;
  const report = kind => { if (Date.now() - lastError > 10000) { lastError = Date.now(); API.trackUsage('client_error', { error: kind }); } };
  window.addEventListener('error', () => report('javascript_error'));
  window.addEventListener('unhandledrejection', () => report('unhandled_promise'));
})();

// 3.50 reliability hotfix shared by iOS, Android, Android TV and Windows.
(() => {
  if (typeof App !== 'undefined') {
    App.resolveDirectImageUrl = function resolveDirectImageUrl(path) {
      const value = String(path || '').trim();
      if (!value) return this.posterFallbackUrl();
      if (value.startsWith('/media/')) return value;

      const relayOrigin = String(window.Phim4KRuntime?.apiBaseUrl || '').replace(/\/+$/, '');
      if (value.startsWith('/api/media/image')) return relayOrigin ? `${relayOrigin}${value}` : value;

      try {
        const parsed = new URL(value, window.location.href);
        if (parsed.protocol !== 'https:') return this.posterFallbackUrl();
        // Worker-protected images and cached direct HTTPS artwork are both valid.
        return parsed.href;
      } catch (_error) {
        return this.posterFallbackUrl();
      }
    };
  }

  if (typeof Player === 'undefined' || Player.__reliabilityHotfix350) return;
  Player.__reliabilityHotfix350 = true;
  Player.stallRecoveryTimer = null;
  Player.streamLoadTimer = null;
  Player.streamRecoveryInFlight = false;
  Player.recentRecoveryAttempts = [];
  Player.lastPlaybackTime = 0;

  const originalInit = Player.init.bind(Player);
  const originalOpen = Player.open.bind(Player);
  const originalClose = Player.close.bind(Player);
  const originalLoadStream = Player.loadStream.bind(Player);
  const originalOnStreamReady = Player.onStreamReady.bind(Player);
  const originalSwitchServer = Player.switchServer.bind(Player);
  const originalFallback = Player.fallbackToNextServer.bind(Player);
  const originalNativeError = Player.onNativeVideoError.bind(Player);
  const originalReleaseAudioVideo = Player.releaseAudioVideo.bind(Player);

  Player.clearPlaybackWatchdogs = function clearPlaybackWatchdogs() {
    if (this.stallRecoveryTimer) clearTimeout(this.stallRecoveryTimer);
    if (this.streamLoadTimer) clearTimeout(this.streamLoadTimer);
    this.stallRecoveryTimer = null;
    this.streamLoadTimer = null;
  };

  Player.notePlaybackProgress = function notePlaybackProgress() {
    const current = Number(this.video?.currentTime) || 0;
    if (current > this.lastPlaybackTime + 0.2) {
      this.lastPlaybackTime = current;
      if (this.stallRecoveryTimer) {
        clearTimeout(this.stallRecoveryTimer);
        this.stallRecoveryTimer = null;
      }
    }
  };

  Player.startStreamLoadWatchdog = function startStreamLoadWatchdog(session, resumeTime = 0) {
    if (this.streamLoadTimer) clearTimeout(this.streamLoadTimer);
    this.streamLoadTimer = window.setTimeout(() => {
      this.streamLoadTimer = null;
      if (session !== this.streamSession || this.modal?.classList.contains('hidden')) return;
      if (this.video?.readyState >= 1) return;
      void this.refreshPlaybackTicketAndResume('load-timeout', Number(this.video?.currentTime) || resumeTime || 0);
    }, 15000);
  };

  Player.scheduleStallRecovery = function scheduleStallRecovery(reason = 'stall', delayMs = 12000) {
    if (!this.currentEpisode?.stream_ref || this.modal?.classList.contains('hidden')) return;
    if (this.video?.paused || this.video?.ended) return;
    if (this.stallRecoveryTimer) clearTimeout(this.stallRecoveryTimer);
    const session = this.streamSession;
    const observedTime = Number(this.video?.currentTime) || 0;
    this.stallRecoveryTimer = window.setTimeout(() => {
      this.stallRecoveryTimer = null;
      if (session !== this.streamSession || this.modal?.classList.contains('hidden')) return;
      if (this.video?.paused || this.video?.ended) return;
      const current = Number(this.video?.currentTime) || 0;
      if (current > observedTime + 0.5) return;
      void this.refreshPlaybackTicketAndResume(reason, current);
    }, Math.max(4000, Number(delayMs) || 12000));
  };

  Player.refreshPlaybackTicketAndResume = async function refreshPlaybackTicketAndResume(reason = 'recovery', resumeOverride = null) {
    if (this.streamRecoveryInFlight || !this.currentEpisode?.stream_ref || this.modal?.classList.contains('hidden')) return;

    const now = Date.now();
    this.recentRecoveryAttempts = this.recentRecoveryAttempts.filter(timestamp => now - timestamp < 90000);
    if (this.recentRecoveryAttempts.length >= 3) {
      this.showBuffering(false);
      this.showAlert('Luồng này liên tục mất kết nối. Đang thử server khác…');
      this.activeStreamUrl = '';
      originalFallback();
      return;
    }

    this.recentRecoveryAttempts.push(now);
    this.streamRecoveryInFlight = true;
    this.clearPlaybackWatchdogs();
    const resumeTime = Number.isFinite(Number(resumeOverride))
      ? Number(resumeOverride)
      : (Number(this.video?.currentTime) || this.getSavedWatchTime() || 0);
    const requestId = ++this.playbackTicketRequest;
    this.showBuffering(true, 'Đang nối lại luồng phim…');
    this.setResolutionBadge(0, 0, 'Đang nối lại');

    try {
      const result = await API.getPlaybackTicket(this.currentEpisode.stream_ref);
      if (requestId !== this.playbackTicketRequest || this.modal?.classList.contains('hidden')) return;
      this.loadStream(result.streamUrl, { resumeTime, autoplay: true, isHls: Boolean(result.isHls) });
    } catch (_error) {
      if (requestId !== this.playbackTicketRequest) return;
      this.showBuffering(false);
      this.showAlert('Không nối lại được luồng hiện tại. Đang thử server khác…');
      this.activeStreamUrl = '';
      originalFallback();
    } finally {
      if (requestId === this.playbackTicketRequest) this.streamRecoveryInFlight = false;
    }
  };

  Player.bindReliabilityEvents = function bindReliabilityEvents() {
    if (!this.video || this.video.dataset.reliabilityHotfix350 === '1') return;
    this.video.dataset.reliabilityHotfix350 = '1';
    this.video.addEventListener('timeupdate', () => this.notePlaybackProgress());
    this.video.addEventListener('waiting', () => this.scheduleStallRecovery('waiting'));
    this.video.addEventListener('stalled', () => {
      this.showBuffering(true, 'Luồng đang bị gián đoạn…');
      this.scheduleStallRecovery('stalled', 9000);
    });
    this.video.addEventListener('playing', () => this.clearPlaybackWatchdogs());
  };

  Player.init = function initWithRecovery() {
    originalInit();
    this.bindReliabilityEvents();
  };

  Player.releaseAudioVideo = function releaseAudioVideoWithRecovery(...args) {
    const result = originalReleaseAudioVideo(...args);
    this.bindReliabilityEvents();
    return result;
  };

  Player.open = function openWithRecovery(...args) {
    this.clearPlaybackWatchdogs();
    this.streamRecoveryInFlight = false;
    this.recentRecoveryAttempts = [];
    this.lastPlaybackTime = 0;
    return originalOpen(...args);
  };

  Player.close = function closeWithRecovery(...args) {
    this.clearPlaybackWatchdogs();
    this.streamRecoveryInFlight = false;
    return originalClose(...args);
  };

  Player.loadStream = function loadStreamWithRecovery(streamUrl, options = {}) {
    const result = originalLoadStream(streamUrl, options);
    if (streamUrl && this.activeStreamUrl === streamUrl) this.startStreamLoadWatchdog(this.streamSession, Number(options.resumeTime) || 0);
    return result;
  };

  Player.onStreamReady = function onStreamReadyWithRecovery(...args) {
    this.clearPlaybackWatchdogs();
    return originalOnStreamReady(...args);
  };

  Player.switchServer = function switchServerWithRecovery(...args) {
    this.clearPlaybackWatchdogs();
    this.streamRecoveryInFlight = false;
    return originalSwitchServer(...args);
  };

  // Retry the current signed stream first. This keeps long movies alive when
  // a temporary CDN/VPS failure occurs and resumes at the viewer's position.
  Player.fallbackToNextServer = function fallbackWithRecovery() {
    if (this.activeStreamUrl && this.currentEpisode?.stream_ref && !this.modal?.classList.contains('hidden')) {
      void this.refreshPlaybackTicketAndResume('stream-fallback');
      return;
    }
    return originalFallback();
  };

  Player.onNativeVideoError = function nativeErrorWithRecovery() {
    if (!this.activeStreamUrl || this.hls || this.modal?.classList.contains('hidden')) return originalNativeError();
    const currentSource = this.video?.currentSrc || this.video?.src || '';
    if (!currentSource || !this.isActiveStreamSource(currentSource)) return;
    void this.refreshPlaybackTicketAndResume('native-error');
  };

  // If player.js initialized before this late-loaded hotfix, attach recovery now.
  window.Player?.bindReliabilityEvents?.();
})();

// Keep all built-in installer links aligned with the Worker's real download routes.
(() => {
  const routes = {
    forceBtnApk: '/download/android',
    forceBtnIpa: '/download/ios',
    forceBtnExe: '/download/windows',
    forceBtnTv: '/download/android-tv',
  };
  const apply = () => {
    for (const [id, href] of Object.entries(routes)) {
      const element = document.getElementById(id);
      if (!element) continue;
      element.href = href;
      element.removeAttribute('aria-disabled');
      if (id === 'forceBtnTv' && element.textContent.includes('Chưa phát hành')) element.textContent = 'Tải Bản Mới (.APK)';
    }
    const placeholders = {
      adminDownloadApkInput: '/download/android',
      adminDownloadIpaInput: '/download/ios',
      adminDownloadExeInput: '/download/windows',
      adminDownloadTvInput: '/download/android-tv',
    };
    for (const [id, value] of Object.entries(placeholders)) {
      const input = document.getElementById(id);
      if (input) input.placeholder = value;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
})();

// Download metadata is release-authoritative. Native builds query GitHub's
// latest published release directly, cache it briefly, and merge it over the
// backend list. This prevents an old D1 row from sending users to stale builds.
(() => {
  if (!window.API?.fetchJson) return;

  const RELEASE_API = 'https://api.github.com/repos/nhut101107/phim4k-cinema-build/releases/latest';
  const CACHE_KEY = 'phim4k_release_manifest_v2';
  const CACHE_TTL = 10 * 60 * 1000;
  const platformMatchers = {
    android_tv: (name) => /^4K-Cinema-Android-TV-[0-9.]+\.apk$/i.test(name),
    android: (name) => /^4K-Cinema-Android-[0-9.]+\.apk$/i.test(name),
    ios: (name) => /^4K-Cinema-iOS-[0-9.]+(?:-unsigned)?\.ipa$/i.test(name),
    windows: (name) => /^4K-Cinema-Windows-[0-9.]+-x64\.exe$/i.test(name),
  };

  const digest = (value) => {
    const match = String(value || '').trim().toLowerCase().match(/^sha256:([a-f0-9]{64})$/);
    return match ? match[1] : '';
  };

  const versionOf = (release, assetName) => {
    for (const value of [assetName, release?.tag_name, release?.name]) {
      const match = String(value || '').match(/(?:^|[^0-9])v?(\d+\.\d+(?:\.\d+)?)(?:[^0-9]|$)/i);
      if (match) return match[1];
    }
    return '';
  };

  const normalize = (downloads) => ({
    ...downloads,
    androidUrl: downloads.android?.url || '',
    androidVersion: downloads.android?.version || '',
    iosUrl: downloads.ios?.url || '',
    iosVersion: downloads.ios?.version || '',
    windowsUrl: downloads.windows?.url || '',
    windowsVersion: downloads.windows?.version || '',
    android_tvUrl: downloads.android_tv?.url || '',
    android_tvVersion: downloads.android_tv?.version || '',
  });

  const fromRelease = (release) => {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const output = {};
    for (const [platform, matches] of Object.entries(platformMatchers)) {
      const asset = assets.find((candidate) => matches(String(candidate?.name || '')));
      if (!asset) continue;
      const sha256 = digest(asset.digest);
      const sizeBytes = Number(asset.size || 0);
      const url = String(asset.browser_download_url || '').trim();
      const version = versionOf(release, asset.name);
      if (!/^https:\/\/github\.com\//i.test(url) || !sha256 || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !version) continue;
      output[platform] = {
        url,
        version,
        sha256,
        sizeBytes,
        signer: String(asset?.uploader?.login || 'github-actions').slice(0, 200),
      };
    }
    return normalize(output);
  };

  const cachedRelease = () => {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!value?.savedAt || Date.now() - value.savedAt > CACHE_TTL) return null;
      return value.downloads || null;
    } catch (_error) {
      return null;
    }
  };

  const fetchRelease = () => new Promise((resolve, reject) => {
    const cached = cachedRelease();
    if (cached) {
      resolve(cached);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', RELEASE_API, true);
    xhr.responseType = 'json';
    xhr.timeout = 12000;
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`GITHUB_RELEASE_HTTP_${xhr.status}`));
        return;
      }
      const downloads = fromRelease(xhr.response || {});
      const validCount = ['android', 'android_tv', 'ios', 'windows'].filter((key) => downloads[key]?.url).length;
      if (!validCount) {
        reject(new Error('GITHUB_RELEASE_HAS_NO_VALID_ASSETS'));
        return;
      }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), downloads })); } catch (_error) {}
      resolve(downloads);
    };
    xhr.onerror = () => reject(new Error('GITHUB_RELEASE_NETWORK_ERROR'));
    xhr.ontimeout = () => reject(new Error('GITHUB_RELEASE_TIMEOUT'));
    xhr.send();
  });

  const originalFetchJson = API.fetchJson.bind(API);
  API.fetchJson = async function releaseAwareFetchJson(input, options = {}, timeoutMs = 15000) {
    const endpoint = typeof input === 'string' ? input.split('?')[0] : '';
    if (endpoint !== '/api/app/downloads') return originalFetchJson(input, options, timeoutMs);

    let backend = {};
    let backendError = null;
    try {
      backend = await originalFetchJson(input, options, timeoutMs);
    } catch (error) {
      backendError = error;
    }

    let live = {};
    try { live = await fetchRelease(); } catch (_error) {}

    const merged = {};
    for (const platform of ['android', 'android_tv', 'ios', 'windows']) {
      merged[platform] = live?.[platform]?.url ? live[platform] : backend?.[platform];
    }
    const result = normalize(merged);
    const validCount = ['android', 'android_tv', 'ios', 'windows'].filter((key) => result[key]?.url && result[key]?.sha256).length;
    if (validCount) return result;
    if (backendError) throw backendError;
    return backend;
  };
})();
