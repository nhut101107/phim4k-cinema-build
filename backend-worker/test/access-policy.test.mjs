import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = {prepare(sql) {return {bind(...args) {return {
    async first() {return sqlite.prepare(sql).get(...args) || null;},
    async run() {return sqlite.prepare(sql).run(...args);},
    async all() {return {results:sqlite.prepare(sql).all(...args)};}
  };}};}};
  const env = {DB, ADMIN_LICENSE_KEY:'TEST-ADMIN-SECRET', ADMIN_TELEGRAM_ID:'1000000001'};
  let sequence = 0;
  const request = async (path, body, headers = {}) => worker.fetch(new Request(`https://test.example${path}`, {
    method:body === undefined ? 'GET':'POST', headers:{'content-type':'application/json','cf-connecting-ip':`192.0.2.${++sequence}`, ...headers},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  }),env);
  const admin = {'x-license-key':env.ADMIN_LICENSE_KEY,'x-telegram-id':env.ADMIN_TELEGRAM_ID};
  const seed = (key='P4K-TEST-KEY') => sqlite.prepare('INSERT INTO license_keys (license_key,created_at,updated_at) VALUES (?,?,?)').run(key,'2026-01-01','2026-01-01');
  return {sqlite,request,admin,seed};
}

test('free access defaults off; only verified admin can change it; disabling revokes guest status', async () => {
  const f=fixture();
  try {
    assert.equal((await (await f.request('/api/app/access-policy')).json()).freeAccess,false);
    assert.equal((await f.request('/api/auth/activate',{deviceId:'device-a'})).status,401);
    assert.equal((await f.request('/api/admin/access-policy',{freeAccess:true})).status,403);
    assert.equal((await f.request('/api/admin/access-policy',{freeAccess:true},f.admin)).status,200);
    const guest=await (await f.request('/api/auth/activate',{deviceId:'device-a'})).json();
    assert.equal(guest.active,true); assert.equal(guest.isAdmin,false); assert.equal(guest.freeAccess,true);
    assert.equal((await f.request('/api/admin/access-policy',{freeAccess:'false'},f.admin)).status,400);
    await f.request('/api/admin/access-policy',{freeAccess:false},f.admin);
    assert.equal((await f.request('/api/auth/status',undefined,{'x-device-id':'device-a'})).status,401);
  } finally {f.sqlite.close();}
});

