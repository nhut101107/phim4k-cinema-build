const { app, BrowserWindow, protocol, net, session, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { resolveAsset, allowedExternal } = require('./policy.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'phim4k', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const root = path.join(app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..'), 'public');
  protocol.handle('phim4k', request => {
    const asset = resolveAsset(root, request.url);
    if (!asset) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(asset).href);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const smoke = process.argv.includes('--smoke-test');
  const win = new BrowserWindow({ width: 1366, height: 900, minWidth: 960, minHeight: 640, backgroundColor: '#0b101b', show: !smoke,
    autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false } });
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' Phim4KDesktop');
  const external = url => { if (allowedExternal(url)) void shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol !== 'phim4k:' || target.hostname !== 'app') { event.preventDefault(); external(url); }
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  let failed = false;
  win.webContents.on('render-process-gone', () => { failed = true; if (!smoke) dialog.showErrorBox('Phim4K', 'Trình phát đã dừng. Hãy mở lại ứng dụng.'); });
  await win.loadURL('phim4k://app/index.html');
  if (smoke) {
    const report = await win.webContents.executeJavaScript(`({ title: document.title, keyGate: !!document.querySelector('#activationGate:not(.hidden)'), nodeExposed: typeof require !== 'undefined', platform: Phim4KPlatform.detect(navigator.userAgent), downloadFunction: typeof refreshPublicDownloads === 'function' })`);
    report.videoDecoded = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const v = Player.video; v.muted = true; v.loop = true;
      const timer = setTimeout(() => resolve(false), 15000);
      v.addEventListener('timeupdate', () => { if (v.currentTime > 0.1 && v.videoWidth > 0) { clearTimeout(timer); resolve(true); } });
      v.addEventListener('error', () => { clearTimeout(timer); resolve(false); });
      Player.open({name:'Original QA',slug:'qa-desktop'}, {name:'QA',link_embed:'phim4k://app/media/qa-original.mp4'});
    })`, true);
    report.playerInteraction = await win.webContents.executeJavaScript(`(() => {
      const v=Player.video, r=v.getBoundingClientRect();
      const fill=getComputedStyle(v).objectFit==='cover' && r.width===innerWidth && r.height===innerHeight;
      v.click(); const outsideDoesNotPause=!v.paused;
      Player.resetInactivityTimer(); document.getElementById('btnCenterPlayPause').click();
      return {fill,outsideDoesNotPause,centerPauses:v.paused};
    })()`);
    report.pass = !failed && report.keyGate && !report.nodeExposed && report.platform === 'windows' && report.downloadFunction && report.videoDecoded && Object.values(report.playerInteraction).every(Boolean);
    fs.mkdirSync(path.join(app.getPath('userData'), 'qa'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'qa', 'desktop-smoke.json'), JSON.stringify(report, null, 2));
    app.exit(report.pass ? 0 : 1);
  }
}).catch(() => { if (!process.argv.includes('--smoke-test')) dialog.showErrorBox('Phim4K', 'Không thể khởi động ứng dụng. Vui lòng tải lại bản chính thức.'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
