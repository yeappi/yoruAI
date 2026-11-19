// 開発者画面で編集されたキャスト（Supabase public.casts）を読み、エンジンに反映する。
// テーブルが無い・読めない場合は組み込みのキャストだけで動き続ける（会話を止めない）。
const Engine=require('./engine');
let loadedAt=0,inflight=null;
const TTL=15000;

async function fetchRows({url,key,token}){
  const res=await fetch(url.replace(/\/$/,'')+'/rest/v1/casts?select=id,data,deleted',{
    headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw new Error('casts '+res.status);
  return res.json();
}
// token: ユーザーのJWT（RLSで読み取りを許可）か、管理側の service role key。
async function loadCasts(opts,{force=false}={}){
  if(!force&&Date.now()-loadedAt<TTL)return;
  if(inflight)return inflight;
  inflight=(async()=>{
    try{Engine.setCasts(await fetchRows(opts));}
    catch(e){console.warn('casts load skipped',String(e.message||e).slice(0,80));}
    finally{loadedAt=Date.now();inflight=null;}
  })();
  return inflight;
}
module.exports={loadCasts,fetchRows};
