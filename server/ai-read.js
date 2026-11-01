// Deployable handler contract, NOT an OAuth server or a connected ChatGPT app.
// verifyGrant must validate signature, issuer, audience, expiry AND live revocation.
// It supplies owner/scopes/date/category limits from trusted server-side grants.
// readRows must select that owner's already-synced data, never accept owner from input.
import { makeSnapshot, DEFAULT_SHARE_TYPES } from '../src/ai-share.js';
import { validate } from '../src/data.js';
export function createAiReadHandler({verifyGrant,readRows,clock=()=>Date.now()}) {
  if(typeof verifyGrant!=='function' || typeof readRows!=='function') throw Error('Trusted authorization and storage adapters required');
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===401?{'WWW-Authenticate':'Bearer realm="second-brain", scope="records:read"'}:{})}});
  return async request=>{
    if(request.method!=='GET') return respond(405,{error:'read_only'});
    const url=new URL(request.url);
    if(url.pathname!=='/records') return respond(404,{error:'not_found'});
    let grant;
    try {grant=await verifyGrant(request.headers.get('Authorization'));} catch {return respond(401,{error:'unauthorized'});}
    if(!grant?.owner || grant.revoked || !Number.isFinite(grant.expiresAt) || grant.expiresAt<=clock() || !grant.scopes?.includes('records:read')) return respond(401,{error:'unauthorized'});
    if([...url.searchParams.keys()].some(k=>!['from','to','types'].includes(k))) return respond(400,{error:'unknown_query'});
    const from=url.searchParams.get('from'),to=url.searchParams.get('to')||from;
    const selected=url.searchParams.has('types')?url.searchParams.get('types').split(','):DEFAULT_SHARE_TYPES;
    // Default deny private categories and sensitive fields, even if client asks.
    if(!grant.from || !grant.to || from<grant.from || to>grant.to || !Array.isArray(grant.types) || selected.some(t=>!DEFAULT_SHARE_TYPES.includes(t)||!grant.types.includes(t))) return respond(403,{error:'outside_grant'});
    try {
      makeSnapshot({version:7,records:[]},{from,to,selected});
      if((Date.parse(to)-Date.parse(from))/86400000>30) return respond(400,{error:'max_31_days'});
    } catch {return respond(400,{error:'invalid_query'});}
    try {
      const data=validate(await readRows({owner:grant.owner,from,to,types:selected}));
      return respond(200,makeSnapshot(data,{from,to,selected,origin:'cloud-synced',generatedAt:new Date(clock()).toISOString()}));
    } catch {return respond(503,{error:'read_failed'});}
  };
}
