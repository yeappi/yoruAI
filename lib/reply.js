// Gemini呼び出しの本体。/api/chat（ユーザー）と /api/admin（開発者の試し話・連絡文案）で共有する。
// 認証や入力の検証は呼び出し側で行い、ここは「会話から返信とエンジン状態を作る」ことだけを担当する。
const Engine=require('./engine');
let primaryOverloadedUntil = 0;
const quotaBackoffUntil = new Map();
const R = (status, json) => ({status, json});

async function reply({body, cast, meetText, apiKey}) {
  const history = body.history;
  const name = String(body.userName || 'あなた').slice(0,40).replace(/[\r\n]/g,' ');
  const mode=body.mode==='nudge'?'nudge':body.mode==='compare'?'compare':'reply';
  const baseline=mode==='compare'&&body.baseline===true;
  const requested=body.engineSettings||{};
  const settings={flags:baseline?Object.fromEntries(Engine.FEATURES.map(k=>[k,false])):requested.flags,
    styleNote:baseline?'':String(requested.styleNote||'').slice(0,350)};
  const context=Engine.build({charId:body.charId,character:cast,meet:meetText,meetKey:body.meet,userName:name,
    userGender:body.userGender,history,initialGreeting:body.initialGreeting===true,
    mode,settings,state:body.engineState,profile:body.profile});
  const gender = body.userGender === 'female' ? '女性' : '男性';
  const affinity = Math.max(0, Math.min(100, Number(body.affinity) || 0));
  const initial = body.initialGreeting === true;
  const rows = history.filter(m => m && ['me','ai'].includes(m.from) &&
    typeof m.text === 'string' && m.text.trim()).slice(-24);
  if ((!initial && !rows.length) || rows.some(m=>m.text.length > 1200)) return R(400,{error:'メッセージが長すぎます'});
  // Merge consecutive messages into one logical Gemini turn, preserving line breaks.
  // One waiting batch generates one reply, not one reply per user bubble.
  let contents = initial
    ? [{role:'user',parts:[{text:'（出会った直後に連絡先を交換した。相手からはまだ何も届いていない。）'}]}]
    : [];
  if(!initial){
    for(const m of rows){
      const role=m.from==='me'?'user':'model';
      const previous=contents[contents.length-1];
      if(previous?.role===role)previous.parts[0].text+='\n'+m.text;
      else contents.push({role,parts:[{text:m.text}]});
    }
  }
  // Gemini requires the history to begin with a user turn.
  if (contents[0].role !== 'user') contents.unshift({role:'user',parts:[{text:'（LINEを交換した）'}]});
  const system=context.system;
  // Primary Flash model first. On temporary server overload, retry briefly,
  // then try alternative free-tier models without changing the conversation.
  const primary = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!/^gemini-[a-z0-9.-]+$/.test(primary)) {
    return R(503,{error:'モデル設定が不正です'});
  }
  const fallbackModels = ['gemini-3.1-flash-lite','gemini-3.5-flash-lite']
    .filter(m => m !== primary);
  const available = model => Date.now() >= (quotaBackoffUntil.get(model) || 0);
  const attempts = [
    ...(Date.now() < primaryOverloadedUntil ? [] : [{model:primary,attempt:1}]),
    ...fallbackModels.map(model=>({model,attempt:1}))
  ].filter(({model}) => available(model));
  let lastFailure = null;
  for (const {model,attempt} of attempts) {
    const generationConfig = {temperature:0.85,maxOutputTokens:2048,responseMimeType:'application/json'};
    let reply;
    try {
      reply = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) + ':generateContent', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        body:JSON.stringify({
          systemInstruction:{parts:[{text:system}]},
          contents,
          generationConfig
        }),
        signal:AbortSignal.timeout(12000)
      });
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      console.warn('Gemini transport error',model,attempt,timeout?'timeout':'network');
      if (!timeout) {
        return R(502,{error:'Geminiとの通信に失敗しました。もう一度送信してください。'});
      }
      lastFailure={model,status:504};
      continue;
    }
    if (!reply.ok) {
      const errJson=await reply.json().catch(()=>({}));
      const details=String(errJson.error?.message||'Google API error').slice(0,160);
      console.warn('Gemini failure',model,attempt,reply.status,details);
      lastFailure={model,status:reply.status};
      if ([500,502,503,504].includes(reply.status)) {
        if (model === primary) primaryOverloadedUntil=Date.now()+30000;
        continue;
      }
      // If a fallback model is unavailable or forbidden for this API project,
      // try the next fallback. The original model's permission errors should
      // remain explicit rather than being disguised as capacity issues.
      if (model !== primary && [403,404].includes(reply.status)) continue;
      if (reply.status === 429) {
        // Quota limits can differ by model. Try the remaining models once,
        // without repeatedly probing a model that has just returned 429.
        quotaBackoffUntil.set(model,Date.now()+10*60*1000);
        continue;
      }
      return R(502,{error:'Gemini API エラー ('+reply.status+'): '+details,model});
    }
    const data=await reply.json();
    const output=data.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim();
    if (!output) {
      return R(502,{error:'Geminiから返信が返りませんでした',model});
    }
    let result;
    try {result=Engine.parse(output);}
    catch(e) {console.warn('Gemini parse failed',model,e.message);return R(502,{error:'返信形式を解析できませんでした'});}
    const lastUserBatch=[];
    for(let i=rows.length-1;i>=0&&rows[i].from==='me';i--)lastUserBatch.unshift(rows[i].text);
    const userText=lastUserBatch.join('\n');
    const nextState=mode==='compare'?context.state:
      Engine.advance(context.state,result,{charId:body.charId,now:Date.now(),
        userText,flags:context.flags,mode:body.initialGreeting?'greeting':mode});
    const profile=mode==='compare'?Engine.normalizeProfile(body.profile):
      Engine.advanceProfile(body.profile,result,{userText,now:Date.now(),flags:context.flags});
    let messages=Engine.enforce(result.messages,profile.requests);
    // やぴだけ、直近の実際の吹き出し数を保存し「笑」と句読点の連発を抑える。
    if(body.charId==='yapi'){
      const styled=Engine.enforceYapiStyle(messages,context.state.styleCadence);
      messages=styled.messages;
      if(mode!=='compare')nextState.styleCadence=styled.styleCadence;
    }
    console.info('Gemini reply',model,Engine.VERSION,model===primary?'primary':'fallback');
    return R(200,{messages:messages.length?messages:result.messages,model,fallback:model!==primary,
      engineVersion:Engine.VERSION,engineState:nextState,profile,
      metadata:{structured:result.structured,features:context.flags,mode}});
  }
  console.error('Gemini models unavailable',lastFailure);
  const exhausted=lastFailure?.status===429||attempts.length===0;
  return R(exhausted?429:503,{
    error:exhausted?'現在のGeminiの利用枠に空きがありません。':'現在Geminiが混雑しています。',
    code:exhausted?'GEMINI_QUOTA_UNAVAILABLE':'GEMINI_CAPACITY_UNAVAILABLE'
  });
}
module.exports = {reply};
