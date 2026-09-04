// License Key & Telegram ID Authentication, Device Binding & Real-time Expiry Watcher

// Cookie helpers for persistent 1-time login across browser reboots
function setPersistentCookie(name, value, days = 365) {
  try {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  } catch (e) {}
}

function getPersistentCookie(name) {
  try {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
  } catch (e) {
    return '';
  }
}

function deletePersistentCookie(name) {
  try {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  } catch (e) {}
}

const Auth = {
  activeKeyData: null,
  heartbeatTimer: null,

  getDeviceId() {
    let id = localStorage.getItem('phim4k_device_id') || getPersistentCookie('phim4k_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem('phim4k_device_id', id);
      setPersistentCookie('phim4k_device_id', id, 365);
    }
    return id;
  },

  async init() {
    // Persistent login: Read from localStorage or fallback to cookie
    const savedKey = localStorage.getItem('phim4k_key') || getPersistentCookie('phim4k_key');
    const savedTeleId = localStorage.getItem('phim4k_telegram_id') || getPersistentCookie('phim4k_telegram_id');
    const deviceId = this.getDeviceId();

    // Pre-fill Telegram ID if known
    const teleInput = document.getElementById('telegramInput');
    if (teleInput && savedTeleId) {
      teleInput.value = savedTeleId;
    }

    if (!savedKey || !savedTeleId) {
      this.triggerLock();
      return;
    }

    try {
      const res = await API.checkStatus(savedKey, savedTeleId, deviceId);
      if (res.code === 'FORCE_UPDATE_REQUIRED') {
        showForceUpdateModal(res);
        return;
      }
      if (res.active) {
        // Automatically unlock without requiring re-entry
        this.unlockApp(res);
        this.startHeartbeat();
      } else if (res.code === 'KEY_EXPIRED') {
        // Only require new key when expired! Pre-fill Telegram ID
        if (teleInput) teleInput.value = savedTeleId;
        const keyInput = document.getElementById('keyInput');
        if (keyInput) {
          keyInput.value = '';
          keyInput.placeholder = 'Nhập mã Key mới để gia hạn';
          keyInput.focus();
        }
        this.triggerLock(`⚠️ Gói License Key của bạn đã hết hạn! Vui lòng nhập mã Key mới để tiếp tục xem phim.`);
      } else {
        this.triggerLock(res.reason || 'Thông tin bản quyền không còn hợp lệ');
      }
    } catch (err) {
      console.warn('Network issue on init, keeping persistent state:', err);
      this.triggerLock('Không thể kiểm tra bản quyền khi máy chủ không phản hồi. Vui lòng thử lại khi có mạng.');
      return;
      // Don't lock user on network glitch if previously authenticated
      if (savedKey && savedTeleId) {
        this.unlockApp({ key: savedKey, telegramId: savedTeleId, plan: 'VIP' });
      } else {
        this.triggerLock('Không thể kết nối đến máy chủ xác thực');
      }
    }
  },

  triggerLock(errorMessage = '') {
    if (window.Player && window.Player.close) {
      window.Player.close();
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    document.body.classList.add('locked');
    document.getElementById('activationGate').classList.remove('hidden');
    document.getElementById('appContainer').classList.add('hidden');
    
    const adminBtn = document.getElementById('adminNavBtn');
    if (adminBtn) adminBtn.classList.add('hidden');

    const msgEl = document.getElementById('gateMessage');
    if (errorMessage) {
      msgEl.textContent = errorMessage;
      msgEl.className = 'gate-message error';
      msgEl.classList.remove('hidden');
    } else {
      msgEl.classList.add('hidden');
    }
  },

  formatExpiry(expiresAt) {
    if (!expiresAt) return 'Vĩnh viễn';
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime())) return 'Chưa xác định';
    const remaining = expiry.getTime() - Date.now();
    const formatted = expiry.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
    if (remaining <= 0) return `Đã hết hạn (${formatted})`;
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    return `Hết hạn ${formatted} · còn ${days} ngày ${hours} giờ`;
  },

  unlockApp(keyData) {
    this.activeKeyData = keyData;
    
    // Save to both localStorage and persistent cookie (365 days)
    localStorage.setItem('phim4k_key', keyData.key);
    setPersistentCookie('phim4k_key', keyData.key, 365);

    if (keyData.telegramId) {
      localStorage.setItem('phim4k_telegram_id', keyData.telegramId);
      setPersistentCookie('phim4k_telegram_id', keyData.telegramId, 365);
    }

    document.body.classList.remove('locked');
    document.getElementById('activationGate').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');

    // VIP Plan display
    const vipText = document.getElementById('vipPlanText');
    if (vipText) vipText.textContent = keyData.isAdmin ? 'SUPER ADMIN' : (keyData.plan || 'VIP PRO');

    const expiryLabel = this.formatExpiry(keyData.expiresAt);
    const vipExpiry = document.getElementById('vipExpiryText');
    if (vipExpiry) vipExpiry.textContent = expiryLabel;

    // The server decides whether this activated session is an administrator.
    const adminBtn = document.getElementById('adminNavBtn');
    if (adminBtn) {
      if (keyData.isAdmin) {
        adminBtn.classList.remove('hidden');
      } else {
        adminBtn.classList.add('hidden');
      }
    }

    // Footer info
    const footerTele = document.getElementById('footerTeleBadge');
    if (footerTele) {
      footerTele.textContent = keyData.telegramId || 'Chưa liên kết';
    }
    const footerBadge = document.getElementById('footerKeyBadge');
    if (footerBadge) {
      footerBadge.textContent = `${keyData.key} (${keyData.plan || 'VIP'})`;
    }
    const footerExpiry = document.getElementById('footerExpiryBadge');
    if (footerExpiry) footerExpiry.textContent = expiryLabel;

    // Start Real-time Heartbeat Kickout watcher
    this.startHeartbeat();

    // Trigger initial content load
    if (window.App && window.App.loadHomeFeed) {
      window.App.loadHomeFeed();
    }
  },

  // Real-time Heartbeat: checks key status & expiry every 30 seconds
  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      const key = localStorage.getItem('phim4k_key') || getPersistentCookie('phim4k_key');
      const teleId = localStorage.getItem('phim4k_telegram_id') || getPersistentCookie('phim4k_telegram_id');
      if (!key || !teleId) return;

      try {
        const res = await API.checkStatus(key, teleId, this.getDeviceId());
        if (!res.active) {
          console.warn('Heartbeat detected expired, blocked, or device/tele mismatch:', res);
          
          if (res.code === 'FORCE_UPDATE_REQUIRED') {
            showForceUpdateModal(res);
            return;
          }

          if (res.code === 'KEY_EXPIRED') {
            // Remove expired key, keep telegramId so user only has to enter the new key
            localStorage.removeItem('phim4k_key');
            deletePersistentCookie('phim4k_key');
            
            const teleInput = document.getElementById('telegramInput');
            if (teleInput) teleInput.value = teleId;

            const keyInput = document.getElementById('keyInput');
            if (keyInput) {
              keyInput.value = '';
              keyInput.placeholder = 'Nhập mã Key mới để tiếp tục xem phim';
              keyInput.focus();
            }

            this.triggerLock(`⚠️ Gói License Key của bạn đã hết hạn! Vui lòng nhập mã Key mới để gia hạn.`);
            alert(`⚠️ THÔNG BÁO:\nHạn sử dụng License Key của bạn đã kết thúc! Vui lòng nhập key mới để tiếp tục.`);
          } else {
            localStorage.removeItem('phim4k_key');
            localStorage.removeItem('phim4k_telegram_id');
            deletePersistentCookie('phim4k_key');
            deletePersistentCookie('phim4k_telegram_id');
            this.triggerLock(`⚠️ ${res.reason || 'Khóa kích hoạt không còn hiệu lực.'}`);
          }
        }
      } catch (err) {
        // Network fluctuation, ignore single glitch
      }
    }, 30000);
  }
};

