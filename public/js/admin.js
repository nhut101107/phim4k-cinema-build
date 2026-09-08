// Admin Panel Controller: Keys, User Ban/Unban, Anti-DDoS, and Live Audit Logs

const Admin = {
  currentTab: 'keys',
  logAccountFilter: '',
  logTypeFilter: 'ALL',
  logCursor: null,
  loadedLogs: [],
  logRefreshTimer: null,
  logLoading: false,

  async loadAccessPolicy() {
    const toggle = document.getElementById('adminFreeAccess');
    const save = document.getElementById('saveAccessPolicy');
    toggle.disabled = save.disabled = true;
    try {
      const res = await API.fetchJson(`/api/app/access-policy?refresh=${Date.now()}`, { cache: 'no-store' });
      if (typeof res.freeAccess !== 'boolean') throw new Error('Không đọc được trạng thái');
      toggle.checked = res.freeAccess;
      this.renderMaintenance(res.maintenance);
      toggle.disabled = save.disabled = false;
      document.getElementById('accessPolicyMessage').textContent = res.freeAccess ? 'Đang miễn key' : 'Đang yêu cầu key · 1 key / 1 máy';
    } catch (_) { document.getElementById('accessPolicyMessage').textContent = 'Không đọc được trạng thái. Bấm thử lại.'; }
  },

  async saveAccessPolicy() {
    const toggle = document.getElementById('adminFreeAccess');
    const save = document.getElementById('saveAccessPolicy');
    const message = document.getElementById('accessPolicyMessage');
    const requestedFreeAccess = toggle.checked;
    toggle.disabled = save.disabled = true;
    message.textContent = requestedFreeAccess ? 'Đang bật chế độ miễn key…' : 'Đang bật lại yêu cầu key…';
    try {
      const response = await fetch('/api/admin/access-policy', {method:'POST', cache:'no-store', headers:{...this.getAdminHeaders(), 'Content-Type':'application/json'}, body:JSON.stringify({freeAccess:requestedFreeAccess})});
      const result = await response.json();
      if (!response.ok || !result.success || result.freeAccess !== requestedFreeAccess) throw new Error('Không lưu được chế độ');
      toggle.checked = result.freeAccess;
      message.textContent = result.freeAccess ? 'Đã lưu: người dùng vào ngay, không cần key hoặc Telegram.' : 'Đã lưu: người dùng chỉ cần key, không cần Telegram.';
    } catch (_) {
      message.textContent = 'Lưu thất bại. Công tắc đã trở về trạng thái trên máy chủ.';
      try {
        const current = await API.fetchJson(`/api/app/access-policy?refresh=${Date.now()}`, { cache: 'no-store' });
        if (typeof current.freeAccess === 'boolean') toggle.checked = current.freeAccess;
      } catch (_) {}
    }
    finally { toggle.disabled = save.disabled = false; }
  },

  renderMaintenance(value) {
    const maintenance = value?.active === true ? value : { active: false };
    const toggle = document.getElementById('adminMaintenanceToggle');
    const save = document.getElementById('maintenanceSaveBtn');
    const state = document.getElementById('maintenanceAdminState');
    const quick = document.getElementById('adminMaintenanceBtn');
    const message = document.getElementById('maintenanceMessageInput');
    if (toggle) { toggle.checked = maintenance.active; toggle.disabled = false; }
    if (save) save.disabled = false;
    if (message && maintenance.message) message.value = maintenance.message;
    if (state) {
      const until = maintenance.expiresAt
        ? ` · tự mở ${new Date(maintenance.expiresAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`
        : maintenance.active ? ' · tắt thủ công' : '';
      state.classList.toggle('active', maintenance.active);
      state.innerHTML = `<i></i> ${maintenance.active ? `Đang bảo trì${until}` : 'Đang hoạt động'}`;
    }
    if (quick) {
      quick.classList.toggle('active', maintenance.active);
      quick.textContent = maintenance.active ? '🛠 Đang bảo trì · mở quản lý' : '🛠 Bật / tắt bảo trì';
    }
  },

  async loadMaintenance() {
    const state = document.getElementById('maintenanceAdminState');
    const toggle = document.getElementById('adminMaintenanceToggle');
    const save = document.getElementById('maintenanceSaveBtn');
    if (toggle) toggle.disabled = true;
    if (save) save.disabled = true;
    if (state) state.innerHTML = '<i></i> Đang đọc…';
    try {
      const result = await API.fetchJson(`/api/app/access-policy?refresh=${Date.now()}`, { cache: 'no-store' }, 12000);
      this.renderMaintenance(result.maintenance);
      document.getElementById('maintenanceAdminMessage').textContent = 'Đã đồng bộ trạng thái từ máy chủ.';
    } catch (error) {
      if (state) state.innerHTML = '<i></i> Không đọc được';
      document.getElementById('maintenanceAdminMessage').textContent = error.message || 'Không đọc được trạng thái bảo trì.';
    }
  },

  async saveMaintenance() {
    const toggle = document.getElementById('adminMaintenanceToggle');
    const save = document.getElementById('maintenanceSaveBtn');
    const status = document.getElementById('maintenanceAdminMessage');
    const enabled = Boolean(toggle?.checked);
    const message = document.getElementById('maintenanceMessageInput')?.value.trim() || '';
    const durationMinutes = Number.parseInt(document.getElementById('maintenanceDurationInput')?.value || '0', 10);
    if (enabled && !message) {
      status.textContent = 'Hãy nhập thông báo cho người dùng.';
      return;
    }
    if (enabled && !window.confirm('Bật bảo trì sẽ tạm chặn toàn bộ người xem. Tiếp tục?')) {
      await this.loadMaintenance();
      return;
    }
    toggle.disabled = save.disabled = true;
    status.textContent = enabled ? 'Đang đóng phòng chiếu…' : 'Đang mở lại ứng dụng…';
    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'POST', cache: 'no-store',
        headers: { ...this.getAdminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, message, durationMinutes }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.message || 'Không lưu được chế độ bảo trì.');
      this.renderMaintenance(result.maintenance);
      status.textContent = result.message || (enabled ? 'Đã bật bảo trì.' : 'Đã mở lại ứng dụng.');
    } catch (error) {
      status.textContent = error.message || 'Không lưu được chế độ bảo trì.';
      await this.loadMaintenance();
    } finally {
      toggle.disabled = save.disabled = false;
    }
  },

  async open(tab = 'keys') {
    // Server responses set isAdmin only after the master key and administrator
    // identity have both been verified. Keep the private identity off-device.
    if (window.Auth?.activeKeyData?.isAdmin !== true) {
      alert('Truy cập bị từ chối: chỉ tài khoản quản trị đã được máy chủ xác thực mới được mở Panel Quản trị.');
      return;
    }

    document.getElementById('adminModal').classList.remove('hidden');
    void this.loadAccessPolicy();
    const version = document.getElementById('adminBuildVersion');
    if (version) version.textContent = `Phiên bản giao diện ${API.getVersion()}`;
    return this.showTab(tab);
  },

  showTab(tab) {
    if (!['keys', 'users', 'downloads', 'content', 'logs'].includes(tab)) return;
    const result = this.switchTab(tab);
    const content = document.getElementById(`adminTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    if (tab === 'logs') content?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else document.querySelector('.admin-dialog').scrollTop = 0;
    return result;
  },

  close() {
    this.stopLogAutoRefresh();
    document.getElementById('adminModal').classList.add('hidden');
  },

  switchTab(tab) {
    this.currentTab = tab;
    this.stopLogAutoRefresh();

    // Tabs navigation buttons
    ['keys', 'users', 'downloads', 'content', 'logs'].forEach(t => {
      const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
      const content = document.getElementById(`adminTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (btn) btn.classList.toggle('active', t === tab);
      if (content) content.classList.toggle('hidden', t !== tab);
    });

    if (tab === 'keys') {
      this.loadKeys();
      this.loadDeviceRequests();
    }
    if (tab === 'users') this.loadUsers();
    if (tab === 'downloads') return Promise.all([this.loadDownloadsConfig(), this.loadAccessPolicy()]);
    if (tab === 'content') return Promise.all([this.loadContentStatus(), this.loadAnnouncementEditor()]);
    if (tab === 'logs') {
      const loading = this.loadLogs();
      this.startLogAutoRefresh();
      return loading;
    }
  },

  generateRandomKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let p1 = '', p2 = '';
    for (let i = 0; i < 4; i++) p1 += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) p2 += chars.charAt(Math.floor(Math.random() * chars.length));
    const generated = `P4K-${p1}-${p2}`;
    document.getElementById('newKeyInput').value = generated;
  },

  async loadDeviceRequests() {
    const container = document.getElementById('deviceRequestsList');
    if (!container) return;
    container.innerHTML = '<p class="admin-desc">Đang tải yêu cầu thiết bị…</p>';
    try {
      const response = await fetch('/api/admin/device-access-requests', { headers: this.getAdminHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      container.innerHTML = '';
      if (!requests.length) {
        container.innerHTML = '<p class="admin-desc">Chưa có yêu cầu nào.</p>';
        return;
      }
      requests.forEach((request) => {
        const card = document.createElement('div');
        card.className = `device-request-card status-${request.status || 'pending'}`;
        const info = document.createElement('div');
        info.className = 'device-request-info';
        const key = document.createElement('strong');
        key.textContent = request.license_key || '-';
        const device = document.createElement('code');
        device.textContent = request.device_id || '-';
        const meta = document.createElement('span');
        meta.textContent = `${request.plan || 'VIP'} · ${request.status === 'approved' ? 'Đã duyệt' : request.status === 'rejected' ? 'Đã từ chối' : 'Đang chờ'}`;
        info.append(key, device, meta);
        card.appendChild(info);
        if (request.status === 'pending') {
          const actions = document.createElement('div');
          actions.className = 'device-request-actions';
          const approve = document.createElement('button');
          approve.type = 'button';
          approve.className = 'btn-action-mini btn-unban';
          approve.textContent = 'Duyệt máy';
          approve.onclick = () => this.decideDeviceRequest(request.license_key, request.device_id, 'approve');
          const reject = document.createElement('button');
          reject.type = 'button';
          reject.className = 'btn-action-mini btn-delete';
          reject.textContent = 'Từ chối';
          reject.onclick = () => this.decideDeviceRequest(request.license_key, request.device_id, 'reject');
          actions.append(approve, reject);
          card.appendChild(actions);
        }
        container.appendChild(card);
      });
    } catch (error) {
      container.innerHTML = '';
      const message = document.createElement('p');
      message.className = 'gate-message error';
      message.textContent = `Không tải được yêu cầu thiết bị: ${error.message}`;
      container.appendChild(message);
    }
  },

  async decideDeviceRequest(key, deviceId, decision) {
    try {
      const response = await fetch('/api/admin/device-access-decision', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key, deviceId, decision })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      await Promise.all([this.loadDeviceRequests(), this.loadKeys()]);
    } catch (error) {
      alert(`Không thể xử lý yêu cầu: ${error.message}`);
    }
  },

  getAdminHeaders() {
    return { 'Content-Type': 'application/json' };
  },

  async rotateMasterKey(event) {
    event.preventDefault();
    const input = document.getElementById('adminNewMasterKey');
    const alertEl = document.getElementById('adminMasterKeyAlert');
    const newKey = String(input?.value || '').trim().toUpperCase();

    if (!/^[A-Z0-9][A-Z0-9-]{11,63}$/.test(newKey)) {
      alertEl.textContent = 'Key Admin mới phải dài 12–64 ký tự, chỉ gồm A–Z, số hoặc dấu gạch ngang.';
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
      return;
    }
    if (!confirm('Đổi key Admin? Key cũ sẽ bị vô hiệu ngay sau khi đổi.')) return;

    try {
      const res = await fetch('/api/admin/rotate-master-key', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ newKey })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);

      input.value = '';
      await SessionVault.clear();
      alertEl.textContent = 'Đã đổi key Admin và thu hồi phiên cũ. Hãy đăng nhập lại bằng key mới.';
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');
      window.setTimeout(() => {
        this.close();
        Auth.clearStoredSession();
        Auth.triggerLock('Key Admin đã đổi. Hãy đăng nhập lại bằng key mới.');
      }, 700);
    } catch (error) {
      alertEl.textContent = `Không thể đổi key: ${error.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  },

  // ====================================================
  // 1. KEYS MANAGEMENT
  // ====================================================
  async loadKeys() {
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Đang tải danh sách key từ cơ sở dữ liệu...</td></tr>';

    try {
      const res = await fetch('/api/admin/keys', {
        headers: this.getAdminHeaders()
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this.renderStats(data.stats);
      this.renderKeysTable(data.keys);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #f87171; padding: 20px;">Lỗi tải dữ liệu. Xác thực Admin không thành công!</td></tr>';
    }
  },

  renderStats(stats = {}) {
    document.getElementById('statTotalKeys').textContent = stats.totalKeys || 0;
    document.getElementById('statActiveKeys').textContent = stats.activeKeys || 0;
    document.getElementById('statBoundDevices').textContent = stats.boundDevices || 0;
    const banEl = document.getElementById('statBannedUsers');
    if (banEl) banEl.textContent = stats.bannedUsersCount || 0;
    const ddosEl = document.getElementById('statDdosBlocked');
    if (ddosEl) ddosEl.textContent = stats.ddosBlockedCount || 0;
  },

  renderKeysTable(keys = []) {
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = '';

    if (keys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Chưa có key nào.</td></tr>';
      return;
    }

    keys.forEach(k => {
      const tr = document.createElement('tr');

      let expText = 'Vĩnh viễn';
      if (k.expiresAt) {
        const d = new Date(k.expiresAt);
        expText = `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
      }

      let statusBadge = '<span class="badge-status status-active">Hoạt động</span>';
      if (!k.active) {
        statusBadge = '<span class="badge-status status-locked">Đã khóa</span>';
      } else if (k.isExpired) {
        statusBadge = '<span class="badge-status status-expired">Hết hạn</span>';
      }

      let deviceBadge = '<span class="badge-device-unbound">Chưa gán</span>';
      if (k.boundDeviceId) {
        const shortId = k.boundDeviceId.substring(0, 8);
        deviceBadge = `<span class="badge-device-bound" title="Device: ${k.boundDeviceId}">🔒 ${shortId}...</span>`;
      }

      let teleBadge = '<span class="badge-tele-unbound">Chưa kích hoạt</span>';
      if (k.boundTelegramId) {
        teleBadge = `<a href="https://t.me/${k.boundTelegramId}" target="_blank" class="badge-tele-bound">✈️ ${k.boundTelegramId}</a>`;
      }

      const isMasterKey = Boolean(k.isAdmin);

      tr.innerHTML = `
        <td>
          <div class="key-cell">
            <strong class="key-code-text">${k.key}</strong>
            <button class="btn-copy-mini" onclick="Admin.copyKey('${k.key}')" title="Sao chép key">📋</button>
            ${isMasterKey ? '<span class="badge-admin-tag">ADMIN MASTER</span>' : ''}
          </div>
        </td>
        <td>${teleBadge}</td>
        <td>${k.plan || 'VIP'}</td>
        <td class="${k.isExpired ? 'text-expired' : ''}">${expText}</td>
        <td>${deviceBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-buttons-cell">
            ${!isMasterKey ? `
              <button class="btn-action-mini btn-time" onclick="Admin.openEditExpiryModal('${k.key}', '${k.expiresAt || ''}')" title="Chỉnh sửa ngày giờ hết hạn hoặc chuyển VIP vĩnh viễn">🕒 Sửa Hạn</button>
              <button class="btn-action-mini btn-renew" onclick="Admin.promptRenew('${k.key}')" title="Gia hạn thêm ngày">➕ Hạn</button>
              ${k.boundDeviceId ? `<button class="btn-action-mini btn-reset" onclick="Admin.resetDevice('${k.key}')" title="Gỡ thiết bị để khách đổi máy mới">🔓 Đổi Máy</button>` : ''}
              <button class="btn-action-mini btn-reset-tele" onclick="Admin.promptResetTelegram('${k.key}')" title="Đổi / Gỡ Telegram ID">✈️ Tele</button>
              <button class="btn-action-mini ${k.active ? 'btn-lock' : 'btn-unlock'}" onclick="Admin.toggleKey('${k.key}')">
                ${k.active ? '🔒 Khóa' : '✔ Mở'}
              </button>
              <button class="btn-action-mini btn-delete" onclick="Admin.deleteKey('${k.key}')" title="Xóa key">🗑</button>
            ` : '<span style="color: var(--accent-gold); font-size: 11px; font-weight: bold;">👑 Master Admin (@mnhutdznecon)</span>'}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  },

  async handleCreateKey(e) {
    e.preventDefault();
    const keyInput = document.getElementById('newKeyInput');
    const teleInput = document.getElementById('newKeyTelegram');
    const durationInput = document.getElementById('newKeyDuration');
    const planInput = document.getElementById('newKeyPlan');
    const alertEl = document.getElementById('adminFormAlert');

    const key = keyInput.value.trim();
    const assignedTelegramId = teleInput ? teleInput.value.trim() : '';
    const durationDays = parseInt(durationInput.value, 10);
    const plan = planInput.value.trim();

    if (!key) return;

    try {
      const res = await fetch('/api/admin/create-key', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key, plan, durationDays, assignedTelegramId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi tạo key');

      alertEl.textContent = `✔ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');

      keyInput.value = '';
      if (teleInput) teleInput.value = '';
      planInput.value = '';
      this.loadKeys();

      setTimeout(() => alertEl.classList.add('hidden'), 3000);
    } catch (err) {
      alertEl.textContent = `❌ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  },

  async promptRenew(key) {
    const days = prompt(`Nhập số ngày muốn gia hạn thêm cho key [${key}]:`, '30');
    if (!days) return;
    const numDays = parseInt(days, 10);
    if (isNaN(numDays) || numDays <= 0) {
      alert('Số ngày không hợp lệ!');
      return;
    }

    try {
      const res = await fetch('/api/admin/renew-key', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key, addDays: numDays })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi gia hạn');
      alert(`✔ ${data.message}`);
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  async resetDevice(key) {
    if (!confirm(`Bạn có muốn xóa thiết bị đã khóa cho key [${key}] không?\nKhách hàng sẽ có thể đăng nhập trên máy mới.`)) return;

    try {
      const res = await fetch('/api/admin/reset-device', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi reset');
      alert(`✔ ${data.message}`);
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  async promptResetTelegram(key) {
    const newTele = prompt(`Nhập Telegram ID mới muốn gán cho key [${key}] (Để trống nếu muốn gỡ bỏ):`, '');
    if (newTele === null) return;

    try {
      const res = await fetch('/api/admin/reset-telegram', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key, newTelegramId: newTele.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi cập nhật');
      alert(`✔ ${data.message}`);
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  async toggleKey(key) {
    try {
      const res = await fetch('/api/admin/toggle-key', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi đổi trạng thái');
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  async deleteKey(key) {
    if (!confirm(`CẢNH BÁO: Bạn có chắc chắn muốn xóa vĩnh viễn key [${key}] không?`)) return;

    try {
      const res = await fetch('/api/admin/delete-key', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi xóa');
      alert(`✔ ${data.message}`);
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  copyKey(key) {
    navigator.clipboard.writeText(key).then(() => {
      alert(`📋 Đã sao chép key [${key}] vào bộ nhớ tạm!`);
    }).catch(() => {
      prompt('Mã key của bạn:', key);
    });
  },

  // ====================================================
  // 2. USER MANAGEMENT & BAN/UNBAN
  // ====================================================
  async loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Đang tải danh sách người dùng...</td></tr>';

    try {
      const res = await fetch('/api/admin/users', {
        headers: this.getAdminHeaders()
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this.renderUsersTable(data.users || []);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #f87171; padding: 20px;">Lỗi tải danh sách người dùng!</td></tr>';
    }
  },

  // The replacement account table uses DOM nodes instead of interpolating
  // account data into inline HTML. This keeps user-controlled values out of
  // event handlers and makes the stronger ban actions explicit.
  renderUsersTable(users = []) {
    const tbody = document.getElementById('usersTableBody');
    tbody.replaceChildren();
    if (!users.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'Chưa có tài khoản nào được ghi nhận.';
      cell.style.cssText = 'text-align:center;color:var(--text-dim);padding:20px;';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    const makeCell = (text, code = false) => {
      const cell = document.createElement('td');
      const value = document.createElement(code ? 'code' : 'span');
      value.textContent = text || '—';
      cell.appendChild(value);
      return cell;
    };
    const makeButton = (label, className, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn-action-mini ${className}`;
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };

    users.forEach(user => {
      const row = document.createElement('tr');
      const key = String(user.key || '');
      const deviceId = String(user.boundDeviceId || '');
      row.appendChild(makeCell(deviceId || 'Chưa gắn thiết bị', true));
      row.appendChild(makeCell(key, true));
      row.appendChild(makeCell(user.plan || 'VIP'));
      row.appendChild(makeCell(user.expiresAt ? new Date(user.expiresAt).toLocaleDateString('vi-VN') : 'Vĩnh viễn'));
      row.appendChild(makeCell(user.telegramId || 'Không sử dụng'));

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge-status ${user.isBanned ? 'status-banned' : 'status-active'}`;
      badge.textContent = user.isBanned ? 'Đã bị ban' : (user.status || 'Bình thường');
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const actionCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'action-buttons-cell';
      if (user.isBanned) {
        actions.appendChild(makeButton('Mở ban', 'btn-unban', () => this.unbanUser(key, deviceId)));
      } else {
        actions.appendChild(makeButton('Ban user', 'btn-ban', () => this.banUser(key, deviceId)));
      }
      actions.appendChild(makeButton('Nhật ký', 'btn-time', () => this.viewAccountLogs(deviceId || key)));
      actionCell.appendChild(actions);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  },

  async banUser(key, deviceId = '') {
    const reason = prompt(`Lý do ban user dùng key [${key}]:`, 'Vi phạm điều khoản sử dụng');
    if (reason === null) return;
    if (!confirm(`Xác nhận ban user này? Key sẽ bị khóa ngay trên thiết bị đang dùng.`)) return;
    try {
      const res = await fetch('/api/admin/ban-user', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key, deviceId, reason: reason.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể cấm tài khoản');
      alert(`✔ ${data.message}`);
      await Promise.all([this.loadUsers(), this.loadKeys()]);
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  },

  async unbanUser(key, deviceId = '') {
    if (!confirm(`Mở ban cho user dùng key [${key}]?`)) return;
    try {
      const res = await fetch('/api/admin/unban-user', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key, deviceId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể gỡ lệnh cấm');
      alert(`✔ ${data.message}`);
      await Promise.all([this.loadUsers(), this.loadKeys()]);
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  },

  viewAccountLogs(telegramId) {
    this.logAccountFilter = telegramId;
    const filter = document.getElementById('logAccountFilter');
    if (filter) filter.value = telegramId;
    this.switchTab('logs');
  },

  applyLogFilter() {
    const filter = document.getElementById('logAccountFilter');
    this.logAccountFilter = filter ? filter.value.trim() : '';
    this.logTypeFilter = document.getElementById('logTypeFilter')?.value || 'ALL';
    this.loadLogs();
  },

  clearLogFilter() {
    this.logAccountFilter = '';
    const filter = document.getElementById('logAccountFilter');
    if (filter) filter.value = '';
    const type = document.getElementById('logTypeFilter');
    if (type) type.value = 'ALL';
    this.logTypeFilter = 'ALL';
    this.loadLogs();
  },

  startLogAutoRefresh() {
    this.stopLogAutoRefresh();
    this.logRefreshTimer = window.setInterval(() => {
      if (this.currentTab === 'logs' && !document.hidden) this.loadLogs();
    }, 20000);
  },

  stopLogAutoRefresh() {
    if (this.logRefreshTimer) window.clearInterval(this.logRefreshTimer);
    this.logRefreshTimer = null;
  },

  // ====================================================
  // 3. LIVE AUDIT LOGS (CYBER CONSOLE)
  // ====================================================
  async loadLogs({ append = false } = {}) {
    const container = document.getElementById('terminalLogsBody');
    if (!container) return;
    if (this.logLoading) return;
    this.logLoading = true;
    const more = document.getElementById('logsLoadMoreBtn');
    if (more) more.disabled = true;
    if (!append) container.innerHTML = '<div class="log-line log-dim">Đang tải nhật ký người dùng…</div>';
    const filter = this.logAccountFilter || document.getElementById('logAccountFilter')?.value.trim() || '';
    const type = this.logTypeFilter || document.getElementById('logTypeFilter')?.value || 'ALL';
    const query = new URLSearchParams({ limit: '100', type });
    if (filter) query.set('identity', filter);
    if (append && this.logCursor) query.set('before', String(this.logCursor));
    const liveState = document.getElementById('logLiveState');
    if (liveState) liveState.textContent = '● ĐANG ĐỒNG BỘ';

    try {
      const res = await fetch(`/api/admin/logs?${query.toString()}`, {
        headers: this.getAdminHeaders()
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const incoming = data.logs || [];
      this.loadedLogs = append ? [...this.loadedLogs, ...incoming] : incoming;
      this.logCursor = data.nextCursor || null;
      this.renderLogs(this.loadedLogs);
      if (more) more.classList.toggle('hidden', !data.hasMore);
      if (liveState) liveState.textContent = '● LIVE';
    } catch (err) {
      if (!append) {
        container.innerHTML = '';
        const errorLine = document.createElement('div');
        errorLine.className = 'log-line log-err';
        errorLine.textContent = `Không tải được nhật ký: ${err.message}`;
        container.appendChild(errorLine);
      }
      if (liveState) liveState.textContent = '● MẤT KẾT NỐI';
    } finally {
      this.logLoading = false;
      if (more) more.disabled = false;
    }
  },

  loadMoreLogs() {
    if (this.logCursor) return this.loadLogs({ append: true });
  },

  // ====================================================
  // 4. LIVE MOVIE FEED & POSTER MANAGEMENT
  // ====================================================
  async loadContentStatus() {
    const sourceEl = document.getElementById('contentSourceStatus');
    const refreshEl = document.getElementById('contentLastRefresh');
    const cacheEl = document.getElementById('contentCacheStatus');
    const adsEl = document.getElementById('contentAdsStatus');
    const providerList = document.getElementById('contentProviderList');
    if (!sourceEl || !refreshEl || !cacheEl) return;

    sourceEl.textContent = 'Đang kiểm tra…';
    try {
      const res = await fetch('/api/admin/content-status', { headers: this.getAdminHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      sourceEl.textContent = `${data.source || 'Nguồn phim'} · ${data.status === 'READY' ? 'hoạt động' : 'cần kiểm tra'}`;
      refreshEl.textContent = data.lastSuccessfulRefreshAt
        ? new Date(data.lastSuccessfulRefreshAt).toLocaleString('vi-VN')
        : 'Chưa có lượt tải mới';
      cacheEl.textContent = data.cacheActive
        ? `Edge cache ${data.cacheTtlSeconds || 0} giây`
        : 'Không dùng cache';
      if (adsEl) adsEl.textContent = data.ads?.sdkEmbedded ? 'Có SDK quảng cáo' : 'Không nhúng SDK quảng cáo';
      if (providerList) {
        providerList.replaceChildren();
        (data.providers || []).forEach((provider) => {
          const card = document.createElement('article');
          card.className = `content-provider-card status-${String(provider.status || 'unknown').toLowerCase()}`;
          const copy = document.createElement('div');
          const title = document.createElement('strong');
          title.textContent = provider.label || provider.id || 'Nguồn nội dung';
          const description = document.createElement('span');
          description.textContent = provider.purpose || '';
          copy.append(title, description);
          const badge = document.createElement('b');
          badge.textContent = ({ READY: 'Sẵn sàng', NEEDS_CONFIGURATION: 'Chưa cấu hình', UNREACHABLE: 'Mất kết nối', EMPTY: 'Trống' })[provider.status] || provider.status || 'Chưa rõ';
          card.append(copy, badge);
          providerList.appendChild(card);
        });
      }
    } catch (err) {
      sourceEl.textContent = 'Không đọc được trạng thái';
      refreshEl.textContent = '—';
      cacheEl.textContent = '—';
      if (adsEl) adsEl.textContent = '—';
      if (providerList) providerList.replaceChildren();
    }
  },

  async refreshMovies() {
    const button = document.getElementById('adminRefreshMoviesBtn');
    const alertEl = document.getElementById('adminContentAlert');
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang làm mới…';
    }

    try {
      const res = await fetch('/api/admin/refresh-movies', {
        method: 'POST',
        headers: this.getAdminHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      alertEl.textContent = `✓ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');
      window.API?.clearMovieCache?.();
      if (window.App) await App.loadHomeFeed({ silent: true });
      await this.loadContentStatus();
    } catch (err) {
      alertEl.textContent = `✕ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '🔄 Làm mới ngay';
      }
    }
  },

  setAnnouncementAlert(message, success = true) {
    const alertEl = document.getElementById('announcementAdminAlert');
    if (!alertEl) return;
    alertEl.textContent = message;
    alertEl.className = `gate-message ${success ? 'success' : 'error'}`;
    alertEl.classList.remove('hidden');
  },

  async loadAnnouncementEditor() {
    const state = document.getElementById('announcementAdminState');
    if (state) state.textContent = 'Đang kiểm tra…';
    try {
      const data = await window.API.getAnnouncement();
      if (!data.active) {
        if (state) state.textContent = 'Chưa có thông báo';
        return;
      }
      const title = document.getElementById('announcementTitleInput');
      const message = document.getElementById('announcementMessageInput');
      if (title) title.value = data.title || 'Thông báo từ Admin';
      if (message) message.value = data.message || '';
      if (state) state.textContent = `Đang ghim đến ${new Date(data.expiresAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`;
    } catch (_error) {
      if (state) state.textContent = 'Không đọc được trạng thái';
    }
  },

  async publishAnnouncement() {
    const button = document.getElementById('announcementPublishBtn');
    const title = document.getElementById('announcementTitleInput')?.value.trim() || 'Thông báo từ Admin';
    const message = document.getElementById('announcementMessageInput')?.value.trim() || '';
    const duration = Number.parseInt(document.getElementById('announcementDurationInput')?.value || '0', 10);
    const unit = Number.parseInt(document.getElementById('announcementDurationUnit')?.value || '1', 10);
    const durationMinutes = duration * unit;
    if (!message) {
      this.setAnnouncementAlert('Hãy nhập nội dung thông báo.', false);
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) {
      this.setAnnouncementAlert('Thời lượng phải từ 1 phút đến 30 ngày.', false);
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Đang gửi…';
    }
    try {
      const response = await fetch('/api/admin/announcement', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ action: 'publish', title, message, durationMinutes })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      this.setAnnouncementAlert(`✓ ${data.message}`);
      window.App?.renderAnnouncement?.(data.announcement);
      await this.loadAnnouncementEditor();
    } catch (error) {
      this.setAnnouncementAlert(`Không gửi được: ${error.message}`, false);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '📣 Gửi và ghim thông báo';
      }
    }
  },

  async clearAnnouncement() {
    if (!confirm('Gỡ thông báo đang ghim khỏi tất cả thiết bị?')) return;
    const button = document.getElementById('announcementClearBtn');
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/admin/announcement', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ action: 'clear' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      this.setAnnouncementAlert(`✓ ${data.message}`);
      window.App?.renderAnnouncement?.({ active: false });
      await this.loadAnnouncementEditor();
    } catch (error) {
      this.setAnnouncementAlert(`Không gỡ được: ${error.message}`, false);
    } finally {
      if (button) button.disabled = false;
    }
  },

  renderLogs(logs = []) {
    const container = document.getElementById('terminalLogsBody');
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = '<div class="log-line log-dim">[System] Nhật ký hệ thống trống.</div>';
      ['logLoadedCount', 'logViewerCount', 'logUserCount', 'logErrorCount', 'logSessionCount'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.textContent = '0';
      });
      document.getElementById('logWatchTime').textContent = '0 phút';
      document.getElementById('logLatestMovie').textContent = '—';
      document.getElementById('logLastSeen').textContent = '—';
      return;
    }

    const actionNames = {
      usage_heartbeat: 'Đang hoạt động', usage_app_visibility: 'Ẩn / mở lại app', usage_network_change: 'Đổi trạng thái mạng', usage_client_error: 'Lỗi giao diện', usage_download_open: 'Mở link tải',
      usage_app_open: 'Mở ứng dụng', usage_tab_view: 'Chuyển tab', usage_category_view: 'Mở danh mục',
      usage_filter_applied: 'Dùng bộ lọc', usage_search: 'Tìm kiếm', usage_movie_open: 'Mở phim',
      usage_episode_open: 'Chọn tập', usage_playback_start: 'Bắt đầu xem', usage_playback_ready: 'Luồng sẵn sàng',
      usage_playback_stop: 'Dừng xem', usage_playback_complete: 'Xem hết tập', usage_playback_error: 'Lỗi phát', usage_server_change: 'Đổi server',
      license_activated: 'Kích hoạt key', device_access_requested: 'Yêu cầu duyệt thiết bị',
      device_access_approved: 'Duyệt thiết bị', device_access_rejected: 'Từ chối thiết bị',
      user_banned: 'Ban người dùng', user_unbanned: 'Mở ban người dùng'
    };
    const contextLabels = {
      movie: 'Phim', episode: 'Tập', tab: 'Tab', category: 'Danh mục', genre: 'Thể loại',
      country: 'Quốc gia', query: 'Từ khóa', results: 'Kết quả', server: 'Server', quality: 'Chất lượng',
      seconds: 'Vị trí', duration: 'Thời lượng', watched: 'Đã xem', error: 'Lỗi', entry: 'Cách vào', version: 'Phiên bản',
      session: 'Phiên', runtime: 'Nền tảng', screen: 'Màn hình', language: 'Ngôn ngữ', network: 'Mạng',
      viewport: 'Vùng hiển thị', visibility: 'Hiển thị', uptime: 'Thời gian mở (giây)', buffered: 'Đệm (giây)', readyState: 'Trạng thái video', eventAt: 'Giờ thiết bị', device: 'Thiết bị (đã che)', os: 'Hệ điều hành', browser: 'Trình duyệt'
    };

    logs.forEach(l => {
      const line = document.createElement('div');
      line.className = 'log-line';

      const time = new Date(l.timestamp).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });
      
      let typeClass = 'log-tag-info';
      if (l.type === 'ADMIN') typeClass = 'log-tag-admin';
      if (l.type === 'BAN') typeClass = 'log-tag-ban';
      if (l.type === 'DDOS') typeClass = 'log-tag-ddos';
      if (l.type === 'AUTH') typeClass = 'log-tag-auth';
      if (l.type === 'USER') typeClass = 'log-tag-user';
      if (l.type === 'SECURITY') typeClass = 'log-tag-ddos';

      const append = (className, value) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = value;
        line.appendChild(span);
      };
      append('log-time', time);
      append(`log-tag ${typeClass}`, `[${l.type || 'INFO'}]`);
      append('log-action', `${actionNames[l.action] || l.action || 'Sự kiện'}:`);
      const context = l.context && typeof l.context === 'object' ? l.context : {};
      const details = Object.entries(context)
        .filter(([key]) => key !== 'device')
        .map(([key, value]) => `${contextLabels[key] || key}: ${value}`)
        .join(' · ');
      append('log-text', details || l.details || 'Không có chi tiết');
      if (l.account?.telegramId) append('log-account', `TG:${l.account.telegramId}`);
      if (l.account?.deviceHash) append('log-account', `DEV:${l.account.deviceHash}`);

      container.appendChild(line);
    });

    document.getElementById('logLoadedCount').textContent = String(logs.length);
    document.getElementById('logViewerCount').textContent = String(logs.filter((log) => log.type === 'USER').length);
    document.getElementById('logUserCount').textContent = String(new Set(logs.map((log) => log.account?.telegramId).filter(Boolean)).size);
    document.getElementById('logErrorCount').textContent = String(logs.filter((log) => log.action === 'usage_playback_error').length);
    document.getElementById('logSessionCount').textContent = String(new Set(logs.map((log) => log.context?.session).filter(Boolean)).size);
    const watchedSeconds = logs.reduce((sum, log) => sum + (Number(log.context?.watched) || 0), 0);
    document.getElementById('logWatchTime').textContent = watchedSeconds >= 3600
      ? `${(watchedSeconds / 3600).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`
      : `${Math.round(watchedSeconds / 60)} phút`;
    const latestMovie = logs.find((log) => log.context?.movie)?.context?.movie || '—';
    document.getElementById('logLatestMovie').textContent = latestMovie;
    const latestTimestamp = logs[0]?.timestamp;
    document.getElementById('logLastSeen').textContent = latestTimestamp
      ? new Date(latestTimestamp).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
  },

  async clearLogs() {
    if (!confirm('Bạn có chắc chắn muốn xóa sạch toàn bộ nhật ký hệ thống không?')) return;

    try {
      const res = await fetch('/api/admin/logs', {
        method: 'DELETE',
        headers: this.getAdminHeaders()
      });

      const data = await res.json();
      alert(`✔ ${data.message}`);
      this.loadLogs();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  // ====================================================
  // 5. EDIT KEY EXPIRY MODAL METHODS
  // ====================================================
  editingKey: null,
  currentExpiry: null,

  openEditExpiryModal(key, currentExpiry) {
    this.editingKey = key;
    this.currentExpiry = currentExpiry;

    document.getElementById('editExpiryKeyTitle').textContent = key;
    const infoText = document.getElementById('editExpiryCurrentText');
    const dateInput = document.getElementById('editExpiryDatetimeInput');
    const alertEl = document.getElementById('editExpiryAlert');

    alertEl.classList.add('hidden');

    if (currentExpiry) {
      const d = new Date(currentExpiry);
      infoText.textContent = `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN')}`;
      
      // Format to YYYY-MM-DDTHH:MM for datetime-local
      const pad = n => n < 10 ? '0' + n : n;
      const localIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      dateInput.value = localIso;
    } else {
      infoText.textContent = 'Vĩnh Viễn (Không Thời Hạn)';
      dateInput.value = '';
    }

    document.getElementById('editKeyExpiryModal').classList.remove('hidden');
  },

  async setExpiryQuickDays(days) {
    if (!this.editingKey) return;
    const alertEl = document.getElementById('editExpiryAlert');

    try {
      const res = await fetch('/api/admin/set-key-expiry', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key: this.editingKey, addDays: days })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi cập nhật');

      alertEl.textContent = `✔ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');

      this.loadKeys();
      setTimeout(() => hideEditExpiryModal(), 1200);
    } catch (err) {
      alertEl.textContent = `❌ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  },

  async setExpiryLifetime() {
    if (!this.editingKey) return;
    const alertEl = document.getElementById('editExpiryAlert');

    try {
      const res = await fetch('/api/admin/set-key-expiry', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key: this.editingKey, isLifetime: true })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi cập nhật');

      alertEl.textContent = `✔ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');

      this.loadKeys();
      setTimeout(() => hideEditExpiryModal(), 1200);
    } catch (err) {
      alertEl.textContent = `❌ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  },

  async submitEditExpiry() {
    if (!this.editingKey) return;
    const dateInput = document.getElementById('editExpiryDatetimeInput');
    const alertEl = document.getElementById('editExpiryAlert');

    if (!dateInput.value) {
      alertEl.textContent = 'Vui lòng chọn ngày giờ hết hạn!';
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
      return;
    }

    try {
      const res = await fetch('/api/admin/set-key-expiry', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ key: this.editingKey, expiresAt: dateInput.value })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi cập nhật');

      alertEl.textContent = `✔ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');

      this.loadKeys();
      setTimeout(() => hideEditExpiryModal(), 1200);
    } catch (err) {
      alertEl.textContent = `❌ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  },

  // ====================================================
  // 6. APP DOWNLOADS LINKS MANAGEMENT
  // ====================================================
  async loadDownloadsConfig() {
    try {
      const res = await fetch('/api/app/downloads');
      const data = await res.json();

      for (const [platform, id] of [['android', 'Apk'], ['ios', 'Ipa'], ['windows', 'Exe'], ['android_tv', 'Tv']]) {
        const entry = Phim4KPlatform.release(data, platform);
        const input = document.getElementById('adminDownload' + id + 'Input');
        const version = document.getElementById('adminVersion' + id + 'Input');
        const sha256 = document.getElementById('adminSha256' + id + 'Input');
        const size = document.getElementById('adminSize' + id + 'Input');
        if (input) { input.value = entry.url; input.required = false; }
        if (version) { version.value = entry.version; version.required = false; }
        if (sha256) sha256.value = entry.sha256 || '';
        if (size) size.value = entry.sizeBytes || '';
      }

      // Populate Force Update section
      if (data.forceUpdate) {
        const toggle = document.getElementById('adminForceUpdateToggle');
        const statusText = document.getElementById('adminForceUpdateStatusText');
        const minVer = document.getElementById('adminMinVersionInput');
        const latestVer = document.getElementById('adminLatestVersionInput');
        const msgInput = document.getElementById('adminForceUpdateMessage');

        if (toggle) toggle.checked = !!data.forceUpdate.enabled;
        if (statusText) {
          statusText.textContent = data.forceUpdate.enabled ? 'ĐANG BẬT (ĐÃ CHẶN)' : 'ĐANG TẮT';
          statusText.style.color = data.forceUpdate.enabled ? '#10b981' : '#f87171';
        }
        if (minVer) minVer.value = data.forceUpdate.minVersion || '3.0.0';
        if (latestVer) latestVer.value = data.forceUpdate.latestVersion || '3.0.0';
        if (msgInput) msgInput.value = data.forceUpdate.message || 'Phiên bản của bạn đã cũ, vui lòng cập nhật lên bản mới nhất!';
      }
    } catch (err) {
      console.error('Error loading downloads config:', err);
    }
  },

  toggleForceUpdateStatusText() {
    const toggle = document.getElementById('adminForceUpdateToggle');
    const statusText = document.getElementById('adminForceUpdateStatusText');
    if (!toggle || !statusText) return;
    statusText.textContent = toggle.checked ? 'ĐANG BẬT (ĐÃ CHẶN)' : 'ĐANG TẮT';
    statusText.style.color = toggle.checked ? '#10b981' : '#f87171';
  },

  async handleSetForceUpdate(e) {
    e.preventDefault();
    const alertEl = document.getElementById('adminForceUpdateAlert');

    const enabled = document.getElementById('adminForceUpdateToggle').checked;
    const minVersion = document.getElementById('adminMinVersionInput').value.trim();
    const latestVersion = document.getElementById('adminLatestVersionInput').value.trim();
    const message = document.getElementById('adminForceUpdateMessage').value.trim();

    try {
      const res = await fetch('/api/admin/set-force-update', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ enabled, minVersion, latestVersion, message })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi cập nhật');

      alertEl.textContent = `✔ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');

      this.toggleForceUpdateStatusText();

      setTimeout(() => {
        alertEl.classList.add('hidden');
      }, 4000);
    } catch (err) {
      alertEl.textContent = `❌ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  },

  async handleUpdateDownloads(e) {
    e.preventDefault();
    const alertEl = document.getElementById('adminDownloadsAlert');

    const androidUrl = document.getElementById('adminDownloadApkInput').value.trim();
    const androidVersion = document.getElementById('adminVersionApkInput').value.trim();

    const iosUrl = document.getElementById('adminDownloadIpaInput').value.trim();
    const iosVersion = document.getElementById('adminVersionIpaInput').value.trim();

    const windowsUrl = document.getElementById('adminDownloadExeInput').value.trim();
    const windowsVersion = document.getElementById('adminVersionExeInput').value.trim();

    try {
      const res = await fetch('/api/admin/update-downloads', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({
          androidUrl, androidVersion,
          androidSha256: document.getElementById('adminSha256ApkInput').value.trim(),
          androidSizeBytes: Number(document.getElementById('adminSizeApkInput').value || 0),
          iosUrl, iosVersion,
          iosSha256: document.getElementById('adminSha256IpaInput').value.trim(),
          iosSizeBytes: Number(document.getElementById('adminSizeIpaInput').value || 0),
          windowsUrl, windowsVersion,
          windowsSha256: document.getElementById('adminSha256ExeInput').value.trim(),
          windowsSizeBytes: Number(document.getElementById('adminSizeExeInput').value || 0),
          android_tvUrl: document.getElementById('adminDownloadTvInput').value.trim(),
          android_tvVersion: document.getElementById('adminVersionTvInput').value.trim(),
          android_tvSha256: document.getElementById('adminSha256TvInput').value.trim(),
          android_tvSizeBytes: Number(document.getElementById('adminSizeTvInput').value || 0)
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi cập nhật');

      alertEl.textContent = `✔ ${data.message}`;
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');

      // Refresh public modal links
      if (window.refreshPublicDownloads) {
        window.refreshPublicDownloads();
      }

      setTimeout(() => {
        alertEl.classList.add('hidden');
      }, 4000);
    } catch (err) {
      alertEl.textContent = `❌ ${err.message}`;
      alertEl.className = 'gate-message error';
      alertEl.classList.remove('hidden');
    }
  }
};

function hideAdminModal() { Admin.close(); }
function closeAdminModal(e) {
  if (e.target.id === 'adminModal') {
    hideAdminModal();
  }
}

function hideEditExpiryModal() {
  document.getElementById('editKeyExpiryModal').classList.add('hidden');
}
function closeEditExpiryModal(e) {
  if (e.target.id === 'editKeyExpiryModal') {
    hideEditExpiryModal();
  }
}

window.Admin = Admin;
