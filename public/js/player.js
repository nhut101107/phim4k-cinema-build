// Ad-Free Cinema Video Player with True 4K Detection, Subtitle Protection & Multi-Server Fallback

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
  aspectMode: 'contain', // 'contain' (Fit / Safe Sub) or 'cover' (Stretch)
  isLandscapeForced: false,

  init() {
    this.video = document.getElementById('videoPlayer');
    this.modal = document.getElementById('playerModal');
    this.wrapper = document.getElementById('playerWrapper');

    if (!this.video) return;

    this.video.addEventListener('play', () => this.updatePlayBtn(true));
    this.video.addEventListener('pause', () => this.updatePlayBtn(false));
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('progress', () => this.onProgress());
    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => this.showBuffering(false));
    this.video.addEventListener('ended', () => this.onEnded());
    this.video.addEventListener('click', () => this.togglePlayPause());

    this.wrapper.addEventListener('mousemove', () => this.resetInactivityTimer());
    this.wrapper.addEventListener('mouseleave', () => this.hideControls());

    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
      progressContainer.addEventListener('click', (e) => this.onProgressBarClick(e));
      progressContainer.addEventListener('mousemove', (e) => this.onProgressBarHover(e));
    }

    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        this.video.volume = parseFloat(e.target.value);
        this.video.muted = false;
        this.updateVolumeIcons();
      });
    }

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  },

  open(movie, episode, episodesList = [], epIndex = 0, allServers = [], serverIndex = 0) {
    this.currentMovie = movie;
    this.currentEpisode = episode;
    this.episodesList = episodesList;
    this.currentEpIndex = epIndex;
    this.allServers = allServers;
    this.currentServerIndex = serverIndex;

    document.getElementById('playerMovieTitle').textContent = movie.name;
    document.getElementById('playerEpisodeTitle').textContent = episode.name || `Tập ${epIndex + 1}`;

    // Update In-Player Server Selector
    this.renderInPlayerServerMenu();

    // Next Episode button
    const nextBtn = document.getElementById('btnNextEp');
    if (nextBtn) {
      if (this.episodesList.length > 1 && this.currentEpIndex < this.episodesList.length - 1) {
        nextBtn.classList.remove('hidden');
      } else {
        nextBtn.classList.add('hidden');
      }
    }

    this.modal.classList.remove('hidden');
    document.body.classList.add('locked');

    // Default to Subtitle-Safe mode
    this.setAspectRatio('contain');

    // Start stream
    const playUrl = episode.link_m3u8 || episode.link_embed;
    this.loadStream(playUrl);

    this.startProgressSaveTimer();
  },

  close() {
    this.exitLandscapeFullscreen();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    this.modal.classList.add('hidden');
    document.body.classList.remove('locked');
  },

  loadStream(streamUrl) {
    if (!streamUrl) {
      this.showAlert('❌ Không tìm thấy luồng stream hợp lệ. Đang thử server khác...');
      this.fallbackToNextServer();
      return;
    }

    this.showBuffering(true, 'Đang phân giải luồng 4K & kiểm tra phụ đề...');

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const savedTime = this.getSavedWatchTime();

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });

      this.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(this.video);

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.showBuffering(false);
        this.detectTrueResolution(hls.levels);
        this.populateQualityMenu(hls.levels);

        if (savedTime > 15) {
          this.video.currentTime = savedTime;
          this.showAlert(`⏱ Đã tự động khôi phục vị trí xem: ${this.formatTime(savedTime)}`);
        }

        this.video.play().catch(err => {
          console.warn('Autoplay prevented, user interaction required:', err);
        });
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        const level = hls.levels[data.level];
        if (level) {
          const h = level.height || 'Auto';
          document.getElementById('btnQuality').textContent = h + (h !== 'Auto' ? 'p' : '');
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS Error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Try local proxy if not tried yet
              if (!streamUrl.startsWith('/api/stream/proxy')) {
                const proxyUrl = `/api/stream/proxy?url=${encodeURIComponent(streamUrl)}`;
                console.log('Retrying via Local Stream Proxy:', proxyUrl);
                this.loadStream(proxyUrl);
                return;
              }
              // If proxy also failed, automatically fallback to next server!
              this.fallbackToNextServer();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              this.hls.destroy();
              this.fallbackToNextServer();
              break;
          }
        }
      });

    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = streamUrl;
      this.video.addEventListener('loadedmetadata', () => {
        this.showBuffering(false);
        if (savedTime > 15) {
          this.video.currentTime = savedTime;
        }
        this.video.play().catch(() => {});
      });
    } else {
      this.showAlert('❌ Trình duyệt không hỗ trợ HLS');
    }
  },

  // TRUE RESOLUTION DETECTOR (Calculates actual stream pixels)
  detectTrueResolution(levels = []) {
    const badgeEl = document.getElementById('realResolutionBadge');
    if (!badgeEl) return;

    if (!levels || levels.length === 0) {
      badgeEl.textContent = 'FHD 1080p';
      badgeEl.className = 'badge-real-res res-fhd';
      return;
    }

    let maxHeight = 0;
    let maxWidth = 0;
    levels.forEach(lvl => {
      if (lvl.height > maxHeight) maxHeight = lvl.height;
      if (lvl.width > maxWidth) maxWidth = lvl.width;
    });

    if (maxHeight >= 2160 || maxWidth >= 3840) {
      badgeEl.textContent = '💎 4K REAL (2160p)';
      badgeEl.className = 'badge-real-res res-4k';
    } else if (maxHeight >= 1440 || maxWidth >= 2560) {
      badgeEl.textContent = '✨ 2K QHD (1440p)';
      badgeEl.className = 'badge-real-res res-2k';
    } else if (maxHeight >= 1080 || maxWidth >= 1920) {
      badgeEl.textContent = '🎯 FHD (1080p)';
      badgeEl.className = 'badge-real-res res-fhd';
    } else if (maxHeight >= 720) {
      badgeEl.textContent = 'HD 720p';
      badgeEl.className = 'badge-real-res res-hd';
    } else {
      badgeEl.textContent = 'SD 480p';
      badgeEl.className = 'badge-real-res';
    }
  },

  // SUBTITLE-SAFE ASPECT RATIO TOGGLE (FIT VS FILL)
  toggleAspectRatio() {
    if (this.aspectMode === 'contain') {
      this.setAspectRatio('cover');
    } else {
      this.setAspectRatio('contain');
    }
  },

  setAspectRatio(mode) {
    this.aspectMode = mode;
    const btn = document.getElementById('btnAspectFit');
    if (mode === 'contain') {
      this.wrapper.classList.remove('aspect-cover');
      this.wrapper.classList.add('aspect-contain');
      if (btn) btn.textContent = '📺 Giữ Sub Gốc';
      this.showAlert('🛡️ Chế độ Giữ Sub Gốc: Toàn bộ phụ đề được hiển thị 100% không bị che');
    } else {
      this.wrapper.classList.remove('aspect-contain');
      this.wrapper.classList.add('aspect-cover');
      if (btn) btn.textContent = '🔍 Tràn Màn Hình';
      this.showAlert('🔍 Chế độ Tràn Màn Hình');
    }
  },

  // MULTI-SERVER FALLBACK & IN-PLAYER SWITCHER
  renderInPlayerServerMenu() {
    const menu = document.getElementById('playerServerMenu');
    if (!menu) return;
    menu.innerHTML = '';

    if (!this.allServers || this.allServers.length === 0) {
      menu.innerHTML = '<div style="padding: 6px; font-size: 11px; color: var(--text-dim);">Chỉ có 1 server</div>';
      return;
    }

    this.allServers.forEach((server, sIdx) => {
      const btn = document.createElement('button');
      btn.className = (sIdx === this.currentServerIndex) ? 'active' : '';
      btn.textContent = server.server_name || `Server #${sIdx + 1}`;
      btn.onclick = () => {
        this.switchServer(sIdx);
      };
      menu.appendChild(btn);
    });
  },

  switchServer(newServerIndex) {
    if (newServerIndex < 0 || newServerIndex >= this.allServers.length) return;
    this.currentServerIndex = newServerIndex;
    const targetServer = this.allServers[newServerIndex];
    const serverEpisodes = targetServer.server_data || [];

    // Find corresponding episode in new server
    let targetEp = serverEpisodes[this.currentEpIndex];
    if (!targetEp && serverEpisodes.length > 0) {
      targetEp = serverEpisodes[0];
    }

    if (targetEp) {
      document.getElementById('playerServerMenu').classList.add('hidden');
      this.currentEpisode = targetEp;
      this.episodesList = serverEpisodes;
      this.renderInPlayerServerMenu();
      this.showAlert(`🔄 Đang chuyển sang: ${targetServer.server_name}`);
      this.loadStream(targetEp.link_m3u8 || targetEp.link_embed);
    }
  },

  fallbackToNextServer() {
    if (this.allServers && this.allServers.length > 1 && this.currentServerIndex < this.allServers.length - 1) {
      const nextServerIdx = this.currentServerIndex + 1;
      this.showAlert(`⚠️ Server hiện tại gặp sự cố. Đang tự động chuyển sang Server dự phòng #${nextServerIdx + 1}...`);
      setTimeout(() => {
        this.switchServer(nextServerIdx);
      }, 1500);
    } else {
      this.showAlert('❌ Tất cả các server hiện tại đều không phản hồi. Vui lòng thử lại sau!');
    }
  },

  togglePlayPause() {
    if (!this.video) return;
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
  },

  updatePlayBtn(isPlaying) {
    const playIcon = document.getElementById('iconPlay');
    const pauseIcon = document.getElementById('iconPause');
    if (isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  },

  seekRelative(seconds) {
    if (!this.video) return;
    this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, this.video.currentTime + seconds));
    this.showAlert(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
  },

  onTimeUpdate() {
    if (!this.video || isNaN(this.video.duration)) return;
    const current = this.video.currentTime;
    const duration = this.video.duration;
    const pct = (current / duration) * 100;

    const currentBar = document.getElementById('progressCurrent');
    const thumb = document.getElementById('progressThumb');
    if (currentBar) currentBar.style.width = `${pct}%`;
    if (thumb) thumb.style.left = `${pct}%`;

    const curEl = document.getElementById('currentTime');
    const durEl = document.getElementById('durationTime');
    if (curEl) curEl.textContent = this.formatTime(current);
    if (durEl) durEl.textContent = this.formatTime(duration);
  },

  onProgress() {
    if (!this.video || isNaN(this.video.duration)) return;
    const duration = this.video.duration;
    const buffered = this.video.buffered;
    if (buffered.length > 0) {
      const bufferedEnd = buffered.end(buffered.length - 1);
      const bufferPct = (bufferedEnd / duration) * 100;
      const bufferBar = document.getElementById('progressBuffer');
      if (bufferBar) bufferBar.style.width = `${bufferPct}%`;
    }
  },

  onProgressBarClick(e) {
    if (!this.video || isNaN(this.video.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    this.video.currentTime = pos * this.video.duration;
  },

  onProgressBarHover(e) {
    if (!this.video || isNaN(this.video.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const time = pos * this.video.duration;

    const hoverEl = document.getElementById('progressHoverTime');
    if (hoverEl) {
      hoverEl.textContent = this.formatTime(time);
      hoverEl.style.left = `${pos * 100}%`;
    }
  },

  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    this.updateVolumeIcons();
    this.showAlert(this.video.muted ? '🔇 Đã tắt tiếng' : '🔊 Đã bật tiếng');
  },

  updateVolumeIcons() {
    const isMuted = this.video.muted || this.video.volume === 0;
    document.getElementById('iconVolHigh').classList.toggle('hidden', isMuted);
    document.getElementById('iconVolMute').classList.toggle('hidden', !isMuted);
  },

  setPlaybackSpeed(speed) {
    if (!this.video) return;
    this.video.playbackRate = speed;
    document.getElementById('btnSpeed').textContent = `${speed}x`;
    document.getElementById('speedMenu').classList.add('hidden');
    this.showAlert(`Tốc độ: ${speed}x`);
  },

  populateQualityMenu(levels = []) {
    const menu = document.getElementById('qualityMenu');
    menu.innerHTML = '<button class="active" onclick="Player.setQuality(-1)">Auto</button>';
    levels.forEach((lvl, idx) => {
      const h = lvl.height || 'HD';
      const btn = document.createElement('button');
      btn.textContent = `${h}p`;
      btn.onclick = () => Player.setQuality(idx);
      menu.appendChild(btn);
    });
  },

  setQuality(levelIndex) {
    if (!this.hls) return;
    this.hls.currentLevel = levelIndex;
    const menu = document.getElementById('qualityMenu');
    const buttons = menu.querySelectorAll('button');
    buttons.forEach((b, idx) => {
      b.classList.toggle('active', (levelIndex === -1 && idx === 0) || (idx === levelIndex + 1));
    });
    document.getElementById('btnQuality').textContent = levelIndex === -1 ? 'Auto' : buttons[levelIndex + 1]?.textContent || 'HD';
    menu.classList.add('hidden');
  },

  playNextEpisode() {
    if (this.episodesList.length > 0 && this.currentEpIndex < this.episodesList.length - 1) {
      const nextIndex = this.currentEpIndex + 1;
      const nextEp = this.episodesList[nextIndex];
      this.open(this.currentMovie, nextEp, this.episodesList, nextIndex, this.allServers, this.currentServerIndex);
      this.showAlert(`Đang chuyển sang: ${nextEp.name}`);
    } else {
      this.showAlert('Bạn đã xem đến tập cuối cùng!');
    }
  },

  onEnded() {
    if (this.episodesList.length > 0 && this.currentEpIndex < this.episodesList.length - 1) {
      this.showAlert('Tập phim đã kết thúc. Tự động chuyển tập sau 3s...');
      setTimeout(() => {
        this.playNextEpisode();
      }, 3000);
    }
  },

  toggleFullscreen() {
    // Fullscreen on entire wrapper container ensures subtitles are never obstructed
    if (!document.fullscreenElement) {
      this.wrapper.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
    }
  },

  async toggleLandscapeFullscreen() {
    if (this.isLandscapeForced) {
      this.exitLandscapeFullscreen();
      return;
    }

    this.isLandscapeForced = true;
    const btn = document.getElementById('btnLandscapeFullscreen');
    if (btn) btn.classList.add('active');

    // 1. Try native screen.orientation lock if available
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch (e) {
      console.log('Screen orientation lock not supported:', e);
    }

    // 2. For iOS Safari native video, enter webkit fullscreen directly
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS && this.video && this.video.webkitEnterFullscreen) {
      try {
        this.video.webkitEnterFullscreen();
        this.showAlert('🔄 Đang mở toàn màn hình ngang (iOS Native)');
        return;
      } catch (e) {
        console.warn('webkitEnterFullscreen error:', e);
      }
    }

    // 3. Request standard HTML5 fullscreen on wrapper
    if (!document.fullscreenElement && this.wrapper.requestFullscreen) {
      this.wrapper.requestFullscreen().catch(() => {});
    }

    // 4. Force landscape CSS rotation (for phones locked in portrait)
    this.wrapper.classList.add('landscape-forced');
    this.showAlert('🔄 Đã phóng to toàn màn hình ngang (16:9 Cinema)');
  },

  exitLandscapeFullscreen() {
    this.isLandscapeForced = false;
    const btn = document.getElementById('btnLandscapeFullscreen');
    if (btn) btn.classList.remove('active');

    if (this.wrapper) {
      this.wrapper.classList.remove('landscape-forced');
    }

    try {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    } catch (e) {}

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  },

  showBuffering(isBuffering, text = 'Đang tải...') {
    const el = document.getElementById('playerBuffering');
    const txt = document.getElementById('bufferingText');
    if (txt) txt.textContent = text;
    if (el) el.classList.toggle('hidden', !isBuffering);
  },

  showAlert(text) {
    const alertEl = document.getElementById('playerAlert');
    if (!alertEl) return;
    alertEl.textContent = text;
    alertEl.classList.remove('hidden');
    clearTimeout(this.alertTimer);
    this.alertTimer = setTimeout(() => {
      alertEl.classList.add('hidden');
    }, 2500);
  },

  resetInactivityTimer() {
    this.wrapper.classList.remove('inactive');
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (!this.video.paused) {
        this.wrapper.classList.add('inactive');
      }
    }, 2800);
  },

  hideControls() {
    if (!this.video.paused) {
      this.wrapper.classList.add('inactive');
    }
  },

  formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h > 0) {
      return `${h}:${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
    }
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  },

  getProgressStorageKey() {
    if (!this.currentMovie || !this.currentEpisode) return null;
    return `watch_${this.currentMovie.slug}_${this.currentEpisode.slug || this.currentEpIndex}`;
  },

  getSavedWatchTime() {
    const key = this.getProgressStorageKey();
    if (!key) return 0;
    const val = localStorage.getItem(key);
    return val ? parseFloat(val) : 0;
  },

  startProgressSaveTimer() {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveInterval = setInterval(() => {
      if (this.video && !this.video.paused && this.video.currentTime > 3) {
        const key = this.getProgressStorageKey();
        if (key) {
          localStorage.setItem(key, this.video.currentTime.toFixed(1));
        }
        if (window.ContinueWatching && this.currentMovie && this.video.duration) {
          ContinueWatching.saveItem(
            this.currentMovie,
            this.currentEpisode?.name || `Tập ${this.currentEpIndex + 1}`,
            this.video.currentTime,
            this.video.duration
          );
        }
      }
    }, 4000);
  },

  onKeyDown(e) {
    if (this.modal.classList.contains('hidden')) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.togglePlayPause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.seekRelative(-10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.seekRelative(10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.video.volume = Math.min(1, this.video.volume + 0.1);
        document.getElementById('volumeSlider').value = this.video.volume;
        this.updateVolumeIcons();
        this.showAlert(`Âm lượng: ${Math.round(this.video.volume * 100)}%`);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.video.volume = Math.max(0, this.video.volume - 0.1);
        document.getElementById('volumeSlider').value = this.video.volume;
        this.updateVolumeIcons();
        this.showAlert(`Âm lượng: ${Math.round(this.video.volume * 100)}%`);
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        break;
      case 's':
      case 'S':
        this.toggleAspectRatio();
        break;
      case 'Escape':
        this.close();
        break;
    }
  }
};

// Global Helpers for HTML inline calls
function togglePlayPause() { Player.togglePlayPause(); }
function seekRelative(sec) { Player.seekRelative(sec); }
function toggleMute() { Player.toggleMute(); }
function toggleFullscreen() { Player.toggleFullscreen(); }
function toggleLandscapeFullscreen() { Player.toggleLandscapeFullscreen(); }
function toggleAspectRatio() { Player.toggleAspectRatio(); }
function playNextEpisode() { Player.playNextEpisode(); }
function closePlayer() { Player.close(); }

function togglePlayerServerMenu() {
  document.getElementById('playerServerMenu').classList.toggle('hidden');
}

function toggleSpeedMenu() {
  document.getElementById('speedMenu').classList.toggle('hidden');
  document.getElementById('qualityMenu').classList.add('hidden');
}

function setPlaybackSpeed(rate) {
  Player.setPlaybackSpeed(rate);
}

function toggleQualityMenu() {
  document.getElementById('qualityMenu').classList.toggle('hidden');
  document.getElementById('speedMenu').classList.add('hidden');
}

function setQuality(idx) {
  Player.setQuality(idx);
}

document.addEventListener('DOMContentLoaded', () => {
  Player.init();
});
