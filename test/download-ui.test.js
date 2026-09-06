const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const platform = require('../public/js/platform.js');

test('release comparison distinguishes newer, same, older and missing/unknown versions', () => {
  const entry = version => ({url:'https://example.com/app.ipa',version});
  assert.equal(platform.releaseState(entry('3.10.0'),'3.4.19'),'newer');
  assert.equal(platform.releaseState(entry('3.4.17'),'3.4.19'),'older');
  assert.equal(platform.releaseState(entry('3.4.19.0'),'3.4.19'),'current');
  assert.equal(platform.releaseState(entry(''),'3.4.19'),'unknown');
  assert.equal(platform.releaseState(entry('nightly'),'3.4.19'),'unknown');
  assert.equal(platform.releaseState({url:'',version:'99'},'3.4.19'),'unavailable');
});

test('download entry exists in phone account and activation view, not just hidden navbar', () => {
  const html = fs.readFileSync('public/index.html','utf8');
  for(const id of ['accDownloadBtn','gateDownloadBtn']) {
    assert.match(html,new RegExp(`id="${id}"[^>]*onclick="openDownloadModal\\(\\)"`));
  }
  assert.match(html,/id="downloadReleaseStatus"[^>]*role="status"/);
  assert.doesNotMatch(html, /id="btnDownload(?:Ipa|Exe|Apk)"[^>]*href="\/download/);
  const css = fs.readFileSync('public/css/modal.css','utf8');
  assert.match(css,/\.download-dialog\s*\{\s*display: block;\s*overflow-y: auto;/);
});

test('press feedback preserves positioned button transforms and stable hit targets',()=>{
  const css=fs.readFileSync('public/css/style.css','utf8');
  const rule=css.match(/\.is-pressing\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(rule,/\btransform\s*:/);
  assert.match(rule,/filter: brightness/);
});

function fixture(fetchJson, device = 'ios') {
  const elements = new Map();
  const get = id => {
    if(!elements.has(id)) {
      const attributes = new Map(), classes = new Set();
      elements.set(id, {textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:()=>{},contains:x=>classes.has(x)},
        removeAttribute:n=>attributes.delete(n),setAttribute:(n,v)=>attributes.set(n,v),getAttribute:n=>attributes.get(n),
        closest:()=>null});
    }
    return elements.get(id);
  };
  const ctx = {window:{PHIM4K_PLATFORM:device},navigator:{userAgent:''},Phim4KPlatform:platform,
    API:{getVersion:()=> '3.4.19', fetchJson},document:{getElementById:get,addEventListener:()=>{}},console};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/js/auth.js','utf8'),ctx);
  return {ctx,get};
}

for (const device of ['ios', 'android', 'android_tv', 'windows', 'web']) {
  test(`all published device downloads remain available on ${device}`, async () => {
    const ids = {ios:'Ipa',android:'Apk',android_tv:'Tv',windows:'Exe'};
    const data = Object.fromEntries(Object.keys(ids).map(key => [key, {url:`https://example.com/${key}`,version:'3.5.0'}]));
    const f = fixture(async () => data, device);
    await f.ctx.refreshPublicDownloads();
    for (const [key,id] of Object.entries(ids)) {
      const button = f.get(`btnDownload${id}`);
      assert.equal(button.getAttribute('aria-disabled'), 'false');
      assert.equal(button.href, data[key].url);
      assert.equal(button.textContent.includes('Phù hợp thiết bị này'), key === device);
    }
  });
}

test('download request is single-flight, marks old public release and only installs safe links', async()=>{
  let resolve, count=0;
  const f=fixture(()=>{count++;return new Promise(r=>resolve=r);});
  const a=f.ctx.refreshPublicDownloads(), b=f.ctx.refreshPublicDownloads();
  assert.equal(count,1);
  resolve({ios:{url:'https://example.com/old.ipa',version:'3.4.17'},windows:{url:'javascript:bad',version:'9'}});
  await Promise.all([a,b]);
  assert.equal(f.get('btnDownloadIpa').href,'https://example.com/old.ipa');
  assert.match(f.get('downloadReleaseStatus').textContent,/không cần hạ phiên bản/);
  assert.equal(f.get('btnDownloadExe').getAttribute('aria-disabled'),'true');
});

test('download list reports failure and permits retry without a stale active request',async()=>{
  let count=0;
  const f=fixture(async()=>{if(++count===1)throw new Error('offline');return {ios:{url:'https://example.com/new.ipa',version:'3.5.0'}};});
  await f.ctx.refreshPublicDownloads();
  assert.equal(f.get('downloadRetryBtn').classList.contains('hidden'),false);
  assert.match(f.get('downloadReleaseStatus').textContent,/Không lấy được/);
  await f.ctx.refreshPublicDownloads();
  assert.equal(count,2);
  assert.equal(f.get('downloadRetryBtn').classList.contains('hidden'),true);
  assert.match(f.get('downloadReleaseStatus').textContent,/Có bản 3.5.0/);
});
