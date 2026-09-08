import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { openMediaTicket } from '../src/worker.mjs';
const env={
  ALLOW_LEGACY_TEST_AUTH:'1',
  DB:{prepare(){return{bind(){return{async first(){return{setting_value:'true'}}}}}}},
  MOVIE_CATALOG_ORIGIN:'https://catalog.example',
  MOVIE_IMAGE_HOSTS:'legacy.example,images.example',
  MEDIA_TICKET_SECRET:'fixture-media-ticket-secret-at-least-32-characters',
};
const request=()=>new Request('https://example.workers.dev/api/movies/home',{headers:{'x-device-id':'home-fixture'}});
test('a failing cinema source does not blank the new series feed; requests are bounded',async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input); calls.push({url,options});
    if(url.pathname.includes('phim-chieu-rap'))throw new Error('offline');
    const old=url.pathname==='/danh-sach/phim-moi-cap-nhat';
    return new Response(JSON.stringify({data:{APP_DOMAIN_CDN_IMAGE:'https://images.example',items:[{slug:old?'old':'new-series',year:old?1999:new Date().getUTCFullYear(),type:'series',poster_url:'uploads/movies/poster.webp'}]}}),{headers:{'content-type':'application/json'}});
  };
  try {
    const res=await worker.fetch(request(),env),data=await res.json();
    assert.equal(res.status,200);
    assert.deepEqual(data.hero.map(m=>m.slug),['new-series']);
    const imageTicket=await openMediaTicket(new URL(data.hero[0].poster_url).searchParams.get('t'),env,'image');
    assert.equal(imageTicket.url,'https://images.example/uploads/movies/poster.webp');
    assert.equal(calls.length,27);
    assert.ok(calls.every(c=>c.url.origin==='https://catalog.example'&&c.options.signal&&c.options.redirect==='manual'));
    const newest=calls.filter(c=>c.url.pathname==='/danh-sach/phim-moi-cap-nhat');
    assert.deepEqual(newest.map(c=>c.url.searchParams.get('page')),['1','2','3','4','5','6','7','8','9','10','11','12']);
    const categories=calls.filter(c=>c.url.pathname.startsWith('/v1/api/danh-sach/'));
    assert.equal(categories.length,15);
    assert.ok(categories.every(c=>c.url.searchParams.get('year')===String(new Date().getUTCFullYear())&&c.url.searchParams.get('limit')==='64'));
    for (const category of ['phim-chieu-rap', 'phim-le', 'phim-bo', 'hoat-hinh', 'tv-shows']) {
      assert.deepEqual(categories.filter(c=>c.url.pathname.endsWith(`/${category}`)).map(c=>c.url.searchParams.get('page')),['1','2','3']);
    }
    const repeatedPosters = [data.hero[0], ...data.sections.flatMap(section => section.items)].map(movie=>movie.poster_url).filter(Boolean);
    assert.equal(new Set(repeatedPosters).size,1,'the same source image must reuse one protected URL throughout a feed response');
  } finally {globalThis.fetch=original;}
});
test('all sources failing produces a retryable error, not invented movie recommendations',async()=>{
  const original=globalThis.fetch; globalThis.fetch=async()=>{throw new Error('offline')};
  try {
    const res=await worker.fetch(request(),env);assert.equal(res.status,502);
    assert.equal((await res.json()).code,'MOVIE_UPSTREAM_UNAVAILABLE');
  } finally {globalThis.fetch=original;}
});

test('full catalog exposes real paginated inventory above one thousand without bundling it into the client',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input)=>{
    const url=new URL(input);
    assert.equal(url.origin,'https://catalog.example');
    assert.equal(url.pathname,'/danh-sach/phim-moi-cap-nhat');
    assert.equal(url.searchParams.get('page'),'7');
    return new Response(JSON.stringify({data:{
      APP_DOMAIN_CDN_IMAGE:'https://images.example',
      items:[{slug:'licensed-direct-title',name:'Licensed title',poster_url:'uploads/poster.webp'}],
      params:{pagination:{currentPage:7,totalPages:52,totalItems:1248,totalItemsPerPage:24}},
    }}),{headers:{'content-type':'application/json'}});
  };
  try {
    const res=await worker.fetch(new Request('https://example.workers.dev/api/movies/catalog?page=7',{headers:{'x-device-id':'catalog-fixture'}}),env);
    const data=await res.json();
    assert.equal(res.status,200);
    assert.equal(data.pagination.totalItems,1248);
    assert.equal(data.pagination.totalPages,52);
    assert.equal(data.items.length,1);
    assert.match(data.items[0].poster_url,/\/api\/media\/image\?t=/);
  } finally {globalThis.fetch=original;}
});
