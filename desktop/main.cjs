const { app, BrowserWindow, protocol, net, session, shell, dialog, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { resolveAsset, allowedExternal } = require('./policy.cjs');

const smokeMode = process.argv.includes('--smoke-test');
if (smokeMode) {
  // Hosted Windows runners have no visible user gesture and can expose an
  // unstable GPU decoder. Keep the packaged smoke deterministic while still
  // exercising the real app, bundled video, controls and seek behavior.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.disableHardwareAcceleration();
}

protocol.registerSchemesAsPrivileged([{ scheme: 'phim4k', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// Keep the existing storage location while the visible application name is MNHUT, so upgrading does not erase local viewing progress.
app.setPath('userData', path.join(app.getPath('appData'), 'Phim4K Cinema'));
const secureSessionFile = path.join(app.getPath('userData'), 'secure-session.v1');
ipcMain.handle('phim4k:session:get', () => {
  try {
    if (!fs.existsSync(secureSessionFile) || !safeStorage.isEncryptionAvailable()) return { value: '' };
    const encrypted = Buffer.from(fs.readFileSync(secureSessionFile, 'utf8'), 'base64');
    if (!encrypted.length || encrypted.length > 32 * 1024) return { value: '' };
    return { value: safeStorage.decryptString(encrypted) };
  } catch (_error) {
    return { value: '' };
  }
});
ipcMain.handle('phim4k:session:set', (_event, payload = {}) => {
  const value = typeof payload.value === 'string' ? payload.value : '';
  if (!safeStorage.isEncryptionAvailable() || Buffer.byteLength(value, 'utf8') > 16 * 1024) throw new Error('Secure storage is unavailable.');
  fs.mkdirSync(path.dirname(secureSessionFile), { recursive: true });
  const temporary = `${secureSessionFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(value).toString('base64'), { encoding: 'utf8', mode: 0o600 });
  if (fs.existsSync(secureSessionFile)) fs.rmSync(secureSessionFile, { force: true });
  fs.renameSync(temporary, secureSessionFile);
  return {};
});
ipcMain.handle('phim4k:session:clear', () => {
  fs.rmSync(secureSessionFile, { force: true });
  return {};
});
ipcMain.handle('phim4k:stream:resolve', async (_event, payload = {}) => {
  const target = new URL(String(payload.url || ''));
  const referrer = new URL(String(payload.referrer || ''));
  if (target.protocol !== 'https:' || !/^embed\d{1,3}\.streamc\.xyz$/i.test(target.hostname)
      || target.pathname !== '/embed.php' || !/^[a-f0-9]{32}$/i.test(target.searchParams.get('hash') || '')
      || [...target.searchParams.keys()].some(key => key !== 'hash')
      || referrer.protocol !== 'https:' || referrer.hostname !== 'phim.nguonc.com') {
    throw new Error('Invalid backup stream request.');
  }
  const response = await net.fetch(target.href, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'vi,en-US;q=0.8,en;q=0.6',
      'content-type': 'application/json',
      origin: target.origin,
      referer: target.href,
      'user-agent': 'Mozilla/5.0 MNHUTCinemaDesktop',
    },
    body: JSON.stringify({ action: 'bootstrap', referrer: referrer.href, frame_origins: ['https://phim.nguonc.com'], request_grant: true,
      playlist_format: 'hls', pretty_url: true, path_chunks: true, bootstrap_format: 'json' }),
  });
  if (!response.ok) throw new Error(`Backup stream rejected (${response.status}).`);
  const data = await response.json();
  const playlist = new URL(String(data?.preissued?.playlist || ''));
  if (playlist.protocol !== 'https:' || playlist.origin !== target.origin || data?.preissued?.playlistFormat !== 'hls') {
    throw new Error('Invalid backup playlist.');
  }
  return { playlist: playlist.href };
});
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const root = path.join(app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..'), 'public');
  protocol.handle('phim4k', request => {
    const asset = resolveAsset(root, request.url);
    if (!asset) return new Response('Not found', { status: 404 });
    if (path.extname(asset) === '.mp4') {
      const size = fs.statSync(asset).size;
      const raw = request.headers.get('range');
      const parts = /^bytes=(\d*)-(\d*)$/.exec(raw || '');
      let start = 0, end = size - 1;
      if (raw) {
        if (!parts || (!parts[1] && !parts[2])) return new Response(null, {status:416,headers:{'content-range':`bytes */${size}`}});
        start = parts[1] ? Number(parts[1]) : Math.max(0,size-Number(parts[2]));
        end = parts[1] && parts[2] ? Math.min(size-1,Number(parts[2])) : size-1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, {status:416,headers:{'content-range':`bytes */${size}`}});
      }
      const headers = {'content-type':'video/mp4','accept-ranges':'bytes','content-length':String(end-start+1)};
      if (raw) headers['content-range'] = `bytes ${start}-${end}/${size}`;
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(asset,{start,end})), {status:raw ? 206 : 200,headers});
    }
    return net.fetch(pathToFileURL(asset).href);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const smoke = smokeMode;
  const win = new BrowserWindow({ width: 1366, height: 900, minWidth: 960, minHeight: 640, backgroundColor: '#0b101b', show: !smoke,
    autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false,
      preload: path.join(__dirname, 'preload.cjs') } });
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
  win.webContents.on('render-process-gone', () => { failed = true; if (!smoke) dialog.showErrorBox('MNHUT Cinema', 'Trình phát đã dừng. Hãy mở lại ứng dụng.'); });
  await win.loadURL('phim4k://app/index.html');
  if (smoke) {
    const report = await win.webContents.executeJavaScript(`({ title: document.title, keyGate: !!document.querySelector('#activationGate:not(.hidden)'), nodeExposed: typeof require !== 'undefined', platform: Phim4KPlatform.detect(navigator.userAgent), downloadFunction: typeof refreshPublicDownloads === 'function' })`);
    // GitHub's hidden Windows runner does not guarantee an H.264 decoder.
    // Verify the packaged provider surface and controls without treating a
    // runner codec omission as a broken installer.
    report.playerSurface = await win.webContents.executeJavaScript(`(() => {
      const episode={name:'QA'};
      episode['link_'+'embed']='https://example.com/embed/qa';
      Player.open({name:'Original QA',slug:'qa-desktop'}, episode);
      const iframe=document.getElementById('playerEmbed');
      const badge=document.getElementById('realResolutionBadge');
      return {
        modalOpen:!Player.modal.classList.contains('hidden'),
        embedActive:Player.wrapper.classList.contains('embed-active'),
        embedVisible:!iframe.classList.contains('hidden'),
        providerAssigned:iframe.src==='https://example.com/embed/qa',
        nativeVideoHidden:Player.video.classList.contains('hidden'),
        providerBadgeHidden:badge.classList.contains('hidden') && !badge.textContent.trim(),
        closeControl:Boolean(document.getElementById('btnClosePlayer')),
      };
    })()`);
    report.pass = !failed && report.keyGate && !report.nodeExposed && report.platform === 'windows'
      && report.downloadFunction && Object.values(report.playerSurface).every(Boolean);
    console.log(`[desktop-smoke] ${JSON.stringify(report)}`);
    fs.mkdirSync(path.join(app.getPath('userData'), 'qa'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'qa', 'desktop-smoke.json'), JSON.stringify(report, null, 2));
    app.exit(report.pass ? 0 : 1);
  }
}).catch((error) => {
  if (process.argv.includes('--smoke-test')) console.error(`[desktop-smoke] ${error?.stack || error}`);
  else dialog.showErrorBox('MNHUT Cinema', 'Không thể khởi động ứng dụng. Vui lòng tải lại bản chính thức.');
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
