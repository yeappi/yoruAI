// One authenticated Gemini call per reply. The Gemini key never reaches the browser.
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
    if (!cast || !meet || !Array.isArray(history) || history.length < 1 ||
        history.length > 30) return res.status(400).json({error:'会話データが不正です'});
    const name = String(body.userName || 'あなた').slice(0,40).replace(/[\r\n]/g,' ');
    const gender = body.userGender === 'female' ? '女性' : '男性';
    const affinity = Math.max(0, Math.min(100, Number(body.affinity) || 0));
    const rows = history.filter(m => m && ['me','ai'].includes(m.from) &&
      typeof m.text === 'string' && m.text.trim()).slice(-24);
    if (!rows.length || rows.some(m=>m.text.length > 1200)) return res.status(400).json({error:'メッセージが長すぎます'});
    let contents = rows.map(m=>({role:m.from === 'me' ? 'user':'model',parts:[{text:m.text}]}));
    // Gemini requires the history to begin with a user turn.
    if (contents[0].role !== 'user') contents.unshift({role:'user',parts:[{text:'（LINEを交換した）'}]});
    const system = [
      'あなたは日本語の架空の夜職キャラクターとして、LINEで自然に雑談する。',
      '人物名: ' + cast.name + '（' + cast.kana + '）。職業: ' + cast.job + '。架空の店名: ' + cast.store,
      '性格・口調: ' + cast.tone.replaceAll('{name}', name),
      '相手: ' + name + '（' + gender + '）。出会い方: ' + meet,
      '現在の関係性の目安: 親密度 ' + affinity + '/100。会話の内容と関係性に合わせて距離感を調整する。',
      '直近のやり取りを優先し、質問攻め・過度な共感・説明口調・箇条書きを避ける。',
      '返答は自然な口語で、原則1〜2個の短い吹き出し。吹き出しを分けるなら空行で区切る。',
      '相手の冗談や皮肉は文脈で理解し、キャラクターらしい意見と個性を保つ。',
      '過去に話していない出来事を「覚えている」と言わない。架空の店を実在の予約先として扱わない。',
      'AIか直接聞かれたら、AIキャラクターであると正直に答える。',
      '会話文だけを返す。'
    ].join('\n');
    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    if (!/^gemini-[a-z0-9.-]+$/.test(model)) return res.status(503).json({error:'モデル設定が不正です'});
    const generationConfig={temperature:0.9,maxOutputTokens:2048};
    if (model==='gemini-3.8-flash') generationConfig.thinkingConfig={thinkingLevel:'low'};
    const reply = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:system}]},
        contents,
        generationConfig
      }),
      signal:AbortSignal.timeout(35000)
    });
    if (!reply.ok) {
      const error = await reply.json().catch(()=>({}));
      const summary = String(error.error?.message || 'Google API error').slice(0,220);
      console.error('Gemini request failed',reply.status,summary);
      return res.status(502).json({error:'Gemini API エラー (' + reply.status + '): ' + summary});
    }
    const data = await reply.json();
    const output = data.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim();
    if (!output) return res.status(502).json({error:'Geminiから返信が返りませんでした'});
    const messages = output.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean).slice(0,3);
    return res.status(200).json({messages,model});
  } catch(e) {
    console.error('Chat endpoint failed', e?.name || 'Error', String(e?.message||'').slice(0,160));
    return res.status(502).json({error:'サーバーとの通信に失敗しました'});
  }
};
