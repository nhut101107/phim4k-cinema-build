// Shared Phim4K player. It stays inside the Capacitor WebView so custom controls,
// subtitles and the selected server keep their context on every platform.

const Player = {
  video: null,
  hls: null,
  modal: null,
  wrapper: null,
  currentMovie: null,
  currentEpisode: null,
  episodesList: [],
  currentEpIndex: 0,
  allServers: [],
  currentServerIndex: 0,
  inactivityTimer: null,
  saveInterval: null,
  alertTimer: null,
  aspectMode: 'contain',
  isCinemaFullscreen: false,
  streamSession: 0,
  playbackTicketRequest: 0,
  activeStreamUrl: '',
  qualityOptions: [],
  qualityMode: 'auto',
  usingNativeHls: false,
  failedServerIndexes: new Set(),
  mediaRecoveryCount: 0,
  playbackStartLogged: false,
  watchedSeconds: 0,
  activePlayStartedAt: 0,
  autoSkipAdsEnabled: true,
  skippedAdMarkers: new Set(),

  init() {
    if (this.video) return;
    this.video = document.getElementById('videoPlayer');
    this.modal = document.getElementById('playerModal');
    this.wrapper = document.getElementById('playerWrapper');
    if (!this.video || !this.modal || !this.wrapper) return;
    this.videoBindings = [];
    const onVideo = (type, listener, options) => { this.videoBindings.push({type,listener,options}); this.video.addEventListener(type,listener,options); };

    onVideo('play', () => {
      if (!this.activePlayStartedAt) this.activePlayStartedAt = performance.now();
      this.updatePlayBtn(true);
      this.resetInactivityTimer();
      if (!this.playbackStartLogged) {
        this.playbackStartLogged = true;
        API.trackUsage('playback_start', this.usageContext());
      }
    });
    onVideo('pause', () => {
      this.captureWatchedTime();
      this.saveProgressNow({ flush: true });
      this.updatePlayBtn(false);
    });
    onVideo('timeupdate', () => this.onTimeUpdate());
    onVideo('progress', () => this.onProgress());
    onVideo('waiting', () => this.showBuffering(true, 'Đang đệm dữ liệu…'));
    onVideo('playing', () => this.showBuffering(false));
    onVideo('ended', () => this.onEnded());
    onVideo('error', () => this.onNativeVideoError());
    onVideo('resize', () => this.updateCurrentResolution());
    onVideo('click', event => this.onSurfaceTap(event));
    onVideo('pointerdown', event => { this.tapStart = { x: event.clientX, y: event.clientY }; this.tapDragged = false; }, { passive: true });
    onVideo('pointerup', event => { this.tapDragged = this.tapStart && Math.hypot(event.clientX - this.tapStart.x, event.clientY - this.tapStart.y) > 30; }, { passive: true });

    this.wrapper.addEventListener('pointermove', event => {
      if (event.pointerType === 'mouse') this.resetInactivityTimer();
    }, { passive: true });
    this.wrapper.addEventListener('pointerdown', event => {
      if (event.target.closest('button, input, .player-controls')) this.resetInactivityTimer();
    }, { passive: true });
    window.addEventListener('resize', () => {
      if (!this.modal.classList.contains('hidden')) {
        this.syncFullscreenViewport();
        this.applyPreferredAspect();
      }
    });
    window.visualViewport?.addEventListener('resize', () => {
      if (!this.modal.classList.contains('hidden')) this.syncFullscreenViewport();
    });
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
      progressContainer.addEventListener('click', (event) => this.onProgressBarClick(event));
      progressContainer.addEventListener('mousemove', (event) => this.onProgressBarHover(event));
    }
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (event) => {
        this.video.volume = Number(event.target.value);
        this.video.muted = false;
        this.updateVolumeIcons();
      });
    }
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('pagehide', () => this.saveProgressNow({ flush: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveProgressNow({ flush: true });
    });
    document.addEventListener('fullscreenchange', () => this.onBrowserFullscreenChange());
    this.loadAutoSkipPreference();
  },

  open(movie, episode, episodesList = [], epIndex = 0, allServers = [], serverIndex = 0) {
    window.Phim4KTrailer?.stop();
    this.clearSurfaceTap();
    if (!this.video) this.init();
    if (!this.video || !movie || !episode) return;
    clearTimeout(this.alertTimer);
    document.getElementById('playerAlert')?.classList.add('hidden');
    this.currentMovie = movie;
    this.currentEpisode = episode;
    this.episodesList = Array.isArray(episodesList) ? episodesList : [];
    this.currentEpIndex = Number.isInteger(epIndex) ? epIndex : 0;
    this.allServers = Array.isArray(allServers) ? allServers : [];
    this.currentServerIndex = Number.isInteger(serverIndex) ? serverIndex : 0;
    this.failedServerIndexes.clear();
    this.playbackStartLogged = false;
    this.watchedSeconds = 0;
    this.activePlayStartedAt = 0;
    this.skippedAdMarkers.clear();
    this.loadAutoSkipPreference();
    API.trackUsage('episode_open', this.usageContext(movie, episode));

    document.getElementById('playerMovieTitle').textContent = movie.name || 'Phim';
    document.getElementById('playerEpisodeTitle').textContent = episode.name || `Tập ${this.currentEpIndex + 1}`;
    this.renderInPlayerServerMenu();
    this.updateNextEpisodeButton();
    this.closeDropdowns();
    this.modal.classList.remove('hidden');
    document.body.classList.add('player-open');
    this.applyPreferredAspect();
    this.loadEpisode(episode, { resumeTime: this.getSavedWatchTime(), autoplay: true });
    this.startProgressSaveTimer();
    this.resetInactivityTimer();
  },

  close() {
    this.clearSurfaceTap();
    this.saveProgressNow({ flush: true });
    this.captureWatchedTime();
    if (Number(this.video?.currentTime) > 1) {
      API.trackUsage('playback_stop', {
        ...this.usageContext(),
        seconds: this.video.currentTime,
        duration: Number.isFinite(this.video.duration) ? this.video.duration : 0,
        watched: this.watchedSeconds
      });
    }
    void this.exitCinemaFullscreen();
    this.streamSession += 1;
    this.playbackTicketRequest += 1;
    this.activeStreamUrl = '';
    this.closeDropdowns();
    this.destroyHls();
    this.releaseAudioVideo();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveInterval = null;
    clearTimeout(this.inactivityTimer);
    this.wrapper?.classList.remove('inactive');
    this.modal?.classList.add('hidden');
    document.body.classList.remove('player-open');
    this.activePlayStartedAt = 0;
  },

  captureWatchedTime() {
    if (!this.activePlayStartedAt) return;
    this.watchedSeconds += Math.max(0, (performance.now() - this.activePlayStartedAt) / 1000);
    this.activePlayStartedAt = 0;
  },

  async loadEpisode(episode, options = {}) {
    const requestId = ++this.playbackTicketRequest;
    if (!episode?.stream_ref) {
      this.showBuffering(false);
      this.showAlert('Server này không cung cấp vé phát an toàn. Đang thử server khác…');
      this.fallbackToNextServer();
      return;
    }
    this.showBuffering(true, 'Đang xác thực vé phát an toàn…');
    this.setResolutionBadge(0, 0, 'Đang xác minh');
    try {
      const result = await API.getPlaybackTicket(episode.stream_ref);
      if (requestId !== this.playbackTicketRequest || this.modal?.classList.contains('hidden')) return;
      this.loadStream(result.streamUrl, { ...options, isHls: Boolean(result.isHls) });
    } catch (error) {
      if (requestId !== this.playbackTicketRequest) return;
      this.showBuffering(false);
      const sourceOffline = ['STREAM_SOURCE_OFFLINE', 'STREAM_SOURCE_UNREACHABLE', 'INVALID_STREAM_SOURCE']
        .includes(error?.payload?.code);
      this.showAlert(sourceOffline
        ? 'Nguồn phim đã bị gỡ hoặc tạm lỗi. Đang thử server khác…'
        : 'Không lấy được vé phát. Đang thử server khác…');
      this.fallbackToNextServer();
    }
  },

  loadStream(streamUrl, options = {}) {
    this.releaseAudioVideo();
    const session = ++this.streamSession;
    const resumeTime = Number(options.resumeTime) || 0;
    const autoplay = options.autoplay !== false;
    const isHls = options.isHls === true;
    if (!streamUrl) {
      this.showBuffering(false);
      this.showAlert('Không có luồng phát tương thích ở server này. Đang thử server khác…');
      this.fallbackToNextServer();
      return;
    }

    this.activeStreamUrl = streamUrl;
    this.mediaRecoveryCount = 0;
    this.qualityOptions = [];
    this.qualityMode = 'auto';
    this.usingNativeHls = false;
    this.destroyHls();
    this.closeDropdowns();
    this.showBuffering(true, 'Đang kết nối luồng phim…');
    this.setResolutionBadge(0, 0, 'Đang xác minh');
    this.populateQualityMenu([]);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();

    this.video.addEventListener('loadedmetadata', () => {
      if (session === this.streamSession) this.onStreamReady(resumeTime, autoplay);
    }, { once: true });

    // Capacitor on iOS must prefer AVFoundation's native HLS path. Recent
    // WKWebView versions may expose enough MSE for hls.js to report support,
    // but cross-origin segment requests can then fail even though native HLS
    // can play the same HTTPS playlist directly. Android WebView instead uses
    // hls.js when MSE is available, preserving adaptive quality and recovery;
    // the native video element below remains its compatibility fallback.
    if (isHls && this.nativePlatform() === 'ios') {
      this.usingNativeHls = true;
      this.populateNativeHlsMenu();
      this.setQualityButtonLabel('Tự động');
      this.video.src = streamUrl;
      this.video.load();
      return;
    }

    const HlsEngine = window.Hls;
    if (isHls && HlsEngine?.isSupported?.()) {
      const hls = new HlsEngine({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
        xhrSetup: (xhr) => { xhr.withCredentials = false; }
      });
      this.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(this.video);
      hls.on(HlsEngine.Events.MANIFEST_PARSED, () => {
        if (session !== this.streamSession || hls !== this.hls) return;
        // A rendition change is telemetry, never a request to lock playback.
        hls.currentLevel = -1;
        this.qualityOptions = PlayerCore.uniqueQualityOptions(hls.levels);
        this.populateQualityMenu(this.qualityOptions);
        this.setAvailableResolution(this.qualityOptions);
      });
      hls.on(HlsEngine.Events.LEVEL_SWITCHED, (_event, data) => {
        if (session !== this.streamSession || hls !== this.hls) return;
        const level = hls.levels[data.level];
        if (!level) return;
        const option = PlayerCore.qualityOption(level, data.level);
        if (this.qualityMode === 'auto') {
          this.setQualityButtonLabel('Tự động');
          this.setResolutionBadge(option.width, option.height, 'Tự động');
          this.updateQualityMenuSelection(-1);
          return;
        }
        this.setQualityButtonLabel(option.label);
        this.setResolutionBadge(option.width, option.height);
        this.updateQualityMenuSelection(data.level);
      });
      hls.on(HlsEngine.Events.ERROR, (_event, data) => {
        if (session !== this.streamSession || hls !== this.hls || !data.fatal) return;
        if (data.type === HlsEngine.ErrorTypes.MEDIA_ERROR && this.mediaRecoveryCount < 1) {
          this.mediaRecoveryCount += 1;
          hls.recoverMediaError();
          return;
        }
        this.showBuffering(false);
        this.fallbackToNextServer();
      });
      return;
    }

    this.usingNativeHls = isHls;
    if (isHls) this.populateNativeHlsMenu();
    if (isHls) this.setQualityButtonLabel('Tự động');
    this.video.src = streamUrl;
    this.video.load();
  },

  onStreamReady(resumeTime, autoplay) {
    const safeTime = PlayerCore.clampResumeTime(resumeTime, this.video.duration);
    if (safeTime > 3) {
      try { this.video.currentTime = safeTime; } catch (_error) {}
    }
    this.updateCurrentResolution();
    this.showBuffering(false);
    API.trackUsage('playback_ready', {
      ...this.usageContext(),
      duration: Number.isFinite(this.video.duration) ? this.video.duration : 0,
      quality: this.usingNativeHls ? `Tự động ${this.nativePlatform()}` : this.qualityMode
    });
    if (autoplay) this.video.play().catch(() => this.showAlert('Chạm nút Phát để bắt đầu xem.'));
  },

  usageContext(movie = this.currentMovie, episode = this.currentEpisode) {
    return {
      movie: movie?.name || movie?.slug || 'Không rõ',
      episode: episode?.name || episode?.filename || `Tập ${this.currentEpIndex + 1}`,
      server: this.allServers[this.currentServerIndex]?.server_name || `Server ${this.currentServerIndex + 1}`
    };
  },

  destroyHls() {
    if (!this.hls) return;
    this.hls.destroy();
    this.hls = null;
  },

  updateNextEpisodeButton() {
    const button = document.getElementById('btnNextEp');
    if (button) button.classList.toggle('hidden', !(this.episodesList.length > 1 && this.currentEpIndex < this.episodesList.length - 1));
  },

  setAspectRatio(mode, { silent = false } = {}) {
    const nextMode = mode === 'cover' ? 'cover' : 'contain';
    this.aspectMode = nextMode;
    this.wrapper.classList.toggle('aspect-contain', nextMode === 'contain');
    this.wrapper.classList.toggle('aspect-cover', nextMode === 'cover');
    window.requestAnimationFrame?.(() => this.updateSubtitleSafeArea());
    const contain = document.getElementById('btnAspectContain');
    const cover = document.getElementById('btnAspectCover');
    contain?.classList.toggle('active', nextMode === 'contain');
    cover?.classList.toggle('active', nextMode === 'cover');
    contain?.setAttribute('aria-pressed', String(nextMode === 'contain'));
    cover?.setAttribute('aria-pressed', String(nextMode === 'cover'));
    try { localStorage.setItem('phim4k-player-aspect-v3', nextMode); } catch (_) {}
    if (!silent) this.showAlert(nextMode === 'cover'
      ? 'Lấp đầy màn hình: mép hình và phụ đề sát mép có thể bị cắt.'
      : 'Giữ trọn hình: bảo toàn toàn bộ khung hình và phụ đề.');
  },

  applyPreferredAspect() {
    let preferred = 'contain';
    try {
      localStorage.removeItem('phim4k-player-fit');
      localStorage.removeItem('phim4k-player-fit-v2');
      preferred = localStorage.getItem('phim4k-player-aspect-v3') === 'cover' ? 'cover' : 'contain';
    } catch (_) {}
    this.setAspectRatio(preferred, { silent: true });
  },

  toggleAspectRatio() {
    this.setAspectRatio(this.aspectMode === 'contain' ? 'cover' : 'contain');
  },

  updateSubtitleSafeArea() {
    const controls = document.getElementById('playerControls');
    if (controls && this.wrapper) this.wrapper.style.setProperty('--subtitle-safe-area', `${Math.ceil(controls.getBoundingClientRect().height) + 12}px`);
  },

  syncFullscreenViewport() {
    if (!this.modal) return;
    if (!this.isCinemaFullscreen) {
      for (const property of ['--player-viewport-width', '--player-viewport-height', '--player-viewport-left', '--player-viewport-top']) {
        this.modal.style.removeProperty(property);
      }
      return;
    }
    const viewport = window.visualViewport;
    const width = Math.max(1, Math.round(viewport?.width || document.documentElement?.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(viewport?.height || document.documentElement?.clientHeight || window.innerHeight));
    this.modal.style.setProperty('--player-viewport-width', `${width}px`);
    this.modal.style.setProperty('--player-viewport-height', `${height}px`);
    this.modal.style.setProperty('--player-viewport-left', `${Math.round(viewport?.offsetLeft || 0)}px`);
    this.modal.style.setProperty('--player-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`);
    window.requestAnimationFrame?.(() => this.updateSubtitleSafeArea());
  },

  renderInPlayerServerMenu() {
    const menu = document.getElementById('playerServerMenu');
    const trigger = document.getElementById('btnPlayerServer');
    if (!menu) return;
    menu.replaceChildren();
    if (!this.allServers.length) {
      menu.textContent = 'Chỉ có một server';
      return;
    }
    this.allServers.forEach((server, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.toggle('active', index === this.currentServerIndex);
      button.textContent = server.server_name || `Server ${index + 1}`;
      button.onclick = () => this.switchServer(index);
      menu.appendChild(button);
    });
    if (trigger) trigger.textContent = this.allServers[this.currentServerIndex]?.server_name || 'Đổi server';
  },

  switchServer(newServerIndex, { automatic = false } = {}) {
    if (newServerIndex < 0 || newServerIndex >= this.allServers.length || newServerIndex === this.currentServerIndex) return;
    const targetServer = this.allServers[newServerIndex];
    const targetEpisodes = Array.isArray(targetServer?.server_data) ? targetServer.server_data : [];
    const match = PlayerCore.findEquivalentEpisode(targetEpisodes, this.currentEpisode, this.currentEpIndex);
    if (!match.episode) {
      this.showBuffering(false);
      this.showAlert('Server này chưa có tập tương ứng.');
      return;
    }
    const resumeTime = Number(this.video?.currentTime) || 0;
    const autoplay = Boolean(this.video && !this.video.paused);
    this.saveProgressNow();
    this.currentServerIndex = newServerIndex;
    this.currentEpisode = match.episode;
    this.currentEpIndex = match.index;
    this.episodesList = targetEpisodes;
    if (!automatic) this.failedServerIndexes.clear();
    this.renderInPlayerServerMenu();
    this.updateNextEpisodeButton();
    this.closeDropdowns();
    this.showAlert(`${automatic ? 'Tự chuyển' : 'Đã đổi'}: ${targetServer.server_name || `Server ${newServerIndex + 1}`}`);
    API.trackUsage('server_change', { ...this.usageContext(), entry: automatic ? 'automatic' : 'manual' });
    this.loadEpisode(match.episode, { resumeTime, autoplay });
  },

  fallbackToNextServer() {
    this.failedServerIndexes.add(this.currentServerIndex);
    const nextIndex = this.allServers.findIndex((_server, index) => !this.failedServerIndexes.has(index));
    if (nextIndex >= 0) {
      this.showAlert(`Server hiện tại không phát được. Đang thử ${this.allServers[nextIndex].server_name || `server ${nextIndex + 1}`}…`);
      this.switchServer(nextIndex, { automatic: true });
      return;
    }
    this.showBuffering(false);
    this.showAlert('Tất cả server hiện có đều không phản hồi. Vui lòng thử lại sau.');
    API.trackUsage('playback_error', { ...this.usageContext(), error: 'Tất cả server không phản hồi' });
  },

  releaseAudioVideo() {
    if (!window.Phim4KAudio?.release(this.video)) return;
    const old = this.video;
    const next = old.cloneNode(false);
    next.removeAttribute('src'); next.muted = old.muted; next.volume = old.volume; next.playbackRate = old.playbackRate;
    old.pause(); old.removeAttribute('src'); old.load(); old.replaceWith(next);
    this.video = next;
    this.videoBindings.forEach(({type,listener,options}) => next.addEventListener(type,listener,options));
    const button = document.getElementById('btnAudioMode');
    if (button) { button.textContent = 'Âm gốc'; button.setAttribute('aria-pressed','false'); }
  },

  async toggleAudioMode() {
    const button = document.getElementById('btnAudioMode');
    if (this.audioBusy) return;
    this.audioBusy = true;
    try {
      const enabled = await window.Phim4KAudio.toggle(this.video);
      button.textContent = enabled ? 'Rõ thoại' : 'Âm gốc';
      button.setAttribute('aria-pressed',String(enabled));
      this.showAlert(enabled ? 'Rõ thoại: cân động học nhẹ, không tăng âm lượng quá mức.' : 'Đã về âm thanh gốc.');
    } catch (error) { this.showAlert(error.message || 'Không thể đổi âm thanh.'); }
    finally { this.audioBusy = false; }
  },

  togglePlayPause() {
    if (!this.video) return;
    // A previous surface tap must not hide controls after an explicit pause.
    this.clearSurfaceTap();
    this.resetInactivityTimer();
    if (this.video.paused) this.video.play().catch(() => this.showAlert('Không thể phát luồng này.'));
    else this.video.pause();
  },

  updatePlayBtn(isPlaying) {
    document.getElementById('iconPlay')?.classList.toggle('hidden', isPlaying);
    document.getElementById('iconPause')?.classList.toggle('hidden', !isPlaying);
    document.getElementById('iconCenterPlay')?.classList.toggle('hidden', isPlaying);
    document.getElementById('iconCenterPause')?.classList.toggle('hidden', !isPlaying);
    for (const id of ['btnPlayPause', 'btnCenterPlayPause']) document.getElementById(id)?.setAttribute('aria-label', isPlaying ? 'Tạm dừng' : 'Phát video');
    if (!isPlaying) this.resetInactivityTimer();
  },

  seekRelative(seconds) {
    if (!this.video || !Number.isFinite(this.video.duration)) return;
    this.video.currentTime = PlayerCore.clampResumeTime(this.video.currentTime + seconds, this.video.duration);
    this.showAlert(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
  },

  loadAutoSkipPreference() {
    try {
      this.autoSkipAdsEnabled = localStorage.getItem('phim4k-ios-auto-skip-ads-v1') !== 'off';
    } catch (_) {
      this.autoSkipAdsEnabled = true;
    }
    this.updateAutoSkipButton();
  },

  toggleAutoSkipAds() {
    this.autoSkipAdsEnabled = !this.autoSkipAdsEnabled;
    try {
      localStorage.setItem('phim4k-ios-auto-skip-ads-v1', this.autoSkipAdsEnabled ? 'on' : 'off');
    } catch (_) {}
    this.updateAutoSkipButton();
    this.showAlert(this.autoSkipAdsEnabled ? 'Đã bật tự bỏ quảng cáo' : 'Đã tắt tự bỏ quảng cáo');
  },

  updateAutoSkipButton() {
    const button = document.getElementById('btnAutoSkipAds');
    if (!button) return;
    const enabled = this.autoSkipAdsEnabled;
    button.textContent = enabled ? 'Bỏ QC: Bật' : 'Bỏ QC: Tắt';
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  },

  maybeAutoSkipAd() {
    if (!this.autoSkipAdsEnabled || this.nativePlatform() !== 'ios') return false;
    const result = PlayerCore.autoAdSkipTarget(
      this.video?.currentTime,
      this.video?.duration,
      this.skippedAdMarkers
    );
    if (!result) return false;
    this.skippedAdMarkers.add(result.marker);
    this.video.currentTime = result.target;
    this.showAlert(`Đã tự tua qua quảng cáo +${Math.round(result.target - result.marker)}s`);
    return true;
  },

  onTimeUpdate() {
    if (!this.video || !Number.isFinite(this.video.duration) || this.video.duration <= 0) return;
    this.maybeAutoSkipAd();
    const percent = Math.max(0, Math.min(100, (this.video.currentTime / this.video.duration) * 100));
    const current = document.getElementById('progressCurrent');
    const thumb = document.getElementById('progressThumb');
    if (current) current.style.width = `${percent}%`;
    if (thumb) thumb.style.left = `${percent}%`;
    const time = document.getElementById('currentTime');
    const duration = document.getElementById('durationTime');
    if (time) time.textContent = this.formatTime(this.video.currentTime);
    if (duration) duration.textContent = this.formatTime(this.video.duration);
  },

  onProgress() {
    if (!this.video || !Number.isFinite(this.video.duration) || !this.video.buffered.length) return;
    const buffered = this.video.buffered.end(this.video.buffered.length - 1);
    const bar = document.getElementById('progressBuffer');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (buffered / this.video.duration) * 100))}%`;
  },

  onProgressBarClick(event) {
    if (!this.video || !Number.isFinite(this.video.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.video.currentTime = position * this.video.duration;
  },

  onProgressBarHover(event) {
    if (!this.video || !Number.isFinite(this.video.duration)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const hover = document.getElementById('progressHoverTime');
    if (!hover) return;
    hover.textContent = this.formatTime(position * this.video.duration);
    hover.style.left = `${position * 100}%`;
  },

  toggleMute() {
    this.video.muted = !this.video.muted;
    this.updateVolumeIcons();
  },

  updateVolumeIcons() {
    const muted = Boolean(this.video?.muted || this.video?.volume === 0);
    document.getElementById('iconVolHigh')?.classList.toggle('hidden', muted);
    document.getElementById('iconVolMute')?.classList.toggle('hidden', !muted);
  },

  setPlaybackSpeed(speed) {
    this.video.playbackRate = Number(speed) || 1;
    const button = document.getElementById('btnSpeed');
    if (button) button.textContent = `${this.video.playbackRate}x`;
    document.getElementById('speedMenu')?.classList.add('hidden');
  },

  populateQualityMenu(options) {
    if (this.hls) this.hls.currentLevel = -1;
    this.qualityMode = 'auto';
    this.setQualityButtonLabel('Tự động');
  },

  populateNativeHlsMenu() {
    this.qualityMode = 'auto';
    this.setQualityButtonLabel('Tự động');
  },

  setQuality(levelIndex) {
    this.qualityMode = 'auto';
    if (this.hls) this.hls.currentLevel = -1;
    this.setQualityButtonLabel('Tự động');
    this.updateQualityMenuSelection(-1);
    document.getElementById('qualityMenu')?.classList.add('hidden');
  },

  updateQualityMenuSelection(levelIndex) {
    document.querySelectorAll('#qualityMenu button[data-level]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.level) === levelIndex);
    });
  },

  setQualityButtonLabel(label) {
    const button = document.getElementById('btnQuality');
    if (button) button.textContent = label;
  },

  setAvailableResolution(options) {
    if (this.qualityMode === 'auto') {
      this.setResolutionBadge(0, 0, 'Tự động');
      return;
    }
    const best = options[0];
    if (best) this.setResolutionBadge(best.width, best.height, `Tối đa ${best.label}`);
  },

  updateCurrentResolution() {
    if (!(this.video?.videoHeight || this.video?.videoWidth)) return;
    if (this.qualityMode === 'auto' || this.usingNativeHls) {
      this.setResolutionBadge(this.video.videoWidth, this.video.videoHeight, 'Tự động');
      return;
    }
    this.setResolutionBadge(this.video.videoWidth, this.video.videoHeight);
  },

  setResolutionBadge(width, height, overrideLabel = '') {
    const badge = document.getElementById('realResolutionBadge');
    if (!badge) return;
    const numericHeight = Number(height) || 0;
    const numericWidth = Number(width) || 0;
    badge.textContent = overrideLabel || (numericHeight ? `${numericHeight}p` : 'Đang xác minh');
    badge.className = 'badge-real-res';
    if (overrideLabel === 'Tự động') badge.classList.add('res-auto');
    if (numericHeight >= 2160 || numericWidth >= 3840) badge.classList.add('res-4k');
    else if (numericHeight >= 1440 || numericWidth >= 2560) badge.classList.add('res-2k');
    else if (numericHeight >= 1080 || numericWidth >= 1920) badge.classList.add('res-fhd');
    else if (numericHeight >= 720) badge.classList.add('res-hd');
  },

  playNextEpisode() {
    if (!this.episodesList.length || this.currentEpIndex >= this.episodesList.length - 1) {
      this.showAlert('Bạn đã xem đến tập cuối cùng.');
      return;
    }
    const nextIndex = this.currentEpIndex + 1;
    this.open(this.currentMovie, this.episodesList[nextIndex], this.episodesList, nextIndex, this.allServers, this.currentServerIndex);
  },

  onEnded() {
    API.trackUsage('playback_complete', {
      ...this.usageContext(),
      duration: Number.isFinite(this.video?.duration) ? this.video.duration : 0
    });
    if (this.currentEpIndex < this.episodesList.length - 1) {
      this.showAlert('Tập phim đã kết thúc. Chuyển tập sau trong 3 giây…');
      window.setTimeout(() => { if (this.video?.ended) this.playNextEpisode(); }, 3000);
    }
  },

  isNativeRuntime() {
    const capacitor = window.Capacitor;
    return Boolean(capacitor && (capacitor.isNativePlatform?.() || ['ios', 'android'].includes(capacitor.getPlatform?.())));
  },

  nativePlatform() {
    if (!this.isNativeRuntime()) return 'web';
    return window.Capacitor?.getPlatform?.() || window.PHIM4K_PLATFORM || 'native';
  },

  getNativePlugin(name) {
    if (!this.isNativeRuntime()) return null;
    const capacitor = window.Capacitor;
    try { return capacitor.Plugins?.[name] || capacitor.registerPlugin?.(name) || null; }
    catch (_error) { return null; }
  },

  async toggleCinemaFullscreen() {
    if (this.isCinemaFullscreen) await this.exitCinemaFullscreen();
    else await this.enterCinemaFullscreen();
  },

  async enterCinemaFullscreen() {
    if (!this.wrapper || this.modal?.classList.contains('hidden')) return;
    this.isCinemaFullscreen = true;
    this.applyFullscreenUi(true);
    try {
      if (this.isNativeRuntime()) {
        const orientation = this.getNativePlugin('ScreenOrientation');
        const statusBar = this.getNativePlugin('StatusBar');
        await orientation?.lock({ orientation: 'landscape' });
        await statusBar?.hide();
      } else {
        if (!document.fullscreenElement && this.wrapper.requestFullscreen) await this.wrapper.requestFullscreen();
        if (screen.orientation?.lock) await screen.orientation.lock('landscape');
      }
    } catch (error) {
      console.warn('Unable to lock fullscreen orientation:', error);
      this.showAlert('Không thể khóa xoay trên thiết bị này; vẫn mở khung phát toàn màn.');
    }
    this.syncFullscreenViewport();
    // WKWebView reports the portrait visual viewport briefly while the native
    // orientation lock is settling. Re-read it after both following paints.
    window.setTimeout(() => this.syncFullscreenViewport(), 80);
    window.setTimeout(() => this.syncFullscreenViewport(), 280);
    this.resetInactivityTimer();
  },

  async exitCinemaFullscreen() {
    if (!this.isCinemaFullscreen && !document.fullscreenElement) return;
    this.isCinemaFullscreen = false;
    this.applyFullscreenUi(false);
    try {
      if (this.isNativeRuntime()) {
        const orientation = this.getNativePlugin('ScreenOrientation');
        const statusBar = this.getNativePlugin('StatusBar');
        await Promise.allSettled([orientation?.unlock(), statusBar?.show()].filter(Boolean));
      } else {
        if (screen.orientation?.unlock) screen.orientation.unlock();
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      }
    } catch (error) {
      console.warn('Unable to restore normal orientation:', error);
    }
  },

  applyFullscreenUi(enabled) {
    this.wrapper?.classList.toggle('cinema-fullscreen', enabled);
    this.modal?.classList.toggle('cinema-fullscreen', enabled);
    document.body.classList.toggle('player-cinema-fullscreen', enabled);
    this.syncFullscreenViewport();
    this.applyPreferredAspect();
    const button = document.getElementById('btnCinemaFullscreen');
    if (button) {
      button.classList.toggle('active', enabled);
      button.setAttribute('aria-pressed', String(enabled));
      button.title = enabled ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình ngang (F)';
    }
  },

  onBrowserFullscreenChange() {
    if (!this.isNativeRuntime() && this.isCinemaFullscreen && !document.fullscreenElement) {
      this.isCinemaFullscreen = false;
      this.applyFullscreenUi(false);
      try { screen.orientation?.unlock?.(); } catch (_error) {}
    }
  },

  onNativeVideoError() {
    if (!this.activeStreamUrl || this.hls || this.modal?.classList.contains('hidden')) return;
    const currentSource = this.video?.currentSrc || this.video?.src || '';
    if (!currentSource || !this.isActiveStreamSource(currentSource)) return;
    this.showBuffering(false);
    this.fallbackToNextServer();
  },

  isActiveStreamSource(source) {
    try {
      return new URL(source, document.baseURI).href === new URL(this.activeStreamUrl, document.baseURI).href;
    } catch (_error) {
      return source === this.activeStreamUrl;
    }
  },

  showBuffering(isBuffering, text = 'Đang tải…') {
    const element = document.getElementById('playerBuffering');
    const label = document.getElementById('bufferingText');
    if (label) label.textContent = text;
    element?.classList.toggle('hidden', !isBuffering);
  },

  showAlert(text) {
    const alert = document.getElementById('playerAlert');
    if (!alert) return;
    alert.textContent = text;
    alert.classList.remove('hidden');
    clearTimeout(this.alertTimer);
    this.alertTimer = window.setTimeout(() => alert.classList.add('hidden'), 2600);
  },

  closeDropdowns() {
    ['playerServerMenu', 'speedMenu', 'qualityMenu'].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
  },

  clearSurfaceTap() {
    clearTimeout(this.surfaceTapTimer);
    this.surfaceTapTimer = null;
    this.lastSurfaceTap = null;
  },

  onSurfaceTap(event) {
    if (this.tapDragged) { this.tapDragged = false; this.clearSurfaceTap(); return; }
    // Programmatic/accessibility activation still only toggles the controls.
    if (!event.detail) { this.clearSurfaceTap(); this.toggleControls(); return; }
    const rect = this.video.getBoundingClientRect();
    if (!rect.width) return;
    const tap = { x: (event.clientX - rect.left) / rect.width, time: event.timeStamp };
    const seek = PlayerCore.doubleTapSeek(this.lastSurfaceTap, tap);
    clearTimeout(this.surfaceTapTimer);
    if (seek) {
      this.lastSurfaceTap = null;
      this.seekRelative(seek);
    } else {
      this.lastSurfaceTap = tap;
      this.surfaceTapTimer = window.setTimeout(() => { this.lastSurfaceTap = null; this.toggleControls(); }, 540);
    }
  },

  toggleControls() {
    if (!this.wrapper) return;
    if (this.wrapper.classList.contains('inactive')) this.resetInactivityTimer();
    else {
      clearTimeout(this.inactivityTimer);
      this.closeDropdowns();
      this.wrapper.classList.add('inactive');
    }
    window.requestAnimationFrame?.(() => this.updateSubtitleSafeArea());
  },

  resetInactivityTimer() {
    if (!this.wrapper || this.modal?.classList.contains('hidden')) return;
    this.wrapper.classList.remove('inactive');
    window.requestAnimationFrame?.(() => this.updateSubtitleSafeArea());
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = window.setTimeout(() => {
      if (!this.video?.paused) {
        this.wrapper.classList.add('inactive');
        this.updateSubtitleSafeArea();
      }
    }, 3200);
  },

  formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
  },

  getProgressStorageKey() {
    if (!this.currentMovie || !this.currentEpisode) return null;
    return `watch_${this.currentMovie.slug || this.currentMovie.name}_${this.currentEpisode.slug || this.currentEpisode.filename || this.currentEpIndex}`;
  },

  getSavedWatchTime() {
    const key = this.getProgressStorageKey();
    const saved = key ? Number(localStorage.getItem(key)) : 0;
    if (Number.isFinite(saved) && saved > 0) return saved;
    const episodeId = this.currentEpisode?.slug || this.currentEpisode?.filename || String(this.currentEpIndex);
    return window.ContinueWatching?.getSavedTime?.(this.currentMovie?.slug, episodeId, this.currentEpisode?.name) || 0;
  },

  saveProgressNow({ flush = false } = {}) {
    if (!this.video || this.video.currentTime <= 3 || (this.video.paused && !flush)) return;
    const key = this.getProgressStorageKey();
    if (key) localStorage.setItem(key, this.video.currentTime.toFixed(1));
    if (window.ContinueWatching && this.currentMovie && Number.isFinite(this.video.duration)) {
      const episodeId = this.currentEpisode?.slug || this.currentEpisode?.filename || String(this.currentEpIndex);
      ContinueWatching.saveItem(this.currentMovie, this.currentEpisode?.name || `Tập ${this.currentEpIndex + 1}`, this.video.currentTime, this.video.duration, episodeId);
      if (flush) void ContinueWatching.flushSync({ keepalive: true });
    }
  },

  startProgressSaveTimer() {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveInterval = window.setInterval(() => this.saveProgressNow(), 4000);
  },

  onKeyDown(event) {
    if (this.modal?.classList.contains('hidden')) return;
    switch (event.key) {
      case ' ': event.preventDefault(); this.togglePlayPause(); break;
      case 'ArrowLeft': event.preventDefault(); this.seekRelative(-10); break;
      case 'ArrowRight': event.preventDefault(); this.seekRelative(10); break;
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const delta = event.key === 'ArrowUp' ? 0.1 : -0.1;
        this.video.volume = Math.max(0, Math.min(1, this.video.volume + delta));
        document.getElementById('volumeSlider').value = this.video.volume;
        this.video.muted = false;
        this.updateVolumeIcons();
        break;
      }
      case 'f': case 'F': void this.toggleCinemaFullscreen(); break;
      case 'm': case 'M': this.toggleMute(); break;
      case 's': case 'S': this.toggleAspectRatio(); break;
      case 'Escape': if (this.isCinemaFullscreen) void this.exitCinemaFullscreen(); else this.close(); break;
      default: break;
    }
  }
};

function togglePlayPause() { Player.togglePlayPause(); }
function seekRelative(seconds) { Player.seekRelative(seconds); }
function toggleAutoSkipAds() { Player.toggleAutoSkipAds(); }
function toggleMute() { Player.toggleMute(); }
function toggleCinemaFullscreen() { void Player.toggleCinemaFullscreen(); }
function toggleAspectRatio() { Player.toggleAspectRatio(); }
function setAspectRatio(mode) { Player.setAspectRatio(mode); }
function playNextEpisode() { Player.playNextEpisode(); }
function closePlayer() { Player.close(); }
function togglePlayerServerMenu() {
  document.getElementById('playerServerMenu')?.classList.toggle('hidden');
  document.getElementById('speedMenu')?.classList.add('hidden');
  document.getElementById('qualityMenu')?.classList.add('hidden');
}
function toggleSpeedMenu() {
  document.getElementById('speedMenu')?.classList.toggle('hidden');
  document.getElementById('qualityMenu')?.classList.add('hidden');
  document.getElementById('playerServerMenu')?.classList.add('hidden');
}
function setPlaybackSpeed(rate) { Player.setPlaybackSpeed(rate); }
function toggleQualityMenu() {
  document.getElementById('qualityMenu')?.classList.toggle('hidden');
  document.getElementById('speedMenu')?.classList.add('hidden');
  document.getElementById('playerServerMenu')?.classList.add('hidden');
}
function setQuality(index) { Player.setQuality(index); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Player.init(), { once: true });
else Player.init();
