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
