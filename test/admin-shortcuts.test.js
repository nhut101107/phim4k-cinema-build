const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');
test('movie detail is image-only and no trailer runtime is loaded',()=>{
  const html=read('public/index.html'),app=read('public/js/app.js');
  assert.doesNotMatch(html,/id="detailTrailer"|src="\/js\/trailer.js"/);
  assert.doesNotMatch(app,/Phim4KTrailer\?\.mount/);
  assert.match(html,/id="detailPoster"/);
  assert.match(html,/id="detailBackdrop"/);
});
test('admin has dedicated log and actual download shortcuts distinct from link configuration',()=>{
  const html=read('public/index.html');
  assert.match(html,/id="adminReadLogsBtn"[^>]*onclick="Admin.showTab\('logs'\)"/);
  assert.match(html,/id="adminGetUpdateBtn"[^>]*onclick="openDownloadModal\(\)"/);
  assert.match(html,/Cấu hình link tải/);
  assert.match(html,/id="adminBuildVersion"/);
});
test('account log access starts hidden and still goes through verified-admin open',()=>{
  assert.match(read('public/index.html'),/id="accLogsBtn" class="btn-secondary hidden"/);
  assert.match(read('public/js/coverflow.js'),/getElementById\('accLogsBtn'\)\?\.classList.toggle\('hidden', !isSuperAdmin\)/);
  const admin=read('public/js/admin.js');
  assert.match(admin,/activeKeyData\?\.isAdmin !== true/);
  assert.doesNotMatch(admin,/(?:configuredAdminTelegram|telegramId)[^\n]{0,120}(?:===|==)\s*['"]\d{9,12}['"]/);
});

test('admin bans current key-only users by key and device instead of requiring Telegram ID',()=>{
  const html=read('public/index.html');
  const admin=read('public/js/admin.js');
  const worker=read('backend-worker/src/worker.mjs');
  assert.match(html,/ban trực tiếp theo key và thiết bị/i);
  assert.match(admin,/JSON\.stringify\(\{ key, deviceId, reason:/);
  assert.match(admin,/JSON\.stringify\(\{ key, deviceId \}\)/);
  assert.doesNotMatch(admin,/promptBanUser|Ban TG|TG \+ máy/);
  assert.match(worker,/MISSING_USER_TARGET/);
  assert.match(worker,/UPDATE license_keys SET active = \?, updated_at = \? WHERE license_key = \?/);
});