// Form submit event
async function handleActivation(e) {
  e.preventDefault();
  const teleInput = document.getElementById('telegramInput');
  const keyInput = document.getElementById('keyInput');
  const btn = document.getElementById('btnActivate');
  const spinner = document.getElementById('activateSpinner');
  const msgEl = document.getElementById('gateMessage');

  const telegramId = teleInput.value.trim();
  const key = keyInput.value.trim();

  if (!telegramId || !key) {
    msgEl.textContent = 'Vui lòng nhập cả Telegram ID và License Key!';
    msgEl.className = 'gate-message error';
    msgEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  spinner.classList.remove('hidden');
  msgEl.classList.add('hidden');

  try {
    const deviceId = Auth.getDeviceId();
    const res = await API.activate(key, telegramId, deviceId);
    if (res.success) {
      msgEl.textContent = `✔ Xác thực thành công! ${Auth.formatExpiry(res.expiresAt)}. Đang vào ứng dụng...`;
      msgEl.className = 'gate-message success';
      msgEl.classList.remove('hidden');
      
      setTimeout(() => {
        Auth.unlockApp(res);
        if (res.isAdmin) {
          setTimeout(() => Admin.open(), 400);
        }
      }, 500);
    } else {
      msgEl.textContent = res.message || 'Mã kích hoạt hoặc Telegram ID không đúng!';
      msgEl.className = 'gate-message error';
      msgEl.classList.remove('hidden');
    }
  } catch (err) {
    msgEl.textContent = 'Lỗi kết nối máy chủ xác thực!';
    msgEl.className = 'gate-message error';
    msgEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
  }
}

// License Info Modal
function openLicenseModal() {
  const d = Auth.activeKeyData;
  if (!d) return;

  document.getElementById('licTelegram').textContent = d.telegramId || localStorage.getItem('phim4k_telegram_id') || '-';
  document.getElementById('licPlan').textContent = d.plan || '-';
  document.getElementById('licKey').textContent = d.key || '-';
  
  if (d.expiresAt) {
    const date = new Date(d.expiresAt);
    document.getElementById('licExpires').textContent = date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN');
  } else {
    document.getElementById('licExpires').textContent = 'Vĩnh viễn (Không thời hạn)';
  }

  document.getElementById('licDevice').textContent = Auth.getDeviceId();

  const featuresList = document.getElementById('licFeatures');
  featuresList.innerHTML = '';
  const feats = d.features || ['Xem phim chuẩn 4K / FHD', 'Chất Lượng Gốc 4K Cinema', '1 Telegram ID duy nhất', '1 Thiết bị duy nhất'];
  feats.forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;
    featuresList.appendChild(li);
  });

  document.getElementById('licenseModal').classList.remove('hidden');
}

