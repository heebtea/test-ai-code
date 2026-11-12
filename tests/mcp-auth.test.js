import { generateKeyPairSync,sign } from 'node:crypto';
import { it,expect } from 'vitest';
import { createOAuthVerifier } from '../server/oauth-verifier.js';
import { createReadMcp } from '../server/mcp-read.js';
const issuer='https://auth.example.invalid',resource='https://private.example.invalid/mcp',now=1800000000000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'};
const grant=()=>({issuer,audience:resource,subject:'subject-a',tokenId:'token-1',owner:'owner-a',expiresAt:now+300000,from:'2026-11-01',to:'2026-11-30',types:['water'],scopes:['records:read']});
const jwt=(changes={},head={})=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test',...head})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:issuer,aud:resource,sub:'subject-a',jti:'token-1',iat:now/1000,exp:now/1000+300,scope:'records:read',...changes})).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');};
function setup(){let g=grant();let calls=0;const verifier=createOAuthVerifier({issuer,audience:resource,jwksUrl:issuer+'/jwks',clock:()=>now,lookupGrant:async()=>{calls++;return g;},fetcher:async()=>new Response(JSON.stringify({keys:[jwk]}))});return {verifier,revoke(){g.revoked=true;},wrongOwner(){g.subject='other';},get calls(){return calls;}};}
it('verifies real RSA signatures and checks live revocation on each read',async()=>{const s=setup(),header='Bearer '+jwt();expect((await s.verifier(header)).owner).toBe('owner-a');await s.verifier(header);expect(s.calls).toBe(2);s.revoke();await expect(s.verifier(header)).rejects.toThrow();});
it.each([{iss:'https://wrong.invalid'},{aud:'other'},{exp:now/1000},{iat:now/1000+1},{nbf:now/1000+1},{exp:now/1000+4000},{scope:'records:write'},{sub:'other'}])('rejects invalid token claims %j',async claims=>{await expect(setup().verifier('Bearer '+jwt(claims))).rejects.toThrow();});
it('rejects unsigned, tampered, algorithm-confused and attacker-key tokens',async()=>{const s=setup();for(const token of [jwt({}, {alg:'none'}),jwt({}, {jku:'https://attacker.invalid'}),jwt().replace(/.$/,'!'),'not-a-jwt'])await expect(s.verifier('Bearer '+token)).rejects.toThrow();const parts=jwt().split('.');parts[1]=Buffer.from(JSON.stringify({sub:'other'})).toString('base64url');await expect(s.verifier('Bearer '+parts.join('.'))).rejects.toThrow();});
it('MCP negotiates, discovers only one read tool, reads scoped data and denies writes/revocation/origins',async()=>{
 const s=setup();let reads=0;const app=createReadMcp({resource,authorizationServer:issuer,verifyGrant:s.verifier,clock:()=>now,readRows:async args=>{reads++;expect(args.owner).toBe('owner-a');return {version:7,records:[{id:'synthetic',type:'water',date:'2026-11-01',time:'12:00',note:'private',volume:200,status:'已飲用'}]};}});
 const headers={Authorization:'Bearer '+jwt(),'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 const req=(method,params={},extra={})=>app(new Request(resource,{method:'POST',headers:{...headers,...extra},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
 expect((await (await req('initialize',{protocolVersion:'2025-06-18'})).json()).result.protocolVersion).toBe('2025-06-18');
 expect((await (await req('tools/list')).json()).result.tools.map(t=>t.name)).toEqual(['get_records']);
 const result=await (await req('tools/call',{name:'get_records',arguments:{from:'2026-11-01',types:['water']}})).json();expect(result.result.isError).toBe(false);expect(result.result.structuredContent.records[0]).not.toHaveProperty('note');expect(reads).toBe(1);
 expect((await (await req('tools/call',{name:'delete_records'})).json()).error.code).toBe(-32602);
 expect((await (await req('tools/call',{name:'get_records',arguments:{from:'2026-11-01',types:['water'],owner:'other'}})).json()).error.code).toBe(-32602);
 expect((await req('tools/list',{}, {Origin:'https://evil.invalid'})).status).toBe(403);
 expect((await req('tools/list',{}, {Authorization:''})).status).toBe(401);
 const discovery=await app(new Request('https://private.example.invalid/.well-known/oauth-protected-resource/mcp'));expect((await discovery.json()).resource).toBe(resource);
 s.revoke();expect((await req('tools/list')).status).toBe(401);expect(reads).toBe(1);
});
it('MCP bounds actual body size and rejects bad protocol and media',async()=>{const s=setup();const app=createReadMcp({resource,authorizationServer:issuer,verifyGrant:s.verifier,clock:()=>now,readRows:async()=>{throw Error('must not read');}});const headers={Authorization:'Bearer '+jwt(),'Content-Type':'application/json',Accept:'application/json, text/event-stream'};expect((await app(new Request(resource,{method:'POST',headers,body:' '.repeat(17000)}))).status).toBe(413);expect((await app(new Request(resource,{method:'POST',headers:{...headers,'MCP-Protocol-Version':'bogus'},body:'{}'}))).status).toBe(400);});
