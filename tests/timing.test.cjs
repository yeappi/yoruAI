// Run: node tests/timing.test.cjs
'use strict';
const assert=require('node:assert/strict');
const Timing=require('../reply-timing');
const Engine=require('../lib/engine');
const clock=Date.now();
function check(name,fn){fn();process.stdout.write('OK '+name+'\n')}
check('first response is fast',()=>{
 const p=Timing.plan({now:clock,firstResponse:true,random:()=>0.5});
 assert.equal(p.kind,'first');
 assert.ok(p.requestAt-clock<4000);
});
check('active conversation reads in about 10 seconds',()=>{
 const p=Timing.plan({now:clock,lastInteractionAt:clock-4*60000,random:()=>0.5});
 assert.equal(p.kind,'active');
 assert.ok(p.readAt-clock>=9000&&p.readAt-clock<12000);
 assert.ok(p.requestAt>=p.readAt);
});
check('after 15 minutes response takes 30 sec to 15 min',()=>{
 const p=Timing.plan({now:clock,lastInteractionAt:clock-15*60000,random:()=>0.5});
 assert.equal(p.kind,'return');
 assert.ok(p.requestAt-clock>=30000&&p.requestAt-clock<=900000);
});
check('one-minute follow-up cancels waiting',()=>{
 const p=Timing.plan({now:clock,lastInteractionAt:clock-60*60000,random:()=>0.999});
 assert.ok(!Timing.shouldExpedite({plan:p,previousUserAt:clock,now:clock+59999}));
 assert.ok(Timing.shouldExpedite({plan:p,previousUserAt:clock,now:clock+60000}));
 const fast=Timing.expedite(p,clock+60000,()=>0.5);
 assert.ok(Timing.valid(fast)&&fast.kind==='followup');
 assert.ok(fast.requestAt-(clock+60000)<2000);
});
check('delayed response average near two minutes',()=>{
 let seed=123;
 const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
 let sum=0;
 for(let i=0;i<20000;i++){
  const p=Timing.plan({now:clock,lastInteractionAt:clock-16*60000,random:rand});
  const delay=p.requestAt-clock;
  assert.ok(delay>=30000&&delay<=900000);
  sum+=delay;
 }
 const mean=sum/20000;
 assert.ok(mean>110000&&mean<130000,'mean='+mean);
});
check('long replies split into multiple short bubbles',()=>{
 const s='今日は本当にいろいろあってさ。なんか疲れちゃって。'.repeat(7);
 const parts=Engine.splitBubbles([s]);
 assert.ok(parts.length>=2&&parts.length<=6);
 assert.ok(parts.every(p=>p.length<=100));
});
check('multiple bubbles returned by model stay separate',()=>{
 const response=Engine.parse(JSON.stringify({messages:['え、それ本気？笑','ちょっと詳しく聞きたい']}));
 assert.deepEqual(response.messages,['え、それ本気？笑','ちょっと詳しく聞きたい']);
});
process.stdout.write('All timing tests passed.\n');
