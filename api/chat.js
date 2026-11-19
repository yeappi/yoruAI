// One authenticated Gemini call for reply and provisional state inference.
const Engine=require('../lib/engine');
const CASTS = {
  kokoa: {name:'心愛',kana:'ここあ',job:'キャバ嬢',store:'北新地 Club LUNA',tone:'甘めのタメ口。語尾に「〜だよぉ」「♡」をよく使う。相手をたくさん褒める。寂しがり。たまにお店に誘う。'},
  rena: {name:'玲奈',kana:'れな',job:'ラウンジ',store:'北新地 Lounge 月白',tone:'丁寧語ベースのクールな大人の女性。感情は控えめだが、時々本音がこぼれる。'},
  yume: {name:'ゆめ',kana:'ゆめ',job:'コンカフェ',store:'日本橋 ねこみみ喫茶',tone:'元気なコンカフェキャスト。語尾に「にゃ」。相手を「{name}さま」と呼ぶ。テンション高め。'},
  ren: {name:'蓮',kana:'れん',job:'ホスト',store:'ミナミ CLUB ARIA',tone:'優しく甘い王子系ホスト。相手を「君」と呼ぶ。まっすぐ好意を伝える。会いたがる。'},
  nagi: {name:'凪',kana:'なぎ',job:'バーテンダー',store:'中崎町 Bar 凪',tone:'落ち着いた男性バーテンダー。丁寧語。短く静かに返す。お酒や夜の比喩を時々使う。'},
  mao: {name:'真央',kana:'まお',job:'ガールズバー',store:'京橋 Girls Bar Peach',tone:'サバサバした関西弁の女の子。ツッコミ多め。照れると雑になる。相手を「あんた」と呼ぶこともある。'}
};
const MEETS = {
  first:'お店に初めて来たお客さんとしてLINEを交換した',
  nanpa:'街で偶然声をかけてLINEを交換した',
  match:'マッチングアプリでマッチして連絡を始めた'
};
// A warm instance throttle is only a trial-level safeguard, not a distributed quota.
const throttle = new Map();
let primaryOverloadedUntil = 0;
const quotaBackoffUntil = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  if (Number(req.headers['content-length'] || 0) > 100000) return res.status(413).json({error:'Request too large'});
  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!apiKey || !supabaseUrl || !supabaseKey) return res.status(503).json({error:'サーバー設定が不足しています'});
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token.length > 5000) return res.status(401).json({error:'ログインが必要です'});
  try {
    const who = await fetch(supabaseUrl.replace(/\/$/,'') + '/auth/v1/user', {
      headers:{apikey:supabaseKey,Authorization:'Bearer ' + token},
      signal:AbortSignal.timeout(10000)
    });
    if (!who.ok) return res.status(401).json({error:'認証の有効期限が切れています'});
    const user = await who.json();
    if (!user.id) return res.status(401).json({error:'認証できません'});
    const now = Date.now();
    const state = throttle.get(user.id) || {start:now,count:0};
    if (now - state.start >= 60000) {state.start=now;state.count=0;}
    if (++state.count > 25) return res.status(429).json({error:'少し時間をおいてから送信してください'});
    throttle.set(user.id,state);
    if (throttle.size > 5000) throttle.clear();

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const cast = CASTS[body.charId];
    const meet = MEETS[body.meet];
    const history = body.history;
    if (!cast || !meet || !Array.isArray(history) || (!body.initialGreeting && history.length < 1) ||
        history.length > 30) return res.status(400).json({error:'会話データが不正です'});
    const name = String(body.userName || 'あなた').slice(0,40).replace(/[\r\n]/g,' ');
    const mode=body.mode==='nudge'?'nudge':body.mode==='compare'?'compare':'reply';
    const baseline=mode==='compare'&&body.baseline===true;
    const requested=body.engineSettings||{};
    const settings={flags:baseline?Object.fromEntries(Engine.FEATURES.map(k=>[k,false])):requested.flags,
      styleNote:baseline?'':String(requested.styleNote||'').slice(0,350)};
    const context=Engine.build({charId:body.charId,character:cast,meet:MEETS[body.meet],userName:name,
      userGender:body.userGender,history,initialGreeting:body.initialGreeting===true,
      mode,settings,state:body.engineState});
    const gender = body.userGender === 'female' ? '女性' : '男性';
    const affinity = Math.max(0, Math.min(100, Number(body.affinity) || 0));
    const initial = body.initialGreeting === true;
    const rows = history.filter(m => m && ['me','ai'].includes(m.from) &&
      typeof m.text === 'string' && m.text.trim()).slice(-24);
    if ((!initial && !rows.length) || rows.some(m=>m.text.length > 1200)) return res.status(400).json({error:'メッセージが長すぎます'});
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
      return res.status(503).json({error:'モデル設定が不正です'});
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
      if (model === 'gemini-3.8-flash') generationConfig.thinkingConfig={thinkingLevel:'low'};
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
          return res.status(502).json({error:'Geminiとの通信に失敗しました。もう一度送信してください。'});
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
        return res.status(502).json({error:'Gemini API エラー ('+reply.status+'): '+details,model});
      }
      const data=await reply.json();
      const output=data.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim();
      if (!output) {
        return res.status(502).json({error:'Geminiから返信が返りませんでした',model});
      }
      let result;
      try {result=Engine.parse(output);}
      catch(e) {console.warn('Gemini parse failed',model,e.message);return res.status(502).json({error:'返信形式を解析できませんでした'});}
      const lastUserBatch=[];
      for(let i=rows.length-1;i>=0&&rows[i].from==='me';i--)lastUserBatch.unshift(rows[i].text);
      const userText=lastUserBatch.join('\n');
      const nextState=mode==='compare'?context.state:
        Engine.advance(context.state,result,{charId:body.charId,now:Date.now(),
          userText,flags:context.flags,mode:body.initialGreeting?'greeting':mode});
      console.info('Gemini reply',model,Engine.VERSION,model===primary?'primary':'fallback');
      return res.status(200).json({messages:result.messages,model,fallback:model!==primary,
        engineVersion:Engine.VERSION,engineState:nextState,
        metadata:{structured:result.structured,features:context.flags,mode}});
    }
    console.error('Gemini models unavailable',lastFailure);
    const exhausted=lastFailure?.status===429||attempts.length===0;
    return res.status(exhausted?429:503).json({
      error:exhausted?'現在のGeminiの利用枠に空きがありません。':'現在Geminiが混雑しています。',
      code:exhausted?'GEMINI_QUOTA_UNAVAILABLE':'GEMINI_CAPACITY_UNAVAILABLE'
    });
  } catch(e) {
    console.error('Chat endpoint failed', e?.name || 'Error', String(e?.message||'').slice(0,160));
    return res.status(502).json({error:'サーバーとの通信に失敗しました'});
  }
};
