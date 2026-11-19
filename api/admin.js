// 開発者画面のAPI。全ユーザーの会話が読める画面なので、合言葉は必ず検証される。
// 合言葉の検証と全ユーザーデータへのアクセスは、Supabase側の関数 admin_call（supabase/admin.sql）が行う。
// このAPIはサービスキーを持たず、公開キー＋合言葉でその関数を呼ぶだけ。
// 使う環境変数: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / GEMINI_API_KEY
const Engine=require('../lib/engine');
const {reply}=require('../lib/reply');

const MEETS={
  first:'お店に初めて来たお客さんとしてLINEを交換した',
  nanpa:'街で偶然声をかけてLINEを交換した',
  match:'マッチングアプリでマッチして連絡を始めた'
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[a-z0-9][a-z0-9_-]{1,23}$/;
const ICON=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// ---- 失敗回数の制限（インスタンス単位。DB側にも全体のロックがある）
const fails=new Map();
function blocked(ip){const f=fails.get(ip);return !!f&&Date.now()-f.start<600000&&f.count>=8}
function fail(ip){
  const now=Date.now();
  let f=fails.get(ip);
  if(!f||now-f.start>=600000){f={start:now,count:0};fails.set(ip,f)}
  f.count++;
  if(fails.size>2000)fails.clear();
}

// ---- Supabase: admin_call（合言葉はDBで検証される）
class AdminError extends Error{constructor(code,msg){super(msg||code);this.code=code}}
async function rpc(pw,action,args={}){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new AdminError('NO_CONFIG','Supabaseの接続設定がありません');
  const res=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/admin_call',{method:'POST',
    headers:{apikey:key,'Content-Type':'application/json'},
    body:JSON.stringify({pw,action,args}),signal:AbortSignal.timeout(10000)});
  const text=await res.text();
  let j=null;try{j=text?JSON.parse(text):null}catch{}
  if(res.status===404||j?.code==='PGRST202')throw new AdminError('NO_TABLE','必要なDB関数がありません。supabase/admin.sql を適用してください');
  if(!res.ok)throw new AdminError('DB',j?.message||('Supabase '+res.status));
  if(j&&!Array.isArray(j)&&j.error){
    const m={AUTH:'合言葉が違います',LOCKED:'失敗が続いたため、しばらく待ってください',NOT_CONFIGURED:'合言葉がまだ登録されていません'};
    throw new AdminError(j.error,m[j.error]||j.error);
  }
  return j;
}

// ---- キャストの検証
const str=(v,max)=>String(v??'').trim().slice(0,max);
const list=(v,n,max)=>(Array.isArray(v)?v:[]).map(x=>str(x,max)).filter(Boolean).slice(0,n);
function cleanCast(input,{needId=true}={}){
  if(!input||typeof input!=='object')throw new Error('キャストのデータがありません');
  const id=str(input.id,24);
  if(needId&&!ID.test(id))throw new Error('IDは英小文字・数字・-・_ の2〜24文字にしてください');
  const c={
    name:str(input.name,20),kana:str(input.kana,30),job:str(input.job,20),store:str(input.store,40),
    catch:str(input.catch,80),status:str(input.status,60),tags:list(input.tags,5,12),
    tone:str(input.tone,300),values:str(input.values,300),want:str(input.want,300),style:str(input.style,300),
    life:list(input.life,12,60),examples:list(input.examples,6,200)
  };
  if(!c.name)throw new Error('名前を入れてください');
  const icon=String(input.icon||'');
  if(icon){
    if(icon.length>90000||!ICON.test(icon))throw new Error('アイコン画像が大きすぎるか、形式が違います');
    c.icon=icon;
  }else c.icon='';
  return {id,data:c};
}
const castView=c=>({id:c.id,name:c.name,kana:c.kana,job:c.job,store:c.store,catch:c.catch,status:c.status,
  tags:c.tags||[],tone:c.tone,values:c.values,want:c.want,style:c.style,life:c.life||[],examples:c.examples||[],icon:c.icon||''});

