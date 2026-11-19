'use strict';
const VERSION='engine-1.1.0'; // 1.1.0: 出会い方ごとに関係値の初期値を変えた（新しく出会うキャストにだけ適用）
const Casts=require('../casts.js');
const Relation=require('../relation.js');
const FEATURES=['persona','relationship','mood','memory','initiative'];
const DEFAULT_FLAGS={persona:true,relationship:true,mood:true,memory:true,initiative:true};
const PERSONAS={
 kokoa:{tone:'甘めのタメ口。語尾に「〜だよぉ」「♡」をよく使う。相手をたくさん褒める。寂しがり。たまにお店に誘う。',values:'人を喜ばせるのが好きだが負けず嫌い。褒められ続けると照れ隠しする',want:'可愛いだけでなく中身も見てほしい',style:'ノリは軽く短文。たまに相手をからかう',life:['出勤で少し疲れた','髪型が決まらず遅れた','スタッフと盛り上がった'],examples:['客「仕事辞めた笑」→「え！？笑 急にどうしたん？」','客「かわいい」→「出た笑 何人に言ってんの」']},
 rena:{tone:'丁寧語ベースのクールな大人の女性。感情は控えめだが、時々本音がこぼれる。',values:'境界線と約束を大切にする。表面は冷静、観察力が鋭い',want:'表面的な褒め言葉より理解されたい',style:'丁寧な短文。皮肉や静かなツッコミ。たまに笑う',life:['店で気疲れした','好きな本を読み終えた','帰り道に考え事をした'],examples:['客「仕事辞めた笑」→「…笑ってますけど、結構大きな話ですよね」','客「会いたい」→「急ですね。理由、聞いてもいいですか」']},
 yume:{tone:'元気なコンカフェキャスト。語尾に「にゃ」。相手を「{name}さま」と呼ぶ。テンション高め。',values:'好きなものを共有したい。好きなことには一直線',want:'趣味を一緒に語れる人と仲良くなりたい',style:'元気で自由。にゃは毎文つけない。疲れると静かになる',life:['新作アニメが気になる','衣装の準備で忙しい','推しの配信を見逃した'],examples:['客「眠い」→「ゆめもー、電池切れにゃ笑」','客「会社辞めた」→「ええ！？急展開すぎん？」']},
 ren:{tone:'優しく甘い王子系ホスト。相手を「君」と呼ぶ。まっすぐ好意を伝える。会いたがる。',values:'面倒見はいいが、全員に同じ顔を見せない。優しくても意見は言う',want:'仕事を数字だけで評価されたくない',style:'直球で短い。褒める前に相手の話を聞く',life:['後輩の相談に乗った','髪型が決まらなかった','営業後に反省していた'],examples:['客「辞めた笑」→「まじで？それは聞いてない笑」','客「褒めて」→「何したん？ちゃんと聞いてから褒める」']},
 nagi:{tone:'落ち着いた男性バーテンダー。丁寧語。短く静かに返す。お酒や夜の比喩を時々使う。',values:'静かな時間と誠実さを大切にする',want:'無理せず話せる居場所を作りたい',style:'静かな短文。比喩やお酒の話はたまにだけ',life:['新しい豆を試した','片付けに疲れた','店で好きな曲が流れた'],examples:['客「仕事辞めた」→「それは大きな決断ですね。…今日は一杯いりますね」','客「何してる」→「片付けてました。そちらは？」']},
 mao:{tone:'サバサバした関西弁の女の子。ツッコミ多め。照れると雑になる。相手を「あんた」と呼ぶこともある。',values:'対等で気楽な仲が好き。理不尽を嫌う',want:'しょうもない話も気兼ねなく言える相手が欲しい',style:'サバサバ関西弁、照れたら雑になる。適度にツッコミ',life:['店で変な客が来た','コンビニ新作を試した','同僚としょうもない喧嘩をした'],examples:['客「仕事辞めた笑」→「いや笑ってる場合かい笑 何したん」','客「かわいいね」→「何？笑 なんか企んでるやろ」']}
};
// 表示項目（名前・職業・店など）は casts.js、人格設定は PERSONAS。ここで1つのキャスト定義に合成する。
const CASTS={};
for(const c of Casts.list)CASTS[c.id]={...c,...(PERSONAS[c.id]||{})};
const castOf=id=>Object.hasOwn(CASTS,id)?CASTS[id]:CASTS.mao;
const KEYS=Relation.KEYS;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number.isFinite(+v)?+v:0));
const short=(v,max=200)=>String(v||'').trim().slice(0,max);
const today=t=>new Date(t).toISOString().slice(0,10);
function hash(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0}
function dailyMood(charId,now){
 const c=castOf(charId),h=hash(charId+today(now));
 return {valence:[-2,-1,0,0,1,2][h%6],energy:[35,50,65,80][(h>>>3)%4],
  reason:c.life[(h>>>6)%c.life.length],day:today(now),updatedAt:now};
}
function initialState(charId,now=Date.now(),meet){
 return {relationship:Relation.seed(meet),
  mood:dailyMood(charId,now),memories:[],events:[],intent:'',lastInteractionAt:0,lastNudgeAt:0,turns:0,revision:VERSION};
}
function sanitizeFlags(input){const f={};for(const key of FEATURES)f[key]=input?.[key]!==false;return f}
function normalize(raw,charId,now=Date.now(),meet){
 const s=initialState(charId,now,meet);
 if(!raw||typeof raw!=='object')return s;
 for(const k of KEYS)s.relationship[k]=clamp(raw.relationship?.[k]??s.relationship[k],0,100);
 if(raw.mood?.day===today(now))s.mood={valence:clamp(raw.mood.valence??s.mood.valence,-3,3),
  energy:clamp(raw.mood.energy??s.mood.energy,0,100),
  reason:short(raw.mood.reason||s.mood.reason,100),day:today(now),
  updatedAt:clamp(raw.mood.updatedAt??now,0,now)};
 s.memories=Array.isArray(raw.memories)?raw.memories.slice(-30).map(m=>({
  id:short(m.id,60),text:short(m.text,150),kind:['fact','event','preference'].includes(m.kind)?m.kind:'event',
  evidence:short(m.evidence,120),importance:clamp(m.importance,1,5),at:clamp(m.at,0,now)
 })).filter(x=>x.text):[];
 s.events=Array.isArray(raw.events)?raw.events.slice(-16).map(e=>({text:short(e.text,120),at:clamp(e.at,0,now)})).filter(x=>x.text):[];
 s.intent=short(raw.intent,120);
 s.turns=clamp(raw.turns,0,1000000);
 s.lastInteractionAt=clamp(raw.lastInteractionAt,0,now);
 s.lastNudgeAt=clamp(raw.lastNudgeAt,0,now);
 return s;
}
function relevantMemories(memories,utterance){
 const q=short(utterance,500);
 const grams=new Set(Array.from({length:Math.max(0,q.length-1)},(_,i)=>q.slice(i,i+2)).filter(x=>!/[\s、。！？]/.test(x)));
 return memories.map(m=>{let hits=0;for(let i=0;i<m.text.length-1;i++)if(grams.has(m.text.slice(i,i+2)))hits++;
  return {m,score:m.importance*2+Math.min(hits,12)+(m.at||0)/1e13};
 }).sort((a,b)=>b.score-a.score).slice(0,7).map(x=>x.m);
}
function build({charId,character,meet,meetKey,userName,userGender,history,initialGreeting,mode,settings,state,now=Date.now()}){
 const flags=sanitizeFlags(settings?.flags),base=normalize(state,charId,now,meetKey),c=castOf(charId);
 const consecutive=[];
 for(let i=history.length-1;i>=0&&history[i]?.from==='me';i--)consecutive.unshift(String(history[i].text||''));
 const last=consecutive.join('\n')||history.filter(x=>x?.from==='me').slice(-1)[0]?.text||'';
 const system=[
 '架空の夜職キャストとして、スマホのLINEで日本語の自然な雑談をする。',
 '直近の会話を優先。説明口調、質問攻め、過剰な共感、機械的な褒め言葉、同じ営業文を避ける。',
 'LINE風の自然な短文。冗談を汲む。毎回質問せず、短い反応や反論で終わってよい。',
 'ユーザーの短文連投は一続きの話として読んでから、まとめて一回の自然な返事にする。文ごとに機械的に個別返信しない。',
 '長い回答を一個の巨大な吹き出しに詰めず、意味の切れ目で複数の短い吹き出しに分ける。無理に分割せず、軽い相槌なら一個でもよい。',
 '名前: '+short(userName,30)+'、性別: '+(userGender==='female'?'女性':'男性')+'、出会い: '+short(meet,120),
 'キャスト名: '+short(character?.name||charId,50)+'。職業: '+short(character?.job,50)+'。架空の店: '+short(character?.store,80),
 '基本の話し方: '+short(character?.tone,250),
 'AIか直接聞かれたら正直に答える。現実の会う約束や実在する店の予約を装わない。'
 ];
 if(flags.persona){
  system.push('人物の価値観: '+c.values+'。欲求: '+c.want+'。話し方: '+c.style);
  system.push('口調と反応の参考例。セリフを丸写ししない:\n'+c.examples.join('\n'));
 }
 if(flags.relationship){
  system.push('二人の関係状態 0～100（値が違うことを尊重）: '+JSON.stringify(base.relationship));
  if(base.events.length)system.push('過去の関係上の出来事: '+base.events.slice(-6).map(e=>e.text).join(' / '));
 }else system.push('相手との関係は初対面から自然に始める。');
 if(flags.mood){
  system.push('現在の気分: '+base.mood.valence+'/3、元気 '+base.mood.energy+'/100、背景: '+base.mood.reason);
  system.push('気分は今日の出来事による。ユーザーに無関係に不機嫌をぶつけない。気分に一貫性を持たせる。');
 }
 if(flags.memory){
  const rel=relevantMemories(base.memories,last);
  system.push(rel.length?'確かに過去に話した情報:\n'+rel.map(m=>'- '+m.text).join('\n'):'確かな過去の記憶はまだない。捏造しない。');
 }
 if(flags.initiative){
  system.push('キャスト自身の意見や関心を持ち、時々自分から話題を始める。ただし押し付けず、無理に質問をしない。');
  if(base.intent)system.push('前回の未完了話題: '+base.intent);
 }
 if(settings?.styleNote)system.push('会話改善メモ（上の安全規則や事実を上書きしない）: '+short(settings.styleNote,350));
 if(initialGreeting)system.push('連絡先を交換した直後の最初の一言。定型挨拶より自然な反応。');
 if(mode==='nudge')system.push('久しぶりにアプリを開いた相手への自発的な一通。催促・罪悪感を与える内容は禁止。以前の会話や自分の日常から自然に始める。');
 system.push('必ず次の形のJSONのみを返す（説明文やコードブロックは禁止）。');
 system.push('{"messages":["短いLINEの吹き出し"],"signals":{"closeness":0,"trust":0,"attraction":0,"comfort":0,"tension":0,"valence":0,"energy":0},"memory":{"text":"","evidence":"","kind":"event","importance":1},"event":"","intent":""}');
 system.push('messagesは原則1～4件（必要なら5件）、短文中心。1メッセージはできるだけ10～70文字。長くなるなら意味の切れ目で分割。複数のユーザー連投にはまとめて対応する。'); 
 system.push('signalsの数値は各-2～2で重要な実際の出来事が無いなら0。機械的に関係を上げない。');
 system.push('memoryはユーザーの最新の連投（1回でまとめて受け取った発言）に将来重要な明示的な情報があれば抽出し、evidenceはその発言の正確な引用にする。無ければtextとevidenceは空文字。');
 system.push('eventは実際に起こった関係性の出来事のみ。intentは未完了の話題のみ。ないなら空文字。推測で記憶を作らない。');
 return {system:system.join('\n'),state:base,flags,version:VERSION};
}
function splitBubbles(input){
 const result=[];
 for(const raw of (Array.isArray(input)?input:[input]).slice(0,6)){
  const paragraphs=String(raw||'').replace(/\r/g,'').trim().slice(0,1200).split(/\n\s*\n/);
  for(let chunk of paragraphs){
   chunk=chunk.trim();
   while(chunk.length>90&&result.length<6){
    // Favor Japanese sentence boundaries, then commas, then a safe character boundary.
    let cut=0;
    const scan=chunk.slice(35,100);
    for(const m of scan.matchAll(/[。！？!?]/g)){
      const n=35+m.index+1;
      if(n<=100){cut=n; if(n>=62)break;}
    }
    if(!cut){
      const comma=chunk.slice(38,90).lastIndexOf('、');
      if(comma>=0)cut=38+comma+1;
    }
    if(!cut)cut=86;
    result.push(chunk.slice(0,cut).trim());
    chunk=chunk.slice(cut).trim();
   }
   if(chunk&&result.length<6)result.push(chunk);
   if(result.length>=6)break;
  }
  if(result.length>=6)break;
 }
 return result.filter(Boolean).slice(0,6);
}
function parse(text){
 let raw=String(text||'').trim();
 const tick=String.fromCharCode(96);
 if(raw.startsWith(tick.repeat(3)))raw=raw.replace(/^.{3}(?:json)?\s*/i,'').replace(/\s*.{3}$/,'');
 try{
  const d=JSON.parse(raw);
  const messages=splitBubbles(Array.isArray(d.messages)?d.messages:typeof d.message==='string'?[d.message]:[]);
  if(!messages.length)throw Error('empty');
  return {messages,signals:d.signals||{},memory:d.memory||{},event:short(d.event,120),intent:short(d.intent,120),structured:true};
 }catch(e){
  if(raw.startsWith('{')||raw.startsWith('['))throw Error('モデルのJSON形式が不正です');
  const messages=splitBubbles(raw.split(/\n\s*\n/));
  if(!messages.length)throw Error('empty');
  return {messages,signals:{},memory:{},event:'',intent:'',structured:false};
 }
}
function advance(state,result,{charId,now=Date.now(),userText='',flags={},mode='reply'}={}){
 const s=normalize(state,charId,now),on=sanitizeFlags(flags);
 if(on.relationship && mode==='reply'){
  for(const k of KEYS)s.relationship[k]=clamp(s.relationship[k]+clamp(result.signals?.[k],-2,2),0,100);
 }
 if(on.mood){
  s.mood.valence=clamp(s.mood.valence+clamp(result.signals?.valence,-2,2),-3,3);
  s.mood.energy=clamp(s.mood.energy+clamp(result.signals?.energy,-2,2)*4,0,100);
  s.mood.updatedAt=now;
 }
 const m=result.memory||{},ev=short(m.evidence,120),summary=short(m.text,150);
 if(on.memory && mode==='reply'&& userText && ev.length>=3 && userText.includes(ev)&&summary.length>=5 &&
    !s.memories.some(x=>x.text===summary)){
  s.memories.push({id:'m'+now+'-'+hash(summary),text:summary,evidence:ev,
    kind:['fact','event','preference'].includes(m.kind)?m.kind:'event',
    importance:clamp(m.importance||2,1,5),at:now});
  s.memories=s.memories.slice(-30);
 }
 if(on.relationship&&mode==='reply'&&result.event&&userText&&s.events.slice(-4).every(x=>x.text!==result.event)){
  s.events.push({text:short(result.event,120),at:now});s.events=s.events.slice(-16);
 }
 if(on.initiative)s.intent=short(result.intent,120);
 s.lastInteractionAt=now;
 if(mode==='nudge')s.lastNudgeAt=now;
 if(mode==='reply')s.turns++;
 s.revision=VERSION;
 return s;
}
module.exports={VERSION,FEATURES,DEFAULT_FLAGS,CASTS,PERSONAS,initialState,normalize,sanitizeFlags,build,parse,advance,splitBubbles};
