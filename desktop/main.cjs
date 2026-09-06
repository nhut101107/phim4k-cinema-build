const { app, BrowserWindow, protocol, net, session, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { resolveAsset, allowedExternal } = require('./policy.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'phim4k', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
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
      const liveTicket = API.getPlaybackTicket.bind(API);
      API.getPlaybackTicket = ref => ref === 'qa-desktop'
        ? Promise.resolve({streamUrl:'phim4k://app/media/qa-seek.mp4',isHls:false})
        : liveTicket(ref);
      Player.open({name:'Original QA',slug:'qa-desktop'}, {name:'QA',stream_ref:'qa-desktop'});
    })`, true);
    report.playerInteraction = await win.webContents.executeJavaScript(`(() => {
      Player.setAspectRatio('contain', {silent:true});
      const v=Player.video, r=v.getBoundingClientRect(), style=getComputedStyle(v);
      const subtitleSafe=style.objectFit==='contain' && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
      v.click(); const outsideDoesNotPause=!v.paused;
      Player.resetInactivityTimer(); document.getElementById('btnCenterPlayPause').click();
      return {subtitleSafe,outsideDoesNotPause,centerPauses:v.paused,geometry:{objectFit:style.objectFit,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}};
    })()`);
    report.seek = await win.webContents.executeJavaScript(`(async () => {
      const v=Player.video, r=v.getBoundingClientRect(); v.currentTime=12;
      await new Promise(resolve=>setTimeout(resolve,250));
      const start=v.currentTime;
      const tap=x=>Player.onSurfaceTap({detail:1,clientX:r.left+r.width*x,timeStamp:performance.now()});
      tap(.8); tap(.8); await new Promise(resolve=>setTimeout(resolve,150));
      const right=v.currentTime; tap(.2); tap(.2); await new Promise(resolve=>setTimeout(resolve,150));
      return {right:Math.abs(right-start-10)<.5,left:Math.abs(right-v.currentTime-10)<.5,stillPaused:v.paused,timings:[start,right,v.currentTime]};
    })()`);
    report.pass = !failed && report.keyGate && !report.nodeExposed && report.platform === 'windows' && report.downloadFunction && report.videoDecoded && report.playerInteraction.subtitleSafe && report.playerInteraction.outsideDoesNotPause && report.playerInteraction.centerPauses && Object.values(report.seek).every(Boolean);
    fs.mkdirSync(path.join(app.getPath('userData'), 'qa'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'qa', 'desktop-smoke.json'), JSON.stringify(report, null, 2));
    app.exit(report.pass ? 0 : 1);
  }
}).catch(() => { if (!process.argv.includes('--smoke-test')) dialog.showErrorBox('Phim4K', 'Không thể khởi động ứng dụng. Vui lòng tải lại bản chính thức.'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
