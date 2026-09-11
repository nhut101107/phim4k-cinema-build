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
  this?.Player?.bindReliabilityEvents?.();
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
