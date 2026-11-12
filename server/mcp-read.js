import { createAiReadHandler } from './ai-read.js';
import { DEFAULT_SHARE_TYPES } from '../src/ai-share.js';

// Stateless JSON responses over MCP Streamable HTTP; no SSE, sessions or write tools.
export function createReadMcp({resource,authorizationServer,verifyGrant,readRows,allowedOrigins=[],clock=Date.now}) {
  const root=new URL(resource),auth=new URL(authorizationServer);
  if(root.protocol!=='https:'||auth.protocol!=='https:'||root.username||root.password||root.search||root.hash||auth.username||auth.password) throw Error('Invalid OAuth resource configuration');
  const metadata=root.origin+'/.well-known/oauth-protected-resource'+root.pathname;
  const reader=createAiReadHandler({verifyGrant,readRows,clock});
  const response=(status,body,headers={})=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
  const unauthorized=()=>response(401,{error:'unauthorized'},{'WWW-Authenticate':`Bearer resource_metadata="${metadata}", scope="records:read"`});
  return async request=>{
    const u=new URL(request.url),origin=request.headers.get('Origin');
    if(u.origin!==root.origin || origin && !allowedOrigins.includes(origin)) return response(403,{error:'origin_denied'});
    if(u.href===metadata && request.method==='GET') return response(200,{resource,authorization_servers:[authorizationServer],scopes_supported:['records:read'],bearer_methods_supported:['header']});
    if(u.pathname!==root.pathname || u.search) return response(404,{error:'not_found'});
    let grant;
    try {grant=await verifyGrant(request.headers.get('Authorization'));} catch {return unauthorized();}
    if(!grant?.owner||grant.revoked||!Number.isFinite(grant.expiresAt)||grant.expiresAt<=clock()||!grant.scopes?.includes('records:read')) return unauthorized();
    if(request.method!=='POST') return response(405,{error:'post_only'},{Allow:'POST'});
    const version=request.headers.get('MCP-Protocol-Version');
    if(version && !['2025-03-26','2025-06-18'].includes(version)) return response(400,{error:'unsupported_protocol'});
    if(!request.headers.get('Content-Type')?.startsWith('application/json')) return response(415,{error:'json_required'});
    const accept=request.headers.get('Accept')||'';
    if(!accept.includes('application/json')||!accept.includes('text/event-stream')) return response(406,{error:'accept_required'});
    // Bound the actual stream, not just the untrusted Content-Length header.
    let bytes=0,chunks=[];const stream=request.body?.getReader();
    if(!stream) return response(400,{error:'body_required'});
    while(true){const {done,value}=await stream.read();if(done)break;bytes+=value.length;if(bytes>16384){await stream.cancel();return response(413,{error:'body_too_large'});}chunks.push(value);}
    let msg;try {msg=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return response(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
    if(!msg||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||(Object.hasOwn(msg,'id')&&typeof msg.id!=='string'&&!Number.isSafeInteger(msg.id))) return response(400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});
    if(!Object.hasOwn(msg,'id')) return msg.method==='notifications/initialized'?response(202,null):response(400,{error:'unsupported_notification'});
    const ok=result=>response(200,{jsonrpc:'2.0',id:msg.id,result});
    const error=(code,message)=>response(200,{jsonrpc:'2.0',id:msg.id,error:{code,message}});
    if(msg.method==='initialize') return ok({protocolVersion:['2025-03-26','2025-06-18'].includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'second-brain-private-read',version:'0.6.0'}});
    if(msg.method==='ping') return ok({});
    if(msg.method==='tools/list') return ok({tools:[{name:'get_records',description:'Read authorized cloud-synced Second Brain records, at most 31 days. Missing values are unknown; transaction entries reference the same record IDs and must not be counted twice.',inputSchema:{type:'object',properties:{from:{type:'string',format:'date'},to:{type:'string',format:'date'},types:{type:'array',items:{type:'string',enum:DEFAULT_SHARE_TYPES}}},required:['from','types'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:['records:read']}]}]});
    if(msg.method!=='tools/call') return error(-32601,'Method not found');
    if(msg.params?.name!=='get_records') return error(-32602,'Unknown tool');
    const a=msg.params.arguments;
    if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['from','to','types'].includes(k))||typeof a.from!=='string'||(a.to!==undefined&&typeof a.to!=='string')||!Array.isArray(a.types)||!a.types.length||a.types.some(t=>!DEFAULT_SHARE_TYPES.includes(t))) return error(-32602,'Invalid arguments');
    const query=new URL(root.origin+'/records');query.searchParams.set('from',a.from);query.searchParams.set('to',a.to||a.from);query.searchParams.set('types',a.types.join(','));
    const result=await reader(new Request(query,{headers:{Authorization:request.headers.get('Authorization')}}));
    if(result.status===401) return unauthorized();
    const body=await result.json();
    return ok({content:[{type:'text',text:JSON.stringify(body)}],isError:!result.ok,...(result.ok?{structuredContent:body}:{})});
  };
}
