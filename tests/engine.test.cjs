// Run: node tests/engine.test.cjs
'use strict';
const assert=require('node:assert/strict');
const E=require('../lib/engine');
let count=0;
function test(title,fn){fn();count++;console.log('✓ '+title)}
test('five independent features',()=>{
 assert.deepEqual(Object.keys(E.DEFAULT_FLAGS),E.FEATURES);
 assert.ok(E.FEATURES.every(k=>E.DEFAULT_FLAGS[k]));
});
test('six distinct characters and persona context',()=>{
 assert.equal(Object.keys(E.CASTS).length,6);
 const ctx=E.build({charId:'mao',character:{name:'真央',job:'ガールズバー',store:'京橋',tone:'関西弁'},userName:'テスト',history:[]});
 assert.ok(ctx.system.includes('真央'));
 assert.ok(ctx.system.includes('関西弁'));
 assert.ok(ctx.system.includes('価値観'));
});
test('state is not advanced by message count alone',()=>{
 const before=E.initialState('mao');
 const after=E.advance(before,{signals:{}},{charId:'mao',userText:'やっほ',flags:E.DEFAULT_FLAGS});
 assert.equal(after.relationship.closeness,before.relationship.closeness);
});
test('relationship changes limited to two per event',()=>{
 const a=E.initialState('mao');
 const b=E.advance(a,{signals:{trust:100,tension:-100}},{charId:'mao',userText:'相談した',flags:E.DEFAULT_FLAGS});
 assert.equal(b.relationship.trust,a.relationship.trust+2);
 assert.equal(b.relationship.tension,0);
});
test('memory requires verbatim evidence and deduplicates',()=>{
 const a=E.initialState('mao');
 const p={signals:{},memory:{text:'明日から新しい仕事を始める予定',evidence:'明日から新しい仕事',importance:4,kind:'event'}};
 const b=E.advance(a,p,{charId:'mao',userText:'明日から新しい仕事が始まる',flags:E.DEFAULT_FLAGS});
 assert.equal(b.memories.length,1);
 const c=E.advance(b,p,{charId:'mao',userText:'明日から新しい仕事が始まる',flags:E.DEFAULT_FLAGS});
 assert.equal(c.memories.length,1);
 const d=E.advance(a,p,{charId:'mao',userText:'ご飯は食べました',flags:E.DEFAULT_FLAGS});
 assert.equal(d.memories.length,0);
});
test('mood stable within day',()=>{
 const a=E.initialState('rena',Date.UTC(2026,10,20));
 const b=E.initialState('rena',Date.UTC(2026,10,20)+100000);
 assert.equal(a.mood.reason,b.mood.reason);
});
test('features independently disabled',()=>{
 const base=E.build({charId:'mao',character:{name:'真央'},history:[],settings:{flags:{persona:false,relationship:false,mood:false,memory:false,initiative:false}}});
 const full=E.build({charId:'mao',character:{name:'真央'},history:[],settings:{flags:E.DEFAULT_FLAGS}});
 assert.ok(!base.system.includes('価値観'));
 assert.ok(full.system.includes('価値観'));
});
test('structured response parser',()=>{
 const r=E.parse(JSON.stringify({messages:['マジで？笑'],signals:{trust:1}}));
 assert.equal(r.messages[0],'マジで？笑');
 assert.equal(r.structured,true);
});
console.log('All '+count+' engine tests passed.');

test('meet decides initial relationship; saved state is never overwritten',()=>{
  const R=require('../relation');
  assert.deepEqual(E.initialState('mao').relationship,{closeness:10,trust:20,attraction:12,comfort:18,tension:0});
  assert.deepEqual(E.initialState('mao',Date.now(),'first').relationship,E.initialState('mao').relationship);
  const n=E.initialState('mao',Date.now(),'nanpa').relationship,m=E.initialState('mao',Date.now(),'match').relationship;
  assert.ok(n.trust<20&&n.comfort<18,'nanpa starts guarded');
  assert.ok(m.attraction>12,'match starts with more interest');
  assert.deepEqual(E.initialState('mao',Date.now(),'bogus').relationship,E.initialState('mao').relationship);
  assert.deepEqual(E.normalize(null,'rena',Date.now(),'nanpa').relationship,R.MEET_SEEDS.nanpa);
  const saved=E.initialState('rena',Date.now(),'first');saved.relationship.closeness=55;
  assert.equal(E.normalize(saved,'rena',Date.now(),'nanpa').relationship.closeness,55);
  const p=E.build({charId:'mao',character:E.CASTS.mao,meet:'x',meetKey:'nanpa',userName:'a',userGender:'male',history:[{role:'user',text:'hi'}],mode:'chat',settings:{},state:null});
  assert.ok(p&&JSON.stringify(p).length>100);
});

