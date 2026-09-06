import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
const env={
  DB:{prepare(){return{bind(){return{async first(){return{setting_value:'true'}}}}}}},
  MOVIE_CATALOG_ORIGIN:'https://catalog.example',
  MOVIE_IMAGE_HOSTS:'images.example',
  MEDIA_TICKET_SECRET:'fixture-media-ticket-secret-at-least-32-characters',
};
const request=()=>new Request('https://example.workers.dev/api/movies/home',{headers:{'x-device-id':'home-fixture'}});
test('a failing cinema source does not blank the new series feed; requests are bounded',async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input); calls.push({url,options});
    if(url.pathname.includes('phim-chieu-rap'))throw new Error('offline');
    const old=url.pathname==='/danh-sach/phim-moi-cap-nhat';
    return new Response(JSON.stringify({data:{items:[{slug:old?'old':'new-series',year:old?1999:new Date().getUTCFullYear(),type:'series'}]}}),{headers:{'content-type':'application/json'}});
  };
  try {
    const res=await worker.fetch(request(),env),data=await res.json();
    assert.equal(res.status,200);
    assert.deepEqual(data.hero.map(m=>m.slug),['new-series']);
    assert.equal(calls.length,4);
    assert.ok(calls.every(c=>c.url.origin==='https://catalog.example'&&c.options.signal&&c.options.redirect==='manual'));
    assert.ok(calls.slice(1).every(c=>c.url.searchParams.get('year')===String(new Date().getUTCFullYear())&&c.url.searchParams.get('limit')==='64'));
  } finally {globalThis.fetch=original;}
});
test('all sources failing produces a retryable error, not invented movie recommendations',async()=>{
  const original=globalThis.fetch; globalThis.fetch=async()=>{throw new Error('offline')};
  try {
    const res=await worker.fetch(request(),env);assert.equal(res.status,502);
    assert.equal((await res.json()).code,'MOVIE_UPSTREAM_UNAVAILABLE');
  } finally {globalThis.fetch=original;}
});
