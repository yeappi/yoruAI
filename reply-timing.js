/* yoruAI MVP: read receipts and reply waiting happen before Gemini API. */
(function(root){
  'use strict';
  const FIFTEEN_MINUTES=15*60*1000;
  const MAX_WAIT=15*60*1000;
  const MIN_WAIT=30*1000;
  const VERSION=2;
  const FOLLOWUP_THRESHOLD=60*1000;
  const rnd=random=>Math.min(1-1e-12,Math.max(0,Number(random())||0));
  function plan({now=Date.now(),firstResponse=false,lastInteractionAt=0,random=Math.random}={}){
    let readDelay,requestDelay,kind;
    if(firstResponse){
      kind='first';
      readDelay=800+Math.floor(rnd(random)*1400);
      requestDelay=readDelay+200+Math.floor(rnd(random)*550);
    }else if(lastInteractionAt>0 && now-lastInteractionAt<FIFTEEN_MINUTES){
      kind='active';
      readDelay=9000+Math.floor(rnd(random)*3000);
      requestDelay=readDelay+250+Math.floor(rnd(random)*1200);
    }else{
      kind='return';
      // Bounded exponential: approximately 2 minutes average, with a long tail.
      const u=rnd(random);
      requestDelay=Math.min(MAX_WAIT,MIN_WAIT+Math.round(-Math.log1p(-u)*90000));
      readDelay=Math.max(3000,requestDelay-7000-Math.floor(rnd(random)*8000));
    }
    return {version:VERSION,kind,createdAt:now,readAt:now+readDelay,requestAt:now+requestDelay};
  }
  function expedite(plan,now=Date.now(),random=Math.random){
    const readDelay=400+Math.floor(rnd(random)*550);
    return {...plan,version:VERSION,kind:'followup',readAt:now+readDelay,
      requestAt:now+readDelay+150+Math.floor(rnd(random)*400)};
  }
  function shouldExpedite({plan,previousUserAt,now=Date.now()}={}){
    return !!plan && Number.isFinite(previousUserAt) && previousUserAt>0 &&
      now-previousUserAt>=FOLLOWUP_THRESHOLD && now<plan.requestAt;
  }
  function valid(p){
    return !!p && p.version===VERSION && ['first','active','return','followup'].includes(p.kind) &&
      Number.isFinite(p.createdAt) && Number.isFinite(p.readAt) &&
      Number.isFinite(p.requestAt) && p.createdAt>0 &&
      p.readAt>=p.createdAt && p.requestAt>=p.readAt &&
      p.requestAt-p.createdAt<=MAX_WAIT+5000;
  }
  const api={plan,expedite,shouldExpedite,valid,FIFTEEN_MINUTES,FOLLOWUP_THRESHOLD,MAX_WAIT,MIN_WAIT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.ReplyTiming=api;
})(typeof window!=='undefined'?window:null);
