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

function activationFailureMessage(result, fallback = 'Key không đúng hoặc không còn hiệu lực trên thiết bị này.') {
  if (String(result?.code || '').includes('TELEGRAM')) {
    return 'Đây là key quản trị. Chỉ key quản trị cần Telegram ID Admin; key người xem không cần Telegram ID.';
  }
  return result?.reason || result?.message || fallback;
}

const Auth = {
  activeKeyData: null,
  heartbeatTimer: null,
  deviceApprovalTimer: null,

  getDeviceId() {
    let id = localStorage.getItem('phim4k_device_id') || getPersistentCookie('phim4k_device_id');
    if (!id) {
      id = 'dev_' + crypto.randomUUID();
      localStorage.setItem('phim4k_device_id', id);
      setPersistentCookie('phim4k_device_id', id, 365);
    }
    return id;
  },

  async getAccessPolicy() {
    return API.fetchJson(`/api/app/access-policy?refresh=${Date.now()}`, { cache: 'no-store' }, 12000);
  },

  async init() {
    // Persistent login: Read from localStorage or fallback to cookie
    const savedKey = localStorage.getItem('phim4k_key') || getPersistentCookie('phim4k_key');
    const savedTeleId = localStorage.getItem('phim4k_telegram_id') || getPersistentCookie('phim4k_telegram_id');
    const deviceOnly = localStorage.getItem('phim4k_device_only') === '1';
    const deviceId = this.getDeviceId();

    const teleInput = document.getElementById('telegramInput');
    const keyInput = document.getElementById('keyInput');
    // Never disclose a cached identity in the activation gate before the
    // server has verified the saved session.  This also clears legacy builds
    // that accidentally left an administrator's local values visible.
    if (teleInput) teleInput.value = '';
    if (keyInput) keyInput.value = '';

    // Check the shared Admin policy before using a saved key. A stale or
    // disabled key must not keep a device trapped at the gate after Admin has
    // switched the whole app to free access.
    try {
      const policy = await this.getAccessPolicy();
      if (policy.maintenance?.active === true && !savedKey) {
        this.showMaintenance(policy.maintenance);
        return;
      }
      if (policy.freeAccess === true && policy.maintenance?.active !== true) {
        const guest = await API.checkStatus('', '', deviceId);
        if (guest.active && guest.freeAccess && !guest.forceUpdate) {
          this.unlockApp({ ...guest, key: '', telegramId: '' });
          return;
        }
      }
    } catch (_) { /* The normal key check below still fails closed. */ }

    if (!savedKey) {
      const pendingDeviceKey = localStorage.getItem('phim4k_pending_device_key');
      this.triggerLock();
      if (pendingDeviceKey) {
        if (keyInput) keyInput.value = pendingDeviceKey;
        beginDeviceApprovalPolling(pendingDeviceKey);
      }
      return;
    }

    try {
      const res = deviceOnly
        ? await API.checkDeviceAccess(savedKey, deviceId)
        : await API.checkStatus(savedKey, savedTeleId, deviceId);
      if (res.forceUpdate || res.code === 'FORCE_UPDATE_REQUIRED') {
        showForceUpdateModal(res);
        return;
      }
      if (res.code === 'MAINTENANCE_MODE' || res.maintenance?.active === true) {
        this.showMaintenance(res.maintenance || { active: true, message: res.message });
        return;
      }
      if (res.active) {
        // Automatically unlock without requiring re-entry
        this.unlockApp({ ...res, key: savedKey, telegramId: deviceOnly ? '' : savedTeleId, deviceOnly });
        this.startHeartbeat();
      } else if (res.code === 'KEY_EXPIRED') {
        if (teleInput) teleInput.value = '';
        localStorage.removeItem('phim4k_telegram_id');
        deletePersistentCookie('phim4k_telegram_id');
        const keyInput = document.getElementById('keyInput');
        if (keyInput) {
          keyInput.value = '';
          keyInput.placeholder = 'Nhập mã Key mới để gia hạn';
          keyInput.focus();
        }
        this.triggerLock(`⚠️ Gói License Key của bạn đã hết hạn! Vui lòng nhập mã Key mới để tiếp tục xem phim.`);
      } else {
        this.clearStoredSession();
        this.triggerLock(activationFailureMessage(res, 'Thông tin bản quyền không còn hợp lệ'));
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
    if (this.deviceApprovalTimer) {
      clearInterval(this.deviceApprovalTimer);
      this.deviceApprovalTimer = null;
    }

    document.body.classList.add('activation-locked');
    const gate = document.getElementById('activationGate');
    gate.classList.remove('hidden', 'maintenance-active');
    document.getElementById('maintenanceNotice')?.classList.add('hidden');
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

  showMaintenance(value = {}) {
    const maintenance = value?.active === false ? { active: true } : value;
    this.triggerLock();
    const gate = document.getElementById('activationGate');
    const notice = document.getElementById('maintenanceNotice');
    gate?.classList.add('maintenance-active');
    notice?.classList.remove('hidden');
    const message = document.getElementById('maintenanceMessage');
    if (message) message.textContent = maintenance.message || 'Hệ thống đang được nâng cấp. Vui lòng quay lại sau.';
    const until = document.getElementById('maintenanceUntil');
    if (until) {
      const expiry = Date.parse(maintenance.expiresAt || '');
      until.textContent = Number.isFinite(expiry)
        ? `Dự kiến mở lại ${new Date(expiry).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`
        : 'Admin sẽ mở lại ngay khi nâng cấp hoàn tất.';
    }
    const adminFields = document.getElementById('adminLoginFields');
    if (adminFields) adminFields.open = true;
    const buttonText = document.querySelector('#btnActivate .btn-text');
    if (buttonText) buttonText.textContent = 'ĐĂNG NHẬP QUẢN TRỊ';
  },

  async retryAfterMaintenance() {
    const button = document.getElementById('maintenanceRetryBtn');
    if (button) { button.disabled = true; button.textContent = 'Đang kiểm tra…'; }
    try { await this.init(); }
    finally {
      if (button) { button.disabled = false; button.textContent = 'Kiểm tra lại'; }
    }
  },

  clearStoredSession() {
    this.activeKeyData = null;
    localStorage.removeItem('phim4k_key');
    localStorage.removeItem('phim4k_telegram_id');
    localStorage.removeItem('phim4k_plan');
    localStorage.removeItem('phim4k_device_only');
    deletePersistentCookie('phim4k_key');
    deletePersistentCookie('phim4k_telegram_id');
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
    if (this.deviceApprovalTimer) {
      clearTimeout(this.deviceApprovalTimer);
      this.deviceApprovalTimer = null;
    }
    const deviceRequestButton = document.getElementById('btnRequestDeviceAccess');
    if (deviceRequestButton) {
      deviceRequestButton.disabled = false;
      deviceRequestButton.textContent = 'Báo Admin duyệt thiết bị này';
    }
    
    // Save to both localStorage and persistent cookie (365 days)
    localStorage.setItem('phim4k_key', keyData.key || '');
    setPersistentCookie('phim4k_key', keyData.key || '', 365);

    if (keyData.telegramId) {
      localStorage.setItem('phim4k_telegram_id', keyData.telegramId);
      setPersistentCookie('phim4k_telegram_id', keyData.telegramId, 365);
    }
    if (keyData.deviceOnly || keyData.keyOnly || keyData.freeAccess) {
      if (keyData.deviceOnly) localStorage.setItem('phim4k_device_only', '1');
      else localStorage.removeItem('phim4k_device_only');
      localStorage.removeItem('phim4k_telegram_id');
      deletePersistentCookie('phim4k_telegram_id');
    } else {
      localStorage.removeItem('phim4k_device_only');
    }
    localStorage.setItem('phim4k_plan', keyData.isAdmin ? 'SUPER ADMIN' : (keyData.plan || 'VIP PRO'));

    document.body.classList.remove('activation-locked');
    const gate = document.getElementById('activationGate');
    gate.classList.remove('maintenance-active');
    gate.classList.add('hidden');
    document.getElementById('maintenanceNotice')?.classList.add('hidden');
    const buttonText = document.querySelector('#btnActivate .btn-text');
    if (buttonText) buttonText.textContent = 'XÁC THỰC VÀ VÀO XEM PHIM';
    document.getElementById('appContainer').classList.remove('hidden');

    // VIP Plan display
    const vipText = document.getElementById('vipPlanText');
    if (vipText) vipText.textContent = keyData.isAdmin ? 'SUPER ADMIN' : (keyData.plan || 'VIP PRO');

    const expiryLabel = keyData.freeAccess ? 'Miễn key trong thời gian Admin cho phép' : this.formatExpiry(keyData.expiresAt);
    const vipExpiry = document.getElementById('vipExpiryText');
    if (vipExpiry) vipExpiry.textContent = expiryLabel;

    // The server is the only authority for administrator access. Never bundle
    // the private administrator identity in a client-side comparison.
    const adminBtn = document.getElementById('adminNavBtn');
    if (adminBtn) {
      if (keyData.isAdmin === true) {
        adminBtn.classList.remove('hidden');
      } else {
        adminBtn.classList.add('hidden');
      }
    }

    // Footer info
    const footerTele = document.getElementById('footerTeleBadge');
    if (footerTele) {
      footerTele.textContent = keyData.freeAccess ? 'Chế độ miễn key' : (keyData.keyOnly ? 'Key gắn với thiết bị này' : keyData.deviceOnly ? 'Thiết bị được Admin duyệt' : (keyData.telegramId || 'Chưa liên kết'));
    }
    const footerBadge = document.getElementById('footerKeyBadge');
    if (footerBadge) {
      const rawKey = String(keyData.key || '');
      const maskedKey = rawKey ? `${rawKey.slice(0, 4)}••••${rawKey.slice(-4)}` : 'Chưa có key';
      footerBadge.textContent = `${maskedKey} (${keyData.plan || 'VIP'})`;
    }
    const footerExpiry = document.getElementById('footerExpiryBadge');
    if (footerExpiry) footerExpiry.textContent = expiryLabel;

    // Start Real-time Heartbeat Kickout watcher
    this.startHeartbeat();

    // Trigger initial content load
    if (window.App && window.App.loadHomeFeed) {
      window.App.loadHomeFeed();
    }
    void window.ContinueWatching?.syncFromServer?.();
    window.renderAccountTab?.();
    window.API?.trackUsage?.('app_open', {
      entry: keyData.deviceOnly ? 'device-approved' : (keyData.isAdmin ? 'admin' : 'telegram')
    });
  },

  // Real-time Heartbeat: checks key status & expiry every 30 seconds
  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      const key = localStorage.getItem('phim4k_key') || getPersistentCookie('phim4k_key');
      const teleId = localStorage.getItem('phim4k_telegram_id') || getPersistentCookie('phim4k_telegram_id');
      const deviceOnly = localStorage.getItem('phim4k_device_only') === '1';
      if (!key && !this.activeKeyData?.freeAccess) return;

      try {
        const res = deviceOnly
          ? await API.checkDeviceAccess(key, this.getDeviceId())
          : await API.checkStatus(key, teleId, this.getDeviceId());
        if (res.code === 'MAINTENANCE_MODE' || res.maintenance?.active === true) {
          this.showMaintenance(res.maintenance || { active: true, message: res.message });
          return;
        }
        if (!res.active) {
          console.warn('Heartbeat detected expired, blocked, or device/tele mismatch:', res);
          
        if (res.forceUpdate || res.code === 'FORCE_UPDATE_REQUIRED') {
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
            this.clearStoredSession();
            this.triggerLock(`⚠️ ${activationFailureMessage(res, 'Khóa kích hoạt không còn hiệu lực.')}`);
          }
        }
      } catch (err) {
        if (this.activeKeyData?.freeAccess) this.triggerLock('Không xác minh được chế độ miễn key. Vui lòng thử lại.');
      }
    }, 30000);
  }
};

