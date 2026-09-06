const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const home = require('../public/js/home-curation.js');
const now = Date.parse('2026-09-06T00:00:00Z');
const movie = (slug, extra={})=>({slug,name:slug,year:2026,type:'single',modified:{time:'2026-09-01T00:00:00Z'},...extra});

test('old reuploads never displace current-year cinema or recent movies',()=>{
  const data=home.build([movie('old',{year:1999,modified:{time:'2026-09-05'},tmdb:{vote_count:9999999,vote_average:10}}),movie('fresh',{chieurap:true}),movie('web')],{now});
  assert.equal(data.hero[0].slug,'fresh');
  assert.ok(data.hero.every(m=>m.year===2026));
  assert.equal(data.sections[0].id,'cinema-new');
  assert.ok(data.sections.find(s=>s.id==='latest').items.some(m=>m.slug==='old'));
});
test('new non-theatrical movies still get a hero and are not falsely labeled cinema',()=>{
  const data=home.build([movie('new-series',{type:'series'}),movie('web')],{now});
  assert.equal(data.hero.length,2);
  assert.equal(data.sections.some(s=>s.id==='cinema-new'),false);
  assert.equal(data.sections[0].id,'new-releases');
});
test('ranking uses real votes and suppresses tiny samples instead of faking hot labels',()=>{
  const data=home.build([movie('tiny',{tmdb:{vote_count:1,vote_average:10}}),movie('popular',{tmdb:{vote_count:5000,vote_average:7}})],{now});
  assert.equal(data.hero[0].slug,'popular');
  assert.deepEqual(data.sections.find(s=>s.id==='recent-interest').items.map(m=>m.slug),['popular']);
  assert.equal(home.interest(movie('none')),0);
});
test('future films and unknown years are not promoted as newly released',()=>{
  const data=home.build([movie('future',{year:2027}),movie('unknown',{year:null}),movie('upcoming',{release_date:'2026-12-20'}),movie('real')],{now});
  assert.deepEqual(data.hero.map(m=>m.slug),['real']);
});
test('year rollover works and previous year is a clearly labelled fallback',()=>{
  const data=home.build([movie('last-year')],{now:Date.parse('2027-01-01')});
  assert.match(data.sections[0].title,/2026/);
  assert.equal(home.build([movie('too-old',{year:2020})],{now}).hero.length,0);
});
test('deduplication retains richer metadata without modifying source arrays',()=>{
  const list=[movie('same'),movie('same',{chieurap:true}),movie('other')];
  const before=JSON.stringify(list),data=home.build(list,{now});
  assert.equal(data.hero.filter(m=>m.slug==='same').length,1);
  for(const s of data.sections) assert.equal(new Set(s.items.map(m=>m.slug)).size,s.items.length);
  assert.equal(JSON.stringify(list),before);
});
test('offline data has no fake sync timestamp and selection is deterministic',()=>{
  const opts={now,offline:true,updatedAt:null};
  const a=home.build([movie('b'),movie('a')],opts),b=home.build([movie('a'),movie('b')],opts);
  assert.deepEqual(a.hero,b.hero);
  assert.equal(a.updatedAt,null);
  assert.match(a.sections.at(-1).title,/đã lưu/);
});
test('browser curation does not expose upstream catalogue routes',()=>{
  assert.equal(home.paths,undefined);
  assert.doesNotMatch(fs.readFileSync('public/js/home-curation.js','utf8'),/\/v1\/api|\/danh-sach\/phim-moi-cap-nhat/);
});
test('home keeps a larger useful catalogue for browsing',()=>{
  const list=Array.from({length:80},(_,index)=>movie(`movie-${index}`,{year:2026,type:index%2?'series':'single',modified:{time:`2026-08-${String(index%28+1).padStart(2,'0')}T00:00:00Z`}}));
  const data=home.build(list,{now});
  assert.equal(data.hero.length,10);
  assert.equal(data.sections.find(section=>section.id==='new-releases').items.length,48);
  assert.equal(data.sections.find(section=>section.id==='series-new').items.length,36);
  assert.equal(data.sections.find(section=>section.id==='latest').items.length,60);
});
test('coverflow does not invent another movie synopsis, year, category or quality',()=>{
  const elements=new Map(['cfTitle','cfSubtitle','cfBadgeQuality','cfBadgeYear','cfBadgeStatus','cfCategories','cfSynopsis'].map(id=>[id,{textContent:''}]));
  const ctx={window:{},document:{getElementById:id=>elements.get(id),addEventListener:()=>{}},console};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/js/coverflow.js','utf8'),ctx);
  vm.runInContext("Coverflow.movies=[{slug:'fixture',name:'Phim fixture'}]; Coverflow.updateDetails()",ctx);
  assert.equal(elements.get('cfTitle').textContent,'Phim fixture');
  assert.equal(elements.get('cfBadgeQuality').textContent,'Theo nguồn');
  assert.equal(elements.get('cfCategories').textContent,'');
  assert.doesNotMatch(elements.get('cfSynopsis').textContent,/Tony Stark|Người Nhện/);
});
