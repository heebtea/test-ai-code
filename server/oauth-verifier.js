import { createPublicKey, verify } from 'node:crypto';
import { validDate } from '../src/data.js';
import { DEFAULT_SHARE_TYPES } from '../src/ai-share.js';

// Resource-server verification only. Authorization issuance and grant persistence
// belong to the operator's configured identity provider / private grant database.
export function createOAuthVerifier({issuer,audience,jwksUrl,lookupGrant,fetcher=fetch,clock=Date.now}) {
  for(const raw of [issuer,audience,jwksUrl]) {
    const u=new URL(raw);
    if(u.protocol!=='https:' || u.username || u.password || u.hash) throw Error('HTTPS configuration required');
  }
  if(typeof lookupGrant!=='function') throw Error('Live grant lookup required');
  let keys=null,until=0;
  const deny=()=>{throw Error('Unauthorized');};
  return async authorization=>{
    if(typeof authorization!=='string' || authorization.length>16384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return deny();
    const token=authorization.slice(7),parts=token.split('.');
    let header,claims;
    try {header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));} catch {return deny();}
    if(!header || header.alg!=='RS256' || typeof header.kid!=='string' || header.crit || header.jku || header.jwk || header.x5u || !claims || typeof claims!=='object') return deny();
    if(!keys || until<=clock()) {
      const response=await fetcher(jwksUrl,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)});
      if(!response.ok) return deny();
      const text=await response.text(); if(text.length>100000) return deny();
      const result=JSON.parse(text);
      if(!Array.isArray(result.keys) || result.keys.length>100) return deny();
      keys=result.keys;until=clock()+60000;
    }
    const matches=keys.filter(k=>k.kid===header.kid && k.kty==='RSA' && (!k.alg||k.alg==='RS256') && (!k.use||k.use==='sig') && (!k.key_ops||k.key_ops.includes('verify')));
    if(matches.length!==1) return deny();
    let key;
    try {key=createPublicKey({key:matches[0],format:'jwk'});} catch {return deny();}
    if(key.asymmetricKeyDetails.modulusLength<2048 || !verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))) return deny();
    const now=clock()/1000;
    if(claims.iss!==issuer || !(claims.aud===audience || Array.isArray(claims.aud)&&claims.aud.includes(audience)) ||
      !Number.isFinite(claims.exp) || claims.exp<=now || !Number.isFinite(claims.iat) || claims.iat>now || claims.exp-claims.iat>3600 ||
      (claims.nbf!==undefined && (!Number.isFinite(claims.nbf)||claims.nbf>now)) ||
      typeof claims.sub!=='string' || !claims.sub || typeof claims.jti!=='string' || !claims.jti ||
      typeof claims.scope!=='string' || !claims.scope.split(' ').includes('records:read')) return deny();
    // Never cache grants: revocation must take effect on the next request.
    const g=await lookupGrant({issuer,subject:claims.sub,tokenId:claims.jti});
    if(!g || g.revoked || g.subject!==claims.sub || g.issuer!==issuer || g.audience!==audience || g.tokenId!==claims.jti ||
      typeof g.owner!=='string' || !g.owner || !Number.isFinite(g.expiresAt) || g.expiresAt<=clock() ||
      !validDate(g.from)||!validDate(g.to)||g.from>g.to || !Array.isArray(g.types)||g.types.some(t=>!DEFAULT_SHARE_TYPES.includes(t)) ||
      !Array.isArray(g.scopes)||!g.scopes.includes('records:read')) return deny();
    return {...g,expiresAt:Math.min(g.expiresAt,claims.exp*1000),scopes:['records:read']};
  };
}