async function refreshCasts(pw){
  try{
    const rows=await rpc(pw,'casts.list');
    Engine.setCasts(rows);
    return {rows,missing:false};
  }catch(e){
    if(e.code==='AUTH'||e.code==='LOCKED')throw e;
    Engine.setCasts([]);
    return {rows:[],missing:true};
  }
}

// ---- ユーザーの状態から会話の材料を取り出す
async function loadState(pw,userId){
  if(!UUID.test(String(userId)))throw new Error('ユーザーIDが不正です');
  const rows=await rpc(pw,'user.get',{id:userId});
  if(!rows?.length)throw new Error('ユーザーが見つかりません');
  return rows[0];
}
function summarize(row){
  const s=row.state||{};
  const friends=(s.friends||[]).map(f=>{
    const m=(s.msgs?.[f.id]||[]);
    const last=m[m.length-1];
    return {id:f.id,charId:f.charId,meet:f.meet,aff:f.aff,unread:f.unread||0,count:m.length,
      last:last?{from:last.from,text:String(last.text||'').slice(0,60),ts:last.ts||0}:null};
  });
  return {userId:row.user_id,name:s.me?.name||'',gender:s.me?.gender||'',updatedAt:row.updated_at,friends};
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(Number(req.headers['content-length']||0)>400000)return res.status(413).json({error:'Request too large'});
  const ip=String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||'unknown';
  if(blocked(ip))return res.status(429).json({error:'失敗が続いたため、10分ほど待ってください'});
  const pw=String(req.headers['x-admin-password']||'').slice(0,200);
  const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body||{};
  try{
    const C=(a,args)=>rpc(pw,a,args);
    switch(body.action){
      case 'status':{
        await C('status');
        return res.json({ok:true,serviceKey:true,gemini:!!process.env.GEMINI_API_KEY,castsTable:true,pushesTable:true});
      }
      case 'casts.list':{
        const {rows,missing}=await refreshCasts(pw);
        const edited=new Set(rows.filter(r=>!r.deleted).map(r=>r.id));
        const removed=rows.filter(r=>r.deleted).map(r=>r.id);
        const builtin=new Set(Object.keys(Engine.PERSONAS));
        return res.json({ok:true,tableMissing:missing,removed,
          casts:Object.values(Engine.CASTS).map(c=>({...castView(c),builtin:builtin.has(c.id),edited:edited.has(c.id)}))});
      }
      case 'casts.save':{
        const {id,data}=cleanCast(body.cast);
        await C('casts.save',{id,data});
        return res.json({ok:true,id});
      }
      case 'casts.delete':{
        const id=str(body.id,24);
        if(!ID.test(id))throw new Error('IDが不正です');
        await C('casts.delete',{id});
        return res.json({ok:true});
      }
      case 'casts.reset':{ // 変更・削除を取り消して、組み込みの初期状態に戻す（独自に追加したAIは完全に消える）
        const id=str(body.id,24);
        if(!ID.test(id))throw new Error('IDが不正です');
        await C('casts.reset',{id});
        return res.json({ok:true});
      }
      case 'users.list':{
        const rows=await C('users.list');
        return res.json({ok:true,users:(rows||[]).map(summarize)});
      }
      case 'convo':{
        const row=await loadState(pw,body.userId);
        const s=row.state||{};
        await refreshCasts(pw);
        return res.json({ok:true,user:summarize(row),me:s.me||{},msgs:s.msgs||{},
          actors:s.engine?.actors||{},
          casts:Object.fromEntries(Object.values(Engine.CASTS).map(c=>[c.id,{name:c.name,icon:c.icon||''}]))});
      }
      case 'try':{ // 下書きの人格で試し話。保存はしない
        if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:'GEMINI_API_KEY が未設定です'});
        const {data}=cleanCast({...body.cast,id:'draft'},{needId:false});
        const meetKey=Object.hasOwn(MEETS,body.meetKey)?body.meetKey:'first';
        const history=(Array.isArray(body.history)?body.history:[]).slice(-24).map(m=>({from:m?.from==='ai'?'ai':'me',text:str(m?.text,1200)})).filter(m=>m.text);
        const initial=history.length===0;
        const charId='draft-test';
        Engine.CASTS[charId]=Engine.complete({...data,id:charId});
        try{
          const out=await reply({apiKey:process.env.GEMINI_API_KEY,meetText:MEETS[meetKey],cast:Engine.CASTS[charId],
            body:{charId,meet:meetKey,affinity:0,userName:str(body.userName||'テスト',20),userGender:body.userGender==='female'?'female':'male',
              initialGreeting:initial,mode:'reply',history,engineState:body.engineState||null,engineSettings:{}}});
          return res.status(out.status).json(out.json);
        }finally{delete Engine.CASTS[charId];}
      }
      case 'push.draft':{ // そのユーザーの実際の会話をもとに、AIの言葉で連絡文を下書きする
        if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:'GEMINI_API_KEY が未設定です'});
        const row=await loadState(pw,body.userId),s=row.state||{};
        await refreshCasts(pw);
        const charId=str(body.charId,24);
        const cast=Object.hasOwn(Engine.CASTS,charId)?Engine.CASTS[charId]:null;
        const f=(s.friends||[]).find(x=>x.charId===charId);
        if(!cast||!f)throw new Error('そのユーザーはこのAIと友達ではありません');
        const history=(s.msgs?.[f.id]||[]).slice(-24).map(m=>({from:m.from==='ai'?'ai':'me',text:str(m.text,1200)})).filter(m=>m.text);
        const out=await reply({apiKey:process.env.GEMINI_API_KEY,meetText:MEETS[f.meet]||MEETS.first,cast,
          body:{charId,meet:Object.hasOwn(MEETS,f.meet)?f.meet:'first',affinity:Number(f.aff)||0,userName:str(s.me?.name||'あなた',20),
            userGender:s.me?.gender==='female'?'female':'male',initialGreeting:history.length===0,
            mode:history.length?'nudge':'reply',history,engineState:s.engine?.actors?.[f.id]||null,
            engineSettings:{styleNote:'開発者からの指示。この内容に自然に触れる一通を書く: '+str(body.instruction,200)}}});
        return res.status(out.status).json(out.status===200?{ok:true,messages:out.json.messages}:out.json);
      }
      case 'push.create':{
        if(!UUID.test(String(body.userId)))throw new Error('ユーザーIDが不正です');
        const charId=str(body.charId,24);
        const lines=String(body.text||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,6).map(x=>x.slice(0,300));
        if(!ID.test(charId)||!lines.length)throw new Error('AIと本文を入れてください');
        const at=body.deliverAt?new Date(body.deliverAt):new Date();
        if(Number.isNaN(at.getTime()))throw new Error('日時が不正です');
        await C('push.create',{user_id:body.userId,char_id:charId,text:lines.join('\n'),deliver_at:at.toISOString()});
        return res.json({ok:true});
      }
      case 'push.list':{
        const rows=await C('push.list',{user_id:body.userId&&UUID.test(String(body.userId))?body.userId:null});
        return res.json({ok:true,pushes:rows||[]});
      }
      case 'push.cancel':{
        if(!UUID.test(String(body.id)))throw new Error('IDが不正です');
        await C('push.cancel',{id:body.id});
        return res.json({ok:true});
      }
      default:return res.status(400).json({error:'不明な操作です'});
    }
  }catch(e){
    if(e.code==='AUTH'){fail(ip);return res.status(401).json({error:e.message,code:'AUTH'})}
    if(e.code==='LOCKED')return res.status(429).json({error:e.message,code:e.code});
    console.warn('admin error',body?.action,String(e?.message||'').slice(0,120));
    return res.status(e instanceof AdminError?503:400).json({error:String(e?.message||'エラー').slice(0,200),code:e.code});
  }
};
