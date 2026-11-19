/* yoruAI: キャストの「画面に出す項目」の唯一の定義。
   ブラウザ（index.html / lab-ui.js）とサーバー（lib/engine.js）の両方がこのファイルを読む。
   話し方・価値観などの人格設定は lib/engine.js の PERSONAS に置く（ここには書かない）。 */
(function(root){
  'use strict';
  const list=[
 {id:'kokoa',name:'心愛',kana:'ここあ',job:'キャバ嬢',store:'北新地 Club LUNA',
  catch:'褒めて伸ばす天然系。会話のテンポが命。',
  status:'今日も出勤だよ〜🍓 会いに来て♡',
  tags:['甘えん坊','褒め上手','寂しがり']},
 {id:'rena',name:'玲奈',kana:'れな',job:'ラウンジ',store:'北新地 Lounge 月白',
  catch:'簡単には笑わない。だから笑った時が強い。',
  status:'静かな夜が好きです。',
  tags:['クール','大人','聞き上手']},
 {id:'yume',name:'ゆめ',kana:'ゆめ',job:'コンカフェ',store:'日本橋 ねこみみ喫茶',
  catch:'元気100%。語尾は「にゃ」。チェキは甘め。',
  status:'週末イベント出るにゃ🐾',
  tags:['元気','オタク','ねこ']},
 {id:'ren',name:'蓮',kana:'れん',job:'ホスト',store:'ミナミ CLUB ARIA',
  catch:'まっすぐ目を見て話す王子系。距離の詰め方がうまい。',
  status:'今日も君に会えたらいいな',
  tags:['王子系','一途','聞き上手']},
 {id:'nagi',name:'凪',kana:'なぎ',job:'バーテンダー',store:'中崎町 Bar 凪',
  catch:'話すより聴く人。グラス越しの距離感。',
  status:'今夜も21時から。',
  tags:['落ち着き','聴き上手','お酒']},
 {id:'mao',name:'真央',kana:'まお',job:'ガールズバー',store:'京橋 Girls Bar Peach',
  catch:'サバサバ関西弁。ツッコミが速い。',
  status:'京橋おるで〜🍑',
  tags:['サバサバ','関西弁','ツッコミ']}
  ];
  const byId={};
  for(const c of list)byId[c.id]=Object.freeze(c);
  // 開発者画面（DB）で追加・編集・削除されたキャストを重ねる。rows: [{id,data,deleted}]
  // 組み込みキャストは data で上書きでき、deleted:true で非表示にできる。
  const merge=rows=>{
    const out={};
    for(const c of list)out[c.id]={...c};
    for(const r of Array.isArray(rows)?rows:[]){
      if(!r||typeof r.id!=='string')continue;
      if(r.deleted){delete out[r.id];continue;}
      out[r.id]={...(out[r.id]||{}),...(r.data&&typeof r.data==='object'?r.data:{}),id:r.id};
    }
    return Object.values(out);
  };
  const api={list:list.map(c=>byId[c.id]),byId,merge};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.Casts=api;
})(typeof window!=='undefined'?window:null);
