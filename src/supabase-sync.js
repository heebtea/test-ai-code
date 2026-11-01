import { validateRemote } from './private-sync.js';

// Only public publishable keys belong in this browser. No refresh/access token is persisted.
export function validateSyncConfig(config) {
  const url=new URL(config.url);
  if(url.protocol!=='https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw Error('只接受你的 HTTPS Supabase 專案網址');
  if(typeof config.key!=='string' || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(config.key)) throw Error('請使用 sb_publishable_ 公開金鑰；不要填 secret 或 service_role');
  return {url:url.origin,key:config.key};
}
export function createSupabaseSync(config,{fetcher=globalThis.fetch,clock=()=>Date.now()}={}) {
  const {url,key}=validateSyncConfig(config);
  let session=null, generation=0;
  async function request(path,body,authenticated=true) {
    const g=generation;
    if(authenticated && (!session || session.expiresAt<=clock())) {session=null;throw Error('授權已失效，請重新登入；本機資料仍保留');}
    const headers={apikey:key,'Content-Type':'application/json'};
    if(authenticated) headers.Authorization='Bearer '+session.token;
    const response=await fetcher(url+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(g!==generation) throw Error('授權已停止');
    if(!response.ok) {
      if(response.status===401 || response.status===403) {session=null;throw Error('未授權或權限失效，請重新登入並檢查允許帳戶');}
      if(response.status===409) throw Error('另一裝置已修改，請重試以檢查衝突');
      throw Error('雲端請求失敗（'+response.status+'）；本機資料仍保留，可重試');
    }
    return response.status===204 ? null : response.json();
  }
  return {
    get owner(){return session ? url+'|'+session.user : null;},
    get authorized(){return !!session && session.expiresAt>clock();},
    async sendCode(email){await request('/auth/v1/otp',{email,create_user:false},false);},
    async verifyCode(email,token){
      const r=await request('/auth/v1/verify',{email,token,type:'email'},false);
      if(!r?.access_token || !r.user?.id || !Number.isFinite(r.expires_in)) throw Error('登入回應無效');
      session={token:r.access_token,user:r.user.id,expiresAt:clock()+r.expires_in*1000};
    },
    stop(){generation++;session=null;},
    async revoke(){try{await request('/auth/v1/logout?scope=global',{});}finally{generation++;session=null;}},
    async list(){
      // RPC returns one JSON array; no PostgREST 1000-row truncation.
      return validateRemote(await request('/rest/v1/rpc/sbl_list',{}));
    },
    async cas({id,expected,record,deleted}){
      const r=await request('/rest/v1/rpc/sbl_cas',{p_id:id,p_expected:expected,p_record:record,p_deleted:deleted});
      validateRemote([r]);return r;
    },
  };
}
