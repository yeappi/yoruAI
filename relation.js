/* yoruAI: 出会い方ごとの初期の関係値と、関係性の見せ方。
   サーバー（lib/engine.js）とブラウザ（index.html）の両方がこのファイルを読む。
   数値は 0〜100。既存ユーザーの保存済みの値は上書きしない（初期値は新しく出会うときだけ使う）。 */
(function(root){
  'use strict';
  const KEYS=['closeness','trust','attraction','comfort','tension'];
  // tension（わだかまり）は「過去の揉め事」なので、初期値はどの出会い方でも0。
  // 警戒心は trust と comfort の低さで表す。
  const MEET_SEEDS={
    first:{closeness:10,trust:20,attraction:12,comfort:18,tension:0}, // お店で会った。v1.0までの全員共通の初期値と同じ
    nanpa:{closeness:4, trust:8, attraction:8, comfort:6, tension:0},  // 街で声をかけた。まだ警戒されている
    match:{closeness:12,trust:14,attraction:22,comfort:20,tension:0}   // アプリでマッチした。好意は高く、顔も知らない
  };
  const seed=meet=>({...(Object.hasOwn(MEET_SEEDS,meet)?MEET_SEEDS[meet]:MEET_SEEDS.first)});
  const num=v=>Number.isFinite(+v)?+v:0;
  // 画面の親密度（他人→顔見知り→…）に使う1本の目安。5軸のうち3軸の重み付け。
  const affinityOf=r=>Math.min(100,Math.max(0,Math.round(num(r?.closeness)*.55+num(r?.trust)*.25+num(r?.attraction)*.20)));

  const LEAD=[['closeness','打ち解けている'],['trust','信頼されている'],['attraction','好意を持たれている'],['comfort','気楽に話せている']];
  const WEAK={closeness:'距離はまだある',trust:'信頼はまだ浅い',comfort:'少し緊張している'};
  // 5軸の状態を、ひとことで言い表す。1本の数値では見えない偏りを伝えるため。
  function note(r){
    if(!r||typeof r!=='object')return '';
    const v=k=>num(r[k]);
    const out=[];
    const strained=v('tension')>=8;
    if(strained)out.push('少しわだかまりがある');
    let top=LEAD[0];
    for(const a of LEAD)if(v(a[0])>v(top[0]))top=a;
    if(v(top[0])<30){
      if(!strained)out.push('まだ知り合ったばかり');
    }else{
      out.push(top[1]);
      let low=null;
      for(const k of Object.keys(WEAK))if(low===null||v(k)<v(low))low=k;
      if(low!==top[0]&&v(top[0])-v(low)>=25)out.push(WEAK[low]);
    }
    return out.join('・');
  }
  const api={KEYS,MEET_SEEDS,seed,affinityOf,note};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.Relation=api;
})(typeof window!=='undefined'?window:null);
