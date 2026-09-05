// Admin Panel Controller: Keys, User Ban/Unban, Anti-DDoS, and Live Audit Logs

const Admin = {
  currentTab: 'keys',

  async open() {
    const configuredAdminTelegram = '5992662564';
    if (!window.Auth?.activeKeyData?.isAdmin || String(window.Auth?.activeKeyData?.telegramId || '') !== configuredAdminTelegram) {
      alert('Truy cập bị từ chối: chỉ tài khoản quản trị đã được máy chủ xác thực mới được mở Panel Quản trị.');
      return;
    }

    document.getElementById('adminModal').classList.remove('hidden');
    this.switchTab('keys');
  },

  close() {
    document.getElementById('adminModal').classList.add('hidden');
  },

  switchTab(tab) {
    this.currentTab = tab;

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
    if (tab === 'downloads') this.loadDownloadsConfig();
    if (tab === 'content') this.loadContentStatus();
    if (tab === 'logs') this.loadLogs();
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
    return {
      'Content-Type': 'application/json',
      'x-license-key': localStorage.getItem('phim4k_key') || '',
      'x-telegram-id': localStorage.getItem('phim4k_telegram_id') || ''
    };
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

      localStorage.setItem('phim4k_key', newKey);
      if (window.Auth?.activeKeyData) window.Auth.activeKeyData.key = newKey;
      input.value = '';
      alertEl.textContent = 'Đã đổi key Admin. Chỉ Telegram ID quản trị này dùng được key mới.';
      alertEl.className = 'gate-message success';
      alertEl.classList.remove('hidden');
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

  renderUsersTable(users = []) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Chưa có người dùng nào được ghi nhận.</td></tr>';
      return;
    }

    users.forEach(u => {
      const tr = document.createElement('tr');
      const isMasterAdmin = Boolean(u.isAdmin);

      let statusBadge = u.isBanned ?
        '<span class="badge-status status-banned">🚫 Đã bị Ban</span>' :
        '<span class="badge-status status-active">Bình thường</span>';

      let actionHtml = '';
      if (isMasterAdmin) {
        actionHtml = '<span style="color: var(--accent-gold); font-size: 11px; font-weight: bold;">👑 Super Admin Master</span>';
      } else if (u.isBanned) {
        actionHtml = `<button class="btn-action-mini btn-unban" onclick="Admin.unbanUser('${u.telegramId}')">✔ Mở Ban</button>`;
      } else {
        actionHtml = `<button class="btn-action-mini btn-ban" onclick="Admin.promptBanUser('${u.telegramId}')">🚫 Ban Tài Khoản</button>`;
      }

      const deviceStr = u.boundDeviceId ? `🔒 ${u.boundDeviceId.substring(0, 10)}...` : '<span style="color: var(--text-dim);">Chưa khóa</span>';

      tr.innerHTML = `
        <td>
          <a href="https://t.me/${u.telegramId}" target="_blank" class="badge-tele-bound">
            ✈️ ${u.telegramId}
          </a>
        </td>
        <td><code>${u.key}</code></td>
        <td>${u.plan || 'VIP'}</td>
        <td>${deviceStr}</td>
        <td><code>${u.lastIp || 'Chưa ghi nhận'}</code></td>
        <td>${statusBadge}</td>
        <td>${actionHtml}</td>
      `;

      tbody.appendChild(tr);
    });
  },

  async promptBanUser(telegramId) {
    const reason = prompt(`Nhập lý do muốn Ban tài khoản Telegram [${telegramId}]:`, 'Vi phạm điều khoản sử dụng');
    if (reason === null) return;

    try {
      const res = await fetch('/api/admin/ban-user', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ telegramId, reason: reason.trim() })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi ban');

      alert(`✔ ${data.message}`);
      this.loadUsers();
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
    }
  },

  async unbanUser(telegramId) {
    if (!confirm(`Bạn có chắc chắn muốn mở khóa (Unban) cho Telegram [${telegramId}] không?`)) return;

    try {
      const res = await fetch('/api/admin/unban-user', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ telegramId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi mở ban');

      alert(`✔ ${data.message}`);
      this.loadUsers();
      this.loadKeys();
    } catch (err) {
      alert(`❌ ${err.message}`);
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
      const telegramId = String(user.telegramId || '');
      row.appendChild(makeCell(telegramId, true));
      row.appendChild(makeCell(user.key, true));
      row.appendChild(makeCell(user.plan || 'VIP'));
      row.appendChild(makeCell(user.boundDeviceId || 'Chưa bind', true));
      row.appendChild(makeCell(user.lastIp || 'Chưa ghi nhận', true));

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge-status ${user.isBanned ? 'status-banned' : 'status-active'}`;
      const scopes = (user.bans || []).flatMap(item => item.scopes || []);
      badge.textContent = user.isBanned ? `Đã cấm${scopes.length ? `: ${[...new Set(scopes)].join(', ')}` : ''}` : (user.status || 'Bình thường');
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const actionCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'action-buttons-cell';
      if (user.isAdmin) {
        actions.textContent = 'Super Admin';
        actions.style.color = 'var(--accent-gold)';
      } else if (user.isBanned) {
        actions.appendChild(makeButton('Mở ban', 'btn-unban', () => this.unbanUser(telegramId)));
      } else {
        actions.appendChild(makeButton('Ban TG', 'btn-ban', () => this.banUser(telegramId, ['telegram'])));
        if (user.boundDeviceId) {
          actions.appendChild(makeButton('TG + máy', 'btn-ban', () => this.banUser(telegramId, ['telegram', 'device'])));
        }
        if (user.boundDeviceId && user.lastIp) {
          actions.appendChild(makeButton('Ban toàn bộ', 'btn-ban', () => this.banUser(telegramId, ['telegram', 'device', 'ip'])));
        }
      }
      actions.appendChild(makeButton('Nhật ký', 'btn-time', () => this.viewAccountLogs(telegramId)));
      actionCell.appendChild(actions);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  },

  async banUser(telegramId, scopes) {
    const reason = prompt(`Lý do cấm Telegram ${telegramId}:`, 'Vi phạm điều khoản sử dụng');
    if (reason === null) return;
    const scopeLabel = scopes.join(' + ');
    if (!confirm(`Xác nhận cấm theo phạm vi: ${scopeLabel}? Key liên quan sẽ bị khoá.`)) return;
    try {
      const res = await fetch('/api/admin/ban-user', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ telegramId, scopes, reason: reason.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể cấm tài khoản');
      alert(`✔ ${data.message}`);
      await Promise.all([this.loadUsers(), this.loadKeys()]);
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  },

  async unbanUser(telegramId) {
    if (!confirm(`Gỡ toàn bộ lệnh cấm cho Telegram ${telegramId}? Key vẫn khoá cho tới khi admin chủ động mở lại.`)) return;
    try {
      const res = await fetch('/api/admin/unban-user', {
        method: 'POST',
        headers: this.getAdminHeaders(),
        body: JSON.stringify({ telegramId })
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
    this.loadLogs();
  },

  clearLogFilter() {
    this.logAccountFilter = '';
    const filter = document.getElementById('logAccountFilter');
    if (filter) filter.value = '';
    this.loadLogs();
  },

  // ====================================================
  // 3. LIVE AUDIT LOGS (CYBER CONSOLE)
  // ====================================================
  async loadLogs() {
    const container = document.getElementById('terminalLogsBody');
    container.innerHTML = '<div class="log-line">Đang tải nhật ký bảo mật...</div>';
    const filter = this.logAccountFilter || document.getElementById('logAccountFilter')?.value.trim() || '';
    const query = filter ? `?telegramId=${encodeURIComponent(filter)}&limit=300` : '?limit=300';

    try {
      const res = await fetch(`/api/admin/logs${query}`, {
        headers: this.getAdminHeaders()
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this.renderLogs(data.logs || []);
    } catch (err) {
      container.innerHTML = '<div class="log-line log-err">Lỗi tải nhật ký hệ thống!</div>';
    }
  },

  // ====================================================
  // 4. LIVE MOVIE FEED & POSTER MANAGEMENT
  // ====================================================
  async loadContentStatus() {
    const sourceEl = document.getElementById('contentSourceStatus');
    const refreshEl = document.getElementById('contentLastRefresh');
    const cacheEl = document.getElementById('contentCacheStatus');
    if (!sourceEl || !refreshEl || !cacheEl) return;

    sourceEl.textContent = 'Đang kiểm tra…';
    try {
      const res = await fetch('/api/admin/content-status', { headers: this.getAdminHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      sourceEl.textContent = `${data.source || 'Nguồn phim'} · hoạt động`;
      refreshEl.textContent = data.lastSuccessfulRefreshAt
        ? new Date(data.lastSuccessfulRefreshAt).toLocaleString('vi-VN')
        : 'Chưa có lượt tải mới';
      cacheEl.textContent = data.cacheActive
        ? `Đang dùng đến ${new Date(data.cacheExpiresAt).toLocaleTimeString('vi-VN')}`
        : 'Trống — lượt tải tiếp theo sẽ lấy mới';
    } catch (err) {
      sourceEl.textContent = 'Không đọc được trạng thái';
      refreshEl.textContent = '—';
      cacheEl.textContent = '—';
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

  renderLogs(logs = []) {
    const container = document.getElementById('terminalLogsBody');
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = '<div class="log-line log-dim">[System] Nhật ký hệ thống trống.</div>';
      return;
    }

    logs.forEach(l => {
      const line = document.createElement('div');
      line.className = 'log-line';

      const time = new Date(l.timestamp).toLocaleTimeString('vi-VN');
      
      let typeClass = 'log-tag-info';
      if (l.type === 'ADMIN') typeClass = 'log-tag-admin';
      if (l.type === 'BAN') typeClass = 'log-tag-ban';
      if (l.type === 'DDOS') typeClass = 'log-tag-ddos';
      if (l.type === 'AUTH') typeClass = 'log-tag-auth';

      const append = (className, value) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = value;
        line.appendChild(span);
      };
      append('log-time', time);
      append(`log-tag ${typeClass}`, `[${l.type || 'INFO'}]`);
      append('log-action', `${l.action || 'EVENT'}:`);
      append('log-text', l.details || 'Không có chi tiết');
      if (l.account?.telegramId) append('log-account', `TG:${l.account.telegramId}`);
      if (l.account?.deviceHash) append('log-account', `DEV:${l.account.deviceHash}`);
      append('log-ip', l.account?.ip || l.ip || '');

      container.appendChild(line);
    });
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

      if (data.android) {
        const apkInput = document.getElementById('adminDownloadApkInput');
        const apkVer = document.getElementById('adminVersionApkInput');
        if (apkInput) apkInput.value = data.android.url || '/download/apk';
        if (apkVer) apkVer.value = data.android.version || '3.0.0';
      }

      if (data.ios) {
        const ipaInput = document.getElementById('adminDownloadIpaInput');
        const ipaVer = document.getElementById('adminVersionIpaInput');
        if (ipaInput) ipaInput.value = data.ios.url || '/download/ipa';
        if (ipaVer) ipaVer.value = data.ios.version || '3.0.0';
      }

      if (data.windows) {
        const exeInput = document.getElementById('adminDownloadExeInput');
        const exeVer = document.getElementById('adminVersionExeInput');
        if (exeInput) exeInput.value = data.windows.url || '/download/exe';
        if (exeVer) exeVer.value = data.windows.version || '3.0.0';
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
          iosUrl, iosVersion,
          windowsUrl, windowsVersion
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
