// Run: node tests/engine.test.cjs
'use strict';
const assert=require('node:assert/strict');
const E=require('../api/engine');
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