function hideLicenseModal() {
  document.getElementById('licenseModal').classList.add('hidden');
}

function closeLicenseModal(e) {
  if (e.target.id === 'licenseModal') {
    hideLicenseModal();
  }
}

function logoutKey() {
  if (confirm('Bạn có chắc chắn muốn đăng xuất tài khoản và gỡ key khỏi thiết bị này không?')) {
    localStorage.removeItem('phim4k_key');
    localStorage.removeItem('phim4k_telegram_id');
    deletePersistentCookie('phim4k_key');
    deletePersistentCookie('phim4k_telegram_id');
    hideLicenseModal();
    Auth.triggerLock('Vui lòng nhập Telegram ID và License Key để đăng nhập');
  }
}

function promptChangeAccount() {
  logoutKey();
}

function openAdminPanel() {
  if (Auth.activeKeyData?.isAdmin) {
    Admin.open();
  } else {
    alert('❌ Bạn không có quyền truy cập Admin Panel!');
  }
}

// ==========================================
// DOWNLOAD APP MODAL HELPERS (ADR, IPA, EXE)
// ==========================================
async function refreshPublicDownloads() {
  try {
    const res = await fetch('/api/app/downloads');
    const data = await res.json();

    if (data.android) {
      const btn = document.getElementById('btnDownloadApk');
      const meta = document.getElementById('metaApkVer');
      if (btn) btn.href = data.android.url || '/download/apk';
      if (meta) meta.textContent = `v${data.android.version || '3.0.0'} • APK • Mọi Android`;
    }

    if (data.ios) {
      const btn = document.getElementById('btnDownloadIpa');
      const meta = document.getElementById('metaIpaVer');
      if (btn) btn.href = data.ios.url || '/download/ipa';
      if (meta) meta.textContent = `v${data.ios.version || '3.0.0'} • 41.8 MB • iOS 14+`;
    }

    if (data.windows) {
      const btn = document.getElementById('btnDownloadExe');
      const meta = document.getElementById('metaExeVer');
      if (btn) btn.href = data.windows.url || '/download/exe';
      if (meta) meta.textContent = `v${data.windows.version || '3.0.0'} • Windows 64-bit`;
    }
  } catch (err) {
    console.error('Error refreshing downloads links:', err);
  }
}