test('key-only activation atomically binds one device and rejects concurrent second device',async()=>{
  const f=fixture(); f.seed();
  try {
    const results=await Promise.all(['device-a','device-b'].map(deviceId=>f.request('/api/auth/activate',{key:'P4K-TEST-KEY',deviceId})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
    const device=f.sqlite.prepare('SELECT device_id FROM license_keys').get().device_id;
    const status=await (await f.request('/api/auth/status',undefined,{'x-license-key':'P4K-TEST-KEY','x-device-id':device})).json();
    assert.equal(status.keyOnly,true); assert.equal(status.active,true); assert.equal(status.isAdmin,false);
    f.sqlite.exec('UPDATE license_keys SET active=0');
    assert.equal((await f.request('/api/auth/status',undefined,{'x-license-key':'P4K-TEST-KEY','x-device-id':device})).status,403);
  } finally {f.sqlite.close();}
});

test('admin lists, bans and unbans a key-only user without Telegram ID',async()=>{
  const f=fixture(); f.seed('P4K-KEY-ONLY-USER');
  try {
    assert.equal((await f.request('/api/auth/activate',{key:'P4K-KEY-ONLY-USER',deviceId:'viewer-device-a'})).status,200);

    const usersResponse=await f.request('/api/admin/users',undefined,f.admin);
    const usersText=await usersResponse.text();
    assert.equal(usersResponse.status,200,usersText);
    const users=JSON.parse(usersText);
    assert.equal(users.users.length,1);
    assert.equal(users.users[0].telegramId,'');
    assert.equal(users.users[0].boundDeviceId,'viewer-device-a');

    const ban=await f.request('/api/admin/ban-user',{key:'P4K-KEY-ONLY-USER',deviceId:'viewer-device-a',reason:'test'},f.admin);
    assert.equal(ban.status,200);
    const blocked=await f.request('/api/auth/status',undefined,{'x-license-key':'P4K-KEY-ONLY-USER','x-device-id':'viewer-device-a'});
    assert.equal((await blocked.json()).code,'KEY_DISABLED');

    const afterBan=await (await f.request('/api/admin/users',undefined,f.admin)).json();
    assert.equal(afterBan.users[0].isBanned,true);

    const unban=await f.request('/api/admin/unban-user',{key:'P4K-KEY-ONLY-USER',deviceId:'viewer-device-a'},f.admin);
    assert.equal(unban.status,200);
    assert.equal((await f.request('/api/auth/status',undefined,{'x-license-key':'P4K-KEY-ONLY-USER','x-device-id':'viewer-device-a'})).status,200);

    const missing=await f.request('/api/admin/ban-user',{reason:'missing target'},f.admin);
    assert.equal((await missing.json()).code,'MISSING_USER_TARGET');
  } finally {f.sqlite.close();}
});

test('expiry and existing owner ban are still enforced without a Telegram input; admin key is never a user key',async()=>{
  const f=fixture(); f.seed();
  try {
    const activate=()=>f.request('/api/auth/activate',{key:'P4K-TEST-KEY',deviceId:'device-a'});
    f.sqlite.exec("UPDATE license_keys SET expires_at='2000-01-01'");
    assert.equal((await (await activate()).json()).code,'KEY_EXPIRED');
    f.sqlite.exec("UPDATE license_keys SET expires_at=NULL, assigned_telegram_id='123456789'; INSERT INTO bans (telegram_id,created_at,updated_at) VALUES ('123456789','now','now')");
    assert.equal((await (await activate()).json()).code,'USER_BANNED');
    const denied=await f.request('/api/auth/activate',{key:'TEST-ADMIN-SECRET',deviceId:'device-a'});
    assert.equal((await denied.json()).code,'ADMIN_TELEGRAM_REQUIRED');
    const admin=await (await f.request('/api/auth/activate',{key:'TEST-ADMIN-SECRET',deviceId:'device-a',telegramId:'1000000001'})).json();
    assert.equal(admin.isAdmin,true);
  } finally {f.sqlite.close();}
});

test('verified admin on an outdated iPhone is directed to the current iOS release only',async()=>{
  const f=fixture();
  try {
    const publishedAt='2026-09-06T00:00:00.000Z';
    f.sqlite.prepare('INSERT INTO downloads (platform,url,version,updated_at) VALUES (?,?,?,?)').run('ios','https://downloads.example/Phim4K-iOS-3.4.24.ipa','3.4.24',publishedAt);
    f.sqlite.prepare('INSERT INTO downloads (platform,url,version,updated_at) VALUES (?,?,?,?)').run('windows','https://downloads.example/Phim4K-Windows-3.4.17.exe','3.4.17',publishedAt);

    const iosAdmin=await (await f.request('/api/auth/status',undefined,{
      ...f.admin,
      'x-device-id':'admin-iphone',
      'x-app-version':'3.4.17',
      'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    })).json();
    assert.equal(iosAdmin.isAdmin,true);
    assert.equal(iosAdmin.active,false);
    assert.equal(iosAdmin.forceUpdate,true);
    assert.equal(iosAdmin.latestVersion,'3.4.24');
    assert.equal(iosAdmin.minVersion,'3.4.24');
    assert.equal(iosAdmin.downloadUrl,'https://downloads.example/Phim4K-iOS-3.4.24.ipa');

    const windowsAdmin=await (await f.request('/api/auth/status',undefined,{
      ...f.admin,
      'x-device-id':'admin-windows',
      'x-app-version':'3.4.17',
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    })).json();
    assert.equal(windowsAdmin.active,true);
    assert.equal(windowsAdmin.forceUpdate,false);

    f.seed('P4K-REGULAR-KEY');
    await f.request('/api/auth/activate',{key:'P4K-REGULAR-KEY',deviceId:'viewer-iphone'},{
      'x-app-version':'3.4.17',
      'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    });
    const viewer=await (await f.request('/api/auth/status',undefined,{
      'x-license-key':'P4K-REGULAR-KEY',
      'x-device-id':'viewer-iphone',
      'x-app-version':'3.4.17',
      'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    })).json();
    assert.equal(viewer.active,true);
    assert.equal(viewer.forceUpdate,false);

    const denied=await f.request('/api/auth/status',undefined,{
      'x-license-key':'TEST-ADMIN-SECRET',
      'x-telegram-id':'1111111111',
      'x-device-id':'unknown-iphone',
      'x-app-version':'3.4.17',
      'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    });
    assert.equal(denied.status,403);
    const deniedBody=await denied.json();
    assert.equal(deniedBody.downloadUrl,undefined);
  } finally {f.sqlite.close();}
});
