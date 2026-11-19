// One authenticated Gemini call for reply and provisional state inference.
const Engine=require('../lib/engine');
const {reply}=require('../lib/reply');
const {loadCasts}=require('../lib/castdb');
const MEETS = {
  first:'お店に初めて来たお客さんとしてLINEを交換した',
  nanpa:'街で偶然声をかけてLINEを交換した',
  match:'マッチングアプリでマッチして連絡を始めた'
};
// A warm instance throttle is only a trial-level safeguard, not a distributed quota.
const throttle = new Map();
const buckets = new Map();
function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { b = {start:now,count:0}; buckets.set(key,b); }
  if (buckets.size > 10000) { for (const [k,v] of buckets) if (now - v.start >= windowMs) buckets.delete(k); if (buckets.size > 10000) buckets.clear(); }
  return ++b.count <= limit;
}

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
    // 匿名アカウントは無限に作れるので、アカウント単位だけでは足りない。IP単位と全体にも上限をかける。
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (!hit('ip:'+ip, 60, 60000) || !hit('all', 400, 60000) || !hit('day:'+user.id, 600, 86400000))
      return res.status(429).json({error:'少し時間をおいてから送信してください'});

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    await loadCasts({url:supabaseUrl,key:supabaseKey,token});
    const cast = Object.hasOwn(Engine.CASTS, body.charId) ? Engine.CASTS[body.charId] : null;
    const meet = Object.hasOwn(MEETS, body.meet) ? MEETS[body.meet] : null;
    const history = body.history;
    if (!cast || !meet || !Array.isArray(history) || (!body.initialGreeting && history.length < 1) ||
        history.length > 30) return res.status(400).json({error:'会話データが不正です'});
    const out = await reply({body, cast, meetText: meet, apiKey});
    return res.status(out.status).json(out.json);
  } catch(e) {
    console.error('Chat endpoint failed', e?.name || 'Error', String(e?.message||'').slice(0,160));
    return res.status(502).json({error:'サーバーとの通信に失敗しました'});
  }
};