test('cast definitions are one source: client list == server casts, no drift',()=>{
  const C=require('../casts');
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
  assert.ok(!/const CHARS\s*=\s*\[/.test(html),'index.html must not redefine CHARS');
  assert.deepEqual(Object.keys(E.CASTS),C.list.map(c=>c.id));
  for(const c of C.list){assert.equal(E.CASTS[c.id].name,c.name);assert.ok(E.CASTS[c.id].tone&&E.CASTS[c.id].values,c.id+' has persona');}
});

test('relation.note describes bias, not just level',()=>{
  const R=require('../relation');
  assert.equal(R.note(R.seed('first')),'まだ知り合ったばかり');
  assert.match(R.note({closeness:60,trust:20,attraction:30,comfort:50,tension:0}),/打ち解け.*信頼はまだ浅い/);
  assert.match(R.note({closeness:40,trust:40,attraction:40,comfort:40,tension:15}),/わだかまり/);
  assert.equal(R.note(null),'');
});

test('admin casts: DB rows add, override and remove casts; builtin defaults restore',()=>{
  E.setCasts([{id:'hana',data:{name:'花',job:'キャバ嬢',life:[]},deleted:false},{id:'nagi',data:{},deleted:true},{id:'mao',data:{job:'変更'},deleted:false}]);
  assert.ok(E.CASTS.hana&&E.CASTS.hana.life.length>=1&&E.CASTS.hana.tone,'custom cast gets safe persona defaults');
  assert.equal(E.CASTS.nagi,undefined);
  assert.equal(E.CASTS.mao.job,'変更');
  assert.ok(E.CASTS.mao.values,'override keeps builtin persona');
  const st=E.initialState('hana',Date.now(),'match');
  assert.ok(st.mood.reason);
  E.setCasts([]);
  assert.equal(Object.keys(E.CASTS).length,6);assert.equal(E.CASTS.hana,undefined);
});

test('user requests: detected, remembered across casts, enforced, and put at top of prompt',()=>{
  const d=E.detectRequests('句読点つけないでって言ったよね');
  assert.equal(d[0].key,'punct');assert.ok(d[0].evidence.includes('句読点'));
  assert.equal(E.detectRequests('敬語やめて')[0].key,'tame');
  assert.match(E.detectRequests('たろうって呼んで')[0].text,/たろう/);
  assert.equal(E.detectRequests('そう呼んで').length,0,'generic words are not names');
  assert.equal(E.detectRequests('今日は暑いね').length,0);
  // advanceProfile: needs memory flag; removal via reverse request
  let p=E.advanceProfile(null,{memory:{}},{userText:'句読点やめて',flags:{}});
  assert.equal(p.requests.length,1);
  assert.equal(E.advanceProfile(p,{memory:{}},{userText:'句読点やめて',flags:{memory:false}}).requests.length,1,'memory flag off leaves profile unchanged');
  assert.equal(E.advanceProfile(p,{memory:{}},{userText:'やっぱり句読点つけて',flags:{}}).requests.length,0);
  // model-extracted request must quote the user verbatim
  const m={memory:{text:'絵文字を使わない',evidence:'絵文字いらない',kind:'request'}};
  assert.equal(E.advanceProfile(null,m,{userText:'絵文字いらないんだよね',flags:{}}).requests.length,1);
  assert.equal(E.advanceProfile(null,m,{userText:'別の話',flags:{}}).requests.length,0);
  // enforcement
  assert.deepEqual(E.enforce(['お疲れ様です。','今日は、疲れました。'],p.requests),['お疲れ様です','今日は 疲れました']);
  assert.deepEqual(E.enforce(['はい。'],[]),['はい。']);
  // prompt: requests at top priority for this very turn (before they are saved), name guidance present
  const out=E.build({charId:'mao',character:E.CASTS.mao,meet:'x',userName:'たろう',userGender:'male',
    history:[{from:'me',text:'句読点つけないで'}],mode:'reply',settings:{},state:null,profile:null});
  assert.match(out.system,/相手から頼まれた話し方[\s\S]*句点/);
  assert.match(out.system,/たろう/);
  const noMem=E.build({charId:'mao',character:E.CASTS.mao,meet:'x',userName:'a',userGender:'male',
    history:[{from:'me',text:'句読点つけないで'}],mode:'reply',settings:{flags:{memory:false}},state:null,profile:null});
  assert.ok(!/相手から頼まれた話し方/.test(noMem.system));
});
