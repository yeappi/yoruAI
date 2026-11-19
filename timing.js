// Delays apply in the browser BEFORE /api/chat is called.
// Keep pure so it can be tuned and tested without contacting Gemini.
(function(root){
  'use strict';
  const DEFAULT=Object.freeze({readMin:4,readMax:18,preApiMin:7,preApiMax:30});
  const MAX=180;
  function number(v,fallback){
    return Number.isFinite(Number(v))?Math.min(MAX,Math.max(0,Math.round(Number(v)))):fallback;
  }
  function normalize(raw){
    const o={};
    for(const k of Object.keys(DEFAULT))o[k]=number(raw?.[k],DEFAULT[k]);
    o.readMax=Math.max(o.readMin,o.readMax);
    o.preApiMax=Math.max(o.preApiMin,o.preApiMax);
    return o;
  }
  function sample(low,high,random){
    const r=Math.min(1,Math.max(0,Number(random())));
    return low+(high-low)*r;
  }
  function plan(raw,{characterId='',energy=60,lastText='',random=Math.random}={}){
    const p=normalize(raw);
    // A light bias per cast, with bounded variation on every new turn.
    const weights={kokoa:0.9,rena:1.15,yume:0.85,ren:1.05,nagi:1.3,mao:0.95};
    const w=weights[characterId]||1;
    const tired=energy<35?1.2:energy>75?0.92:1;
    const long=Math.min(1.35,1+Math.max(0,String(lastText).length-25)/350);
    const readMs=Math.round(sample(p.readMin,p.readMax,random)*1000*w*tired);
    const preApiMs=Math.round(sample(p.preApiMin,p.preApiMax,random)*1000*w*tired*long);
    // Separate 'not yet seen' from 'read, composing' on the screen.
    const composeMs=Math.round(preApiMs*0.25);
    return {readMs,preApiMs,composeMs,
      // Explicitly expose the timing phases for diagnostic display only.
      version:'timing-1.0.0'};
  }
  root.ChatTiming={DEFAULT,normalize,plan};
})(typeof window!=='undefined'?window:globalThis);
