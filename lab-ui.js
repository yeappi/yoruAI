/* Conversation Lab: controls for experimental engine settings and comparison.
   This is loaded before index.html's application script, and only invoked after boot. */
(function(){
'use strict';
const lab={selected:'mao',comparison:null,busy:false};
const escLab=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=sel=>document.querySelector(sel);
function open(){
  ensureEngine();
  lab.selected=S.friends[0]?.id||lab.selected;
  render();
  el('#lab').classList.add('open');
}
function close(){el('#lab').classList.remove('open');lab.comparison=null}
function flagRow(key,label,settings){
  return '<div class="lab-row"><span class="lab-label">'+label+'</span>'+
    '<button class="lab-switch '+(settings.flags[key]?'on':'')+
    '" data-act="lab-toggle" data-id="'+key+'">'+(settings.flags[key]?'有効':'無効')+'</button></div>';
}
function scoreRow(key,label,rel){
  const v=rel[key];
  return '<div class="lab-score"><span>'+label+'</span><span>'+
    (typeof v==='number'?v:'—')+'</span><span class="lab-bar"><i style="width:'+
    Math.max(0,Math.min(100,v||0))+'%"></i></span></div>';
}
function render(){
 const e=ensureEngine(),id=lab.selected,c=charById(id)||CHARS[0],state=actorState(id);
 if(!c)return;
 const rel=state?.relationship||{},m=state?.mood,cv=lab.comparison;
 const labels={closeness:'親しさ',trust:'信頼',attraction:'恋愛的好意',comfort:'気楽さ',tension:'わだかまり'};
 const recent=e.logs.filter(x=>x.fid===id).slice(0,5);
 let html='<div class="lhd"><button class="ib" data-act="close-lab" aria-label="戻る">←</button>'+
   '<div class="ttl">会話ラボ<small>'+escLab(Backend.engineVersion)+' / 設定 v'+e.settings.revision+
   '</small></div><div style="width:44px"></div></div><div class="lab-body">';
 html+='<div class="lab-panel"><h3>対象キャスト</h3><select class="lab-entry" id="lab-cast">'+
  CHARS.map(x=>'<option value="'+x.id+'" '+(x.id===id?'selected':'')+'>'+escLab(x.name)+'（'+escLab(x.job)+'）</option>').join('')+
  '</select><p>キャストを切り替えても会話は消えません。</p></div>';
 html+='<div class="lab-panel"><h3>会話エンジンの5要素</h3>'+
  Object.entries(ENGINE_FEATURES).map(([k,v])=>flagRow(k,v,e.settings)).join('')+
  '<p>OFFにすると今後のコンテキストや状態更新から外れます。保存済みデータは保持します。</p>'+
  '<h3 style="margin-top:16px">追加の改善指示</h3>'+
  '<textarea class="lab-entry" id="lab-style-note" rows="3" maxlength="350" placeholder="例：褒めるよりツッコミを増やす">'+escLab(e.settings.styleNote)+'</textarea>'+
  '<p>次のGeminiへの指示に反映されます。編集後は自動保存。</p></div>';
 html+='<div class="lab-panel"><h3>'+escLab(c.name)+'の内部状態（仮実装）</h3>'+
  Object.entries(labels).map(([k,v])=>scoreRow(k,v,rel)).join('')+
  '<div class="lab-score"><span>現在の気分</span><span>'+(m?m.valence+'/3':'未生成')+'</span></div>'+
  '<div class="lab-score"><span>元気</span><span>'+(m?m.energy+'/100':'未生成')+'</span></div>'+
  '<p>今日の気分の背景：'+escLab(m?.reason||'会話すると状態が生成されます')+'</p>'+
  '<p>会話回数：'+(state?.turns||0)+' / 記憶：'+(state?.memories?.length||0)+
  ' / 関係上の出来事：'+(state?.events?.length||0)+'</p>';
 if(state?.memories?.length)html+=(state.memories||[]).slice(-6).reverse().map(x=>
  '<div class="lab-trace">'+escLab(x.text)+' <small>重要度'+x.importance+'</small>'+
  '<button class="lab-small" data-act="lab-forget" data-id="'+escLab(x.id)+'">削除</button></div>').join('');
 html+='</div>';
 html+='<div class="lab-panel"><h3>同条件でA/B比較</h3>'+
  '<p>A：5要素をOFFにした基準版　B：現在の設定。2回のAPI呼び出しで比較します。</p>'+
  '<form id="lab-compare-form"><textarea class="lab-entry" id="lab-scenario" rows="3" maxlength="400" placeholder="例：仕事辞めてきた笑">'+
  escLab(cv?.scenario||'今日仕事辞めてきた笑')+'</textarea>'+
  '<div class="lab-inline"><button type="submit" class="lab-primary" '+(lab.busy?'disabled':'')+'>'+
  (lab.busy?'比較中…':'A/Bを生成')+'</button></div></form>';
 if(cv?.error)html+='<p style="color:#c44">'+escLab(cv.error)+'</p>';
 if(cv?.a&&cv?.b){
  html+='<div class="lab-choice"><b>A 基準版（'+escLab(cv.a.model)+'）</b><p>'+escLab(cv.a.messages.join('\n'))+'</p></div>';
  html+='<div class="lab-choice"><b>B 改善版（'+escLab(cv.b.model)+'）</b><p>'+escLab(cv.b.messages.join('\n'))+'</p></div>';
  html+='<div class="lab-inline"><button class="lab-primary" data-act="lab-vote" data-id="A">Aが良い</button>'+
    '<button class="lab-primary" data-act="lab-vote" data-id="B">Bが良い</button>'+
    '<button class="lab-small" data-act="lab-vote" data-id="tie">同等</button></div>';
 }
 html+='</div>';
 html+='<div class="lab-panel"><h3>返信ログの評価</h3>';
 html+=recent.length?recent.map(x=>
  '<div class="lab-trace"><small>'+new Date(x.at).toLocaleString('ja-JP')+'・'+escLab(x.model)+'・設定v'+x.revision+
  '・'+x.elapsedMs+'ms</small><p>'+escLab(x.input)+' → '+escLab(x.output)+'</p>'+
  '<div class="lab-inline"><button class="lab-small" data-act="lab-rate" data-id="'+escLab(x.id)+
  '" data-score="1">'+(x.rating===1?'✓ ':'')+'良い</button>'+
  '<button class="lab-small" data-act="lab-rate" data-id="'+escLab(x.id)+
  '" data-score="-1">'+(x.rating===-1?'✓ ':'')+'悪い</button></div></div>').join(''):
  '<p>まだ返信ログはありません。</p>';
 html+='</div><div class="lab-panel"><h3>改善記録</h3><p>A/B評価済み：'+e.evaluations.length+'件</p>'+
 e.evaluations.slice(0,5).map(x=>'<div class="lab-trace"><small>'+
  new Date(x.at).toLocaleString('ja-JP')+'・設定v'+x.revision+'</small>'+
  '<p>'+escLab(x.scenario)+' → '+escLab(x.winner)+'</p></div>').join('')+'</div></div>';
 el('#lab').innerHTML=html;
 el('#lab-cast').onchange=ev=>{lab.selected=ev.target.value;lab.comparison=null;render()};
 el('#lab-compare-form').onsubmit=ev=>{ev.preventDefault();compare()};
 el('#lab-style-note').oninput=ev=>{
  const e=ensureEngine();
  e.settings.styleNote=ev.target.value.slice(0,350);
  e.settings.revision+=1;
  save();
 };
}
function toggle(key){
 if(!(key in ENGINE_FEATURES))return;
 const e=ensureEngine();
 e.settings.flags[key]=!e.settings.flags[key];
 e.settings.revision++;
 save();render();
}
function rate(id,value){
 const e=ensureEngine(),log=e.logs.find(x=>x.id===id);
 if(!log)return;
 log.rating=value;
 save();render();
}
function forget(id){
 const s=actorState(lab.selected);
 if(!s||!Array.isArray(s.memories))return;
 s.memories=s.memories.filter(m=>m.id!==id);
 save();render();
}
async function compare(){
 if(lab.busy||!Backend.ready)return;
 const scenario=el('#lab-scenario')?.value.trim();
 if(!scenario){toast('入力が必要です');return}
 const id=lab.selected,f=friend(id)||{id,charId:id,meet:'match',aff:10};
 const history=(S.msgs[id]||[]).filter(x=>x.from==='ai'||x.from==='me').slice(-18);
 history.push({from:'me',text:scenario});
 lab.busy=true;lab.comparison={scenario};render();
 try{
  const a=await requestEngine(f,history,{mode:'compare',baseline:true});
  const b=await requestEngine(f,history,{mode:'compare',baseline:false});
  lab.comparison={a,b,scenario,at:Date.now(),revision:ensureEngine().settings.revision,charId:id};
 }catch(e){lab.comparison={scenario,error:String(e.message||e)}}
 finally{lab.busy=false;render()}
}
function vote(winner){
 const cv=lab.comparison;if(!cv?.a||!cv?.b)return;
 const e=ensureEngine();
 e.evaluations.unshift({at:Date.now(),charId:cv.charId,scenario:cv.scenario,
  winner,revision:cv.revision,version:Backend.engineVersion,
  responseA:cv.a.messages.join(' / '),responseB:cv.b.messages.join(' / '),
  modelA:cv.a.model,modelB:cv.b.model,flags:{...e.settings.flags}});
 e.evaluations=e.evaluations.slice(0,50);
 save();lab.comparison=null;render();toast('評価を保存しました');
}
window.LabUI={open,close,toggle,rate,forget,vote,compare};
})();
