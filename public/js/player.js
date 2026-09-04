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
  activeStreamUrl: '',
  qualityOptions: [],
  usingNativeHls: false,
  failedServerIndexes: new Set(),
  mediaRecoveryCount: 0,

  init() {
    if (this.video) return;
    this.video = document.getElementById('videoPlayer');
    this.modal = document.getElementById('playerModal');
    this.wrapper = document.getElementById('playerWrapper');
    if (!this.video || !this.modal || !this.wrapper) return;

    this.video.addEventListener('play', () => { this.updatePlayBtn(true); this.resetInactivityTimer(); });
    this.video.addEventListener('pause', () => this.updatePlayBtn(false));
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('progress', () => this.onProgress());
    this.video.addEventListener('waiting', () => this.showBuffering(true, 'Đang đệm dữ liệu…'));
    this.video.addEventListener('playing', () => this.showBuffering(false));
    this.video.addEventListener('ended', () => this.onEnded());
    this.video.addEventListener('error', () => this.onNativeVideoError());
    this.video.addEventListener('resize', () => this.updateCurrentResolution());
    this.video.addEventListener('click', () => this.togglePlayPause());

    ['mousemove', 'pointermove', 'pointerdown', 'touchstart'].forEach((eventName) => {
      this.wrapper.addEventListener(eventName, () => this.resetInactivityTimer(), { passive: true });
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
    window.addEventListener('pagehide', () => this.saveProgressNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveProgressNow();
    });
    document.addEventListener('fullscreenchange', () => this.onBrowserFullscreenChange());
  },

  open(movie, episode, episodesList = [], epIndex = 0, allServers = [], serverIndex = 0) {
    if (!this.video) this.init();
    if (!this.video || !movie || !episode) return;
    this.currentMovie = movie;
    this.currentEpisode = episode;
    this.episodesList = Array.isArray(episodesList) ? episodesList : [];
    this.currentEpIndex = Number.isInteger(epIndex) ? epIndex : 0;
    this.allServers = Array.isArray(allServers) ? allServers : [];
    this.currentServerIndex = Number.isInteger(serverIndex) ? serverIndex : 0;
    this.failedServerIndexes.clear();

    document.getElementById('playerMovieTitle').textContent = movie.name || 'Phim';
    document.getElementById('playerEpisodeTitle').textContent = episode.name || `Tập ${this.currentEpIndex + 1}`;
    this.renderInPlayerServerMenu();
    this.updateNextEpisodeButton();
    this.closeDropdowns();
    this.modal.classList.remove('hidden');
    document.body.classList.add('locked', 'player-open');
    this.setAspectRatio('contain', { silent: true });
    this.loadEpisode(episode, { resumeTime: this.getSavedWatchTime(), autoplay: true });
    this.startProgressSaveTimer();
    this.resetInactivityTimer();
  },

  close() {
    this.saveProgressNow();
    void this.exitCinemaFullscreen();
    this.streamSession += 1;
    this.activeStreamUrl = '';
    this.closeDropdowns();
    this.destroyHls();
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
    document.body.classList.remove('locked', 'player-open');
  },

  loadEpisode(episode, options = {}) {
    const source = episode?.link_m3u8 || episode?.link_embed || '';
    this.loadStream(source, { ...options, isHls: Boolean(episode?.link_m3u8) });
  },

  loadStream(streamUrl, options = {}) {
    const session = ++this.streamSession;
    const resumeTime = Number(options.resumeTime) || 0;
    const autoplay = options.autoplay !== false;
    const isHls = options.isHls ?? /\.m3u8(?:[?#]|$)/i.test(String(streamUrl));
    if (!streamUrl) {
      this.showBuffering(false);
      this.showAlert('Không có luồng phát tương thích ở server này. Đang thử server khác…');
      this.fallbackToNextServer();
      return;
    }

    this.activeStreamUrl = streamUrl;
    this.mediaRecoveryCount = 0;
    this.qualityOptions = [];
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
        this.qualityOptions = PlayerCore.uniqueQualityOptions(hls.levels);
        this.populateQualityMenu(this.qualityOptions);
        this.setAvailableResolution(this.qualityOptions);
      });
      hls.on(HlsEngine.Events.LEVEL_SWITCHED, (_event, data) => {
        if (session !== this.streamSession || hls !== this.hls) return;
        const level = hls.levels[data.level];
        if (!level) return;
        const option = PlayerCore.qualityOption(level, data.level);
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
    if (autoplay) this.video.play().catch(() => this.showAlert('Chạm nút Phát để bắt đầu xem.'));
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
    this.aspectMode = mode === 'cover' ? 'cover' : 'contain';
    const fitMode = this.aspectMode === 'contain';
    this.wrapper.classList.toggle('aspect-contain', fitMode);
    this.wrapper.classList.toggle('aspect-cover', !fitMode);
    const button = document.getElementById('btnAspectFit');
    if (button) button.textContent = fitMode ? 'Giữ Sub' : 'Lấp đầy';
    if (!silent) this.showAlert(fitMode ? 'Chế độ Giữ Sub đang bật.' : 'Chế độ Lấp đầy có thể cắt mép phụ đề.');
  },

  toggleAspectRatio() { this.setAspectRatio(this.aspectMode === 'contain' ? 'cover' : 'contain'); },

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
  },

  togglePlayPause() {
    if (!this.video) return;
    if (this.video.paused) this.video.play().catch(() => this.showAlert('Không thể phát luồng này.'));
    else this.video.pause();
  },

  updatePlayBtn(isPlaying) {
    document.getElementById('iconPlay')?.classList.toggle('hidden', isPlaying);
    document.getElementById('iconPause')?.classList.toggle('hidden', !isPlaying);
  },

  seekRelative(seconds) {
    if (!this.video || !Number.isFinite(this.video.duration)) return;
    this.video.currentTime = PlayerCore.clampResumeTime(this.video.currentTime + seconds, this.video.duration);
    this.showAlert(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
  },

  onTimeUpdate() {
    if (!this.video || !Number.isFinite(this.video.duration) || this.video.duration <= 0) return;
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
    const menu = document.getElementById('qualityMenu');
    if (!menu) return;
    menu.replaceChildren();
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.dataset.level = '-1';
    auto.className = 'active';
    auto.textContent = 'Tự động';
    auto.onclick = () => this.setQuality(-1);
    menu.appendChild(auto);
    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.level = String(option.levelIndex);
      button.textContent = option.label;
      button.onclick = () => this.setQuality(option.levelIndex);
      menu.appendChild(button);
    });
    this.setQualityButtonLabel('Tự động');
  },

  populateNativeHlsMenu() {
    const menu = document.getElementById('qualityMenu');
    if (!menu) return;
    menu.replaceChildren();
    const item = document.createElement('button');
    item.type = 'button';
    item.disabled = true;
    item.className = 'quality-note';
    item.textContent = 'iPhone tự chọn chất lượng HLS';
    menu.appendChild(item);
    this.setQualityButtonLabel('Tự động iOS');
  },

  setQuality(levelIndex) {
    if (!this.hls) {
      this.showAlert(this.usingNativeHls ? 'iPhone đang tự chọn chất lượng HLS phù hợp mạng.' : 'Luồng này không có danh sách chất lượng để chọn.');
      document.getElementById('qualityMenu')?.classList.add('hidden');
      return;
    }
    this.hls.currentLevel = levelIndex;
    const option = levelIndex === -1 ? null : this.qualityOptions.find((item) => item.levelIndex === levelIndex);
    this.setQualityButtonLabel(option?.label || 'Tự động');
    this.updateQualityMenuSelection(levelIndex);
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
    const best = options[0];
    if (best) this.setResolutionBadge(best.width, best.height, `Tối đa ${best.label}`);
  },

  updateCurrentResolution() {
    if (this.video?.videoHeight || this.video?.videoWidth) this.setResolutionBadge(this.video.videoWidth, this.video.videoHeight);
  },

  setResolutionBadge(width, height, overrideLabel = '') {
    const badge = document.getElementById('realResolutionBadge');
    if (!badge) return;
    const numericHeight = Number(height) || 0;
    const numericWidth = Number(width) || 0;
    badge.textContent = overrideLabel || (numericHeight ? `${numericHeight}p` : 'Đang xác minh');
    badge.className = 'badge-real-res';
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
    if (this.currentEpIndex < this.episodesList.length - 1) {
      this.showAlert('Tập phim đã kết thúc. Chuyển tập sau trong 3 giây…');
      window.setTimeout(() => { if (this.video?.ended) this.playNextEpisode(); }, 3000);
    }
  },

  isNativeRuntime() {
    const capacitor = window.Capacitor;
    return Boolean(capacitor && (capacitor.isNativePlatform?.() || ['ios', 'android'].includes(capacitor.getPlatform?.())));
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

  resetInactivityTimer() {
    if (!this.wrapper || this.modal?.classList.contains('hidden')) return;
    this.wrapper.classList.remove('inactive');
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = window.setTimeout(() => {
      if (!this.video?.paused) this.wrapper.classList.add('inactive');
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
    return Number.isFinite(saved) ? saved : 0;
  },

  saveProgressNow() {
    if (!this.video || this.video.paused || this.video.currentTime <= 3) return;
    const key = this.getProgressStorageKey();
    if (key) localStorage.setItem(key, this.video.currentTime.toFixed(1));
    if (window.ContinueWatching && this.currentMovie && Number.isFinite(this.video.duration)) {
      ContinueWatching.saveItem(this.currentMovie, this.currentEpisode?.name || `Tập ${this.currentEpIndex + 1}`, this.video.currentTime, this.video.duration);
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
function toggleMute() { Player.toggleMute(); }
function toggleCinemaFullscreen() { void Player.toggleCinemaFullscreen(); }
function toggleAspectRatio() { Player.toggleAspectRatio(); }
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