// WKWebView does not expose a top-level `const` as `window.Auth`.  Admin and
// account modules intentionally use the Window reference because they load in
// separate script files, so expose the already-created session object here.
window.Auth = Auth;

// Form submit event
async function handleActivation(e) {
  e.preventDefault();
  const teleInput = document.getElementById('telegramInput');
  const keyInput = document.getElementById('keyInput');
  const btn = document.getElementById('btnActivate');
  const spinner = document.getElementById('activateSpinner');
  const msgEl = document.getElementById('gateMessage');

  const telegramId = document.getElementById('adminLoginFields')?.open ? teleInput.value.trim() : '';
  const key = keyInput.value.trim();

  if (!key) {
    msgEl.textContent = 'Vui lòng nhập License Key!';
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
      
      if (res.forceUpdate) {
        showForceUpdateModal(res);
        return;
      }
      setTimeout(() => {
        // Bind the verified session to the values submitted for this request.
        // Some valid server responses intentionally omit the raw key and ID;
        // without this merge the UI would open and then render as inactive.
        const verifiedSession = { ...res, key, telegramId };
        Auth.unlockApp(verifiedSession);
        if (verifiedSession.isAdmin === true) {
          setTimeout(() => Admin.open(), 400);
        }
      }, 500);
    } else {
      if (res.code === 'MAINTENANCE_MODE') {
        Auth.showMaintenance(res.maintenance || { active: true, message: res.message });
        return;
      }
      const adminIdentityRequired = String(res.code || '').includes('TELEGRAM');
      if (adminIdentityRequired) {
        const adminFields = document.getElementById('adminLoginFields');
        if (adminFields) adminFields.open = true;
        msgEl.textContent = activationFailureMessage(res);
        teleInput?.focus();
      } else {
        msgEl.textContent = activationFailureMessage(res);
      }
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

async function requestDeviceOnlyAccess() {
  const keyInput = document.getElementById('keyInput');
  const button = document.getElementById('btnRequestDeviceAccess');
  const msgEl = document.getElementById('gateMessage');
  const key = String(keyInput?.value || '').trim().toUpperCase();
  if (!key) {
    msgEl.textContent = 'Hãy nhập License Key trước khi báo Admin.';
    msgEl.className = 'gate-message error';
    msgEl.classList.remove('hidden');
    keyInput?.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Đang gửi yêu cầu…';
  try {
    const response = await API.requestDeviceAccess(key, Auth.getDeviceId());
    msgEl.textContent = response.message || 'Đã gửi yêu cầu. Đang chờ Admin duyệt…';
    msgEl.className = response.status === 'approved' ? 'gate-message success' : 'gate-message pending';
    msgEl.classList.remove('hidden');
    localStorage.setItem('phim4k_pending_device_key', key);
    await beginDeviceApprovalPolling(key);
  } catch (error) {
    msgEl.textContent = error.message || 'Không thể gửi yêu cầu cho Admin.';
    msgEl.className = 'gate-message error';
    msgEl.classList.remove('hidden');
    button.disabled = false;
    button.textContent = 'Báo Admin duyệt thiết bị này';
  }
}

async function beginDeviceApprovalPolling(key) {
  const cleanKey = String(key || '').trim().toUpperCase();
  if (!cleanKey || Auth.activeKeyData) return;

  const button = document.getElementById('btnRequestDeviceAccess');
  const msgEl = document.getElementById('gateMessage');
  const deviceId = Auth.getDeviceId();
  if (Auth.deviceApprovalTimer) clearTimeout(Auth.deviceApprovalTimer);
  Auth.deviceApprovalTimer = null;
  if (button) {
    button.disabled = true;
    button.textContent = 'Đang chờ Admin duyệt thiết bị…';
  }

  const scheduleNext = () => {
    if (!Auth.activeKeyData) {
      Auth.deviceApprovalTimer = setTimeout(checkApproval, 5000);
    }
  };

  const checkApproval = async () => {
    Auth.deviceApprovalTimer = null;
    try {
      const status = await API.checkDeviceAccess(cleanKey, deviceId);
      if (status.active && status.status === 'approved') {
        localStorage.removeItem('phim4k_pending_device_key');
        if (msgEl) {
          msgEl.textContent = 'Admin đã cấp phép thiết bị. Đang mở ứng dụng…';
          msgEl.className = 'gate-message success';
          msgEl.classList.remove('hidden');
        }
        Auth.unlockApp({ ...status, key: cleanKey, telegramId: '', deviceOnly: true });
        return;
      }

      if (status.status === 'rejected') {
        localStorage.removeItem('phim4k_pending_device_key');
        if (msgEl) {
          msgEl.textContent = 'Admin đã từ chối yêu cầu cho thiết bị này.';
          msgEl.className = 'gate-message error';
          msgEl.classList.remove('hidden');
        }
        if (button) {
          button.disabled = false;
          button.textContent = 'Báo Admin duyệt thiết bị này';
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = 'Đã báo Admin · đang tự kiểm tra trạng thái duyệt…';
        msgEl.className = 'gate-message pending';
        msgEl.classList.remove('hidden');
      }
      scheduleNext();
    } catch (_error) {
      if (msgEl) {
        msgEl.textContent = 'Yêu cầu đã lưu. Đang chờ kết nối để kiểm tra Admin duyệt.';
        msgEl.className = 'gate-message pending';
        msgEl.classList.remove('hidden');
      }
      scheduleNext();
    }
  };

  await checkApproval();
}

window.requestDeviceOnlyAccess = requestDeviceOnlyAccess;

// License Info Modal
function openLicenseModal() {
  const d = Auth.activeKeyData;
  if (!d) return;

  document.getElementById('licTelegram').textContent = d.freeAccess
    ? 'Miễn key'
    : d.keyOnly
      ? 'Key gắn với thiết bị'
      : d.deviceOnly
        ? 'Thiết bị được Admin duyệt'
        : d.isAdmin
          ? 'Tài khoản quản trị đã xác thực'
          : 'Key người xem';
  document.getElementById('licPlan').textContent = d.plan || '-';
  const rawKey = String(d.key || '');
  document.getElementById('licKey').textContent = rawKey ? `${rawKey.slice(0, 4)}••••${rawKey.slice(-4)}` : '-';
  
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
  if (confirm('Đăng xuất trên máy này? Key vẫn gắn với thiết bị; chỉ Admin có thể reset để đổi máy.')) {
    Auth.clearStoredSession();
    hideLicenseModal();
    Auth.triggerLock('Nhập key để đăng nhập. Admin dùng mục Đăng nhập quản trị.');
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

let appRefreshInFlight = false;
async function refreshAppFromServer(button) {
  if (appRefreshInFlight) return;
  appRefreshInFlight = true;
  const originalText = button?.textContent || '🔄 Làm mới ứng dụng';
  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Đang cập nhật…';
  }
  try {
    API.clearMovieCache();
    await Auth.getAccessPolicy();
    if (button) button.textContent = '✅ Đã cập nhật';
    window.setTimeout(() => window.location.reload(), 180);
  } catch (_error) {
    appRefreshInFlight = false;
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    const message = 'Không lấy được thay đổi mới. Hãy kiểm tra mạng rồi bấm lại.';
    const gateMessage = document.getElementById('gateMessage');
    if (!document.getElementById('activationGate')?.classList.contains('hidden') && gateMessage) {
      gateMessage.textContent = message;
      gateMessage.className = 'gate-message error';
      gateMessage.classList.remove('hidden');
    } else {
      alert(message);
    }
  }
}

window.refreshAppFromServer = refreshAppFromServer;

// ==========================================
// DOWNLOAD APP MODAL HELPERS (ADR, IPA, EXE)
// ==========================================
let downloadRequest = null;
let downloadReturnFocus = null;
async function refreshPublicDownloads() {
  if (downloadRequest) return downloadRequest;
  const ids = { android: ['Apk', 'APK'], ios: ['Ipa', 'IPA'], windows: ['Exe', 'EXE'], android_tv: ['Tv', 'APK TV'] };
  const platform = Phim4KPlatform.detect(navigator.userAgent, window.PHIM4K_PLATFORM);
  const render = (data, failed = false) => {
    for (const [key, [id, format]] of Object.entries(ids)) {
      const entry = Phim4KPlatform.release(data, key);
      for (const prefix of ['btnDownload', 'forceBtn']) {
        const btn = document.getElementById(prefix + id);
        if (!btn) continue;
        btn.removeAttribute('download');
        btn.removeAttribute('href');
        btn.setAttribute('aria-disabled', entry.url ? 'false' : 'true');
        const older = key === platform && Phim4KPlatform.releaseState(entry, API.getVersion()) === 'older';
        btn.textContent = entry.url ? `Tải ${format}${older ? ' · Bản công khai cũ hơn' : key === platform ? ' · Phù hợp thiết bị này' : ''}` : (failed ? 'Chưa tải được link · Thử lại' : 'Chưa phát hành');
        btn.onclick = null;
        if (entry.url) {
          btn.href = entry.url; btn.target = '_blank'; btn.rel = 'noopener noreferrer';
          if (key === 'android_tv' && window.Phim4KNativeDownloads?.supported()) {
            btn.onclick = event => { event.preventDefault(); void Phim4KNativeDownloads.open(btn, entry.url); };
          }
        }
        btn.closest('.download-card')?.classList.toggle('recommended-download', key === platform);
      }
      const meta = document.getElementById(`meta${id}Ver`);
      if (meta) meta.textContent = entry.url ? `v${entry.version || '?'} · ${Phim4KPlatform.labels[key]}` : 'Chỉ hiển thị bản đã phát hành';
    }
  };
  render({});
  const status = document.getElementById('downloadReleaseStatus');
  const retry = document.getElementById('downloadRetryBtn');
  if (status) status.textContent = 'Đang lấy danh sách bản phát hành…';
  retry?.classList.add('hidden');
  downloadRequest = (async () => {
    try {
      const data = await API.fetchJson('/api/app/downloads', {}, 12000);
      render(data);
      const entry = Phim4KPlatform.release(data, platform);
      const state = Phim4KPlatform.releaseState(entry, API.getVersion());
      if (status) status.textContent = state === 'older'
        ? `Bạn đang dùng ${API.getVersion()}; bản công khai là ${entry.version}, cũ hơn bản trên máy. Chưa có link tải bản mới này; không cần hạ phiên bản.`
        : state === 'newer' ? `Có bản ${entry.version} cho ${Phim4KPlatform.labels[platform]}. Bấm nút tải bên dưới.`
        : state === 'current' ? `Bạn đang dùng bản ${API.getVersion()}. Có thể tải lại hoặc chọn bản cho thiết bị khác.`
        : state === 'unknown' ? 'Có file tải nhưng chưa xác định được phiên bản. Kiểm tra thông tin trước khi cài.'
        : 'Chưa có file cho thiết bị này. Các bản đã phát hành được liệt kê bên dưới.';
    } catch (err) {
      render({}, true);
      if (status) status.textContent = 'Không lấy được danh sách. Kiểm tra kết nối và bấm Thử tải lại danh sách.';
      retry?.classList.remove('hidden');
    }
  })();
  try { await downloadRequest; } finally { downloadRequest = null; }
}

window.refreshPublicDownloads = refreshPublicDownloads;

function openDownloadModal() {
  if (document.getElementById('downloadAppModal').classList.contains('hidden')) downloadReturnFocus = document.activeElement;
  document.getElementById('downloadAppModal').classList.remove('hidden');
  document.querySelector('.download-dialog').scrollTop = 0;
  document.querySelector('#downloadAppModal .modal-close-btn').focus({ preventScroll: true });
  return refreshPublicDownloads();
}

function hideDownloadModal() {
  document.getElementById('downloadAppModal').classList.add('hidden');
  downloadReturnFocus?.focus?.({ preventScroll: true });
  downloadReturnFocus = null;
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

  document.body.classList.add('activation-locked');
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

  void refreshPublicDownloads();

  modal.classList.remove('hidden');
}

async function checkAppUpdate(showAccountResult = false) {
  const icon = document.getElementById('checkUpdateIcon');
  const text = document.getElementById('checkUpdateText');
  const box = document.getElementById('updateCheckResultBox');
  const accountBox = document.getElementById('accUpdateStatus');

  if (icon) icon.textContent = '⏳';
  if (text) text.textContent = 'Đang kiểm tra...';
  if (box) box.classList.add('hidden');
  if (accountBox) accountBox.classList.add('hidden');

  try {
    const res = await API.checkUpdate(API.getVersion());
    if (!res.forceUpdate) {
      const platform = Phim4KPlatform.detect(navigator.userAgent, window.PHIM4K_PLATFORM);
      const releases = await API.fetchJson('/api/app/downloads', {}, 12000);
      const release = Phim4KPlatform.release(releases, platform);
      const state = Phim4KPlatform.releaseState(release, API.getVersion());
      res.isLatest = state === 'current' || state === 'older';
      res.message = state === 'unavailable' ? 'Chưa có bản phát hành phù hợp thiết bị này.'
        : state === 'newer' ? `Có bản ${release.version}. Bấm Tải phiên bản mới để cập nhật.`
        : state === 'older' ? `Bạn đang dùng ${API.getVersion()}, mới hơn bản công khai ${release.version}. Không cần hạ phiên bản.`
        : state === 'unknown' ? 'Chưa xác định được phiên bản file tải. Vui lòng kiểm tra lại sau.'
        : `Bạn đang dùng bản ${API.getVersion()}.`;
    }

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
    if (showAccountResult && accountBox) {
      accountBox.textContent = res.message || 'Da kiem tra phien ban.';
      accountBox.className = res.isLatest ? 'gate-message success' : 'gate-message error';
      accountBox.classList.remove('hidden');
    }
  } catch (err) {
    if (icon) icon.textContent = '🔄';
    if (text) text.textContent = 'Kiểm Tra Phiên Bản Mới Nhất';
    if (box) {
      box.textContent = '❌ Không thể kết nối đến máy chủ kiểm tra cập nhật!';
      box.className = 'gate-message error';
      box.classList.remove('hidden');
    }
    if (showAccountResult && accountBox) {
      accountBox.textContent = 'Khong the ket noi may chu kiem tra cap nhat.';
      accountBox.className = 'gate-message error';
      accountBox.classList.remove('hidden');
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