window.refreshPublicDownloads = refreshPublicDownloads;

function openDownloadModal() {
  refreshPublicDownloads();
  document.getElementById('downloadAppModal').classList.remove('hidden');
}

function hideDownloadModal() {
  document.getElementById('downloadAppModal').classList.add('hidden');
}

function closeDownloadModal(e) {
  if (e.target.id === 'downloadAppModal') {
    hideDownloadModal();
  }
}

// ==========================================
// FORCE UPDATE & CLIENT UPDATE CHECK HELPERS
// ==========================================
function showForceUpdateModal(data) {
  if (window.Player && window.Player.close) {
    window.Player.close();
  }

  document.body.classList.add('locked');
  document.getElementById('activationGate').classList.add('hidden');
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('downloadAppModal').classList.add('hidden');

  const modal = document.getElementById('forceUpdateModal');
  const msgEl = document.getElementById('forceUpdateMessageText');
  const clientVerEl = document.getElementById('forceClientVer');
  const minVerEl = document.getElementById('forceMinVer');

  if (msgEl) msgEl.textContent = data.reason || data.message || 'Phiên bản của bạn đã cũ, bắt buộc cập nhật!';
  if (clientVerEl) clientVerEl.textContent = `v${API.getVersion()}`;
  if (minVerEl) minVerEl.textContent = `v${data.minVersion || '3.0.0'}`;

  const btnApk = document.getElementById('forceBtnApk');
  const btnIpa = document.getElementById('forceBtnIpa');
  const btnExe = document.getElementById('forceBtnExe');

  if (btnApk) btnApk.href = data.downloads?.android?.url || '/download/apk';
  if (btnIpa) btnIpa.href = data.downloads?.ios?.url || '/download/ipa';
  if (btnExe) btnExe.href = data.downloads?.windows?.url || '/download/exe';

  modal.classList.remove('hidden');
}

async function checkAppUpdate() {
  const icon = document.getElementById('checkUpdateIcon');
  const text = document.getElementById('checkUpdateText');
  const box = document.getElementById('updateCheckResultBox');

  if (icon) icon.textContent = '⏳';
  if (text) text.textContent = 'Đang kiểm tra...';
  if (box) box.classList.add('hidden');

  try {
    const res = await API.checkUpdate(API.getVersion());

    if (icon) icon.textContent = '🔄';
    if (text) text.textContent = 'Kiểm Tra Phiên Bản Mới Nhất';

    if (res.forceUpdate) {
      showForceUpdateModal(res);
      return;
    }

    if (box) {
      box.textContent = res.message;
      box.className = res.isLatest ? 'gate-message success' : 'gate-message error';
      box.classList.remove('hidden');
    }
  } catch (err) {
    if (icon) icon.textContent = '🔄';
    if (text) text.textContent = 'Kiểm Tra Phiên Bản Mới Nhất';
    if (box) {
      box.textContent = '❌ Không thể kết nối đến máy chủ kiểm tra cập nhật!';
      box.className = 'gate-message error';
      box.classList.remove('hidden');
    }
  }
}

window.showForceUpdateModal = showForceUpdateModal;
window.checkAppUpdate = checkAppUpdate;

// Auto init on page load
document.addEventListener('DOMContentLoaded', () => {
  Auth.init().then(() => {
    if (window.location.search.includes('admin') && Auth.activeKeyData?.isAdmin) {
      setTimeout(() => Admin.open(), 400);
    }
  });
});
