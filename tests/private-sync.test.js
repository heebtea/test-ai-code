import { describe,it,expect } from 'vitest';
import { synchronize,resolveSyncConflict,readSyncState,recoverSync,SYNC_KEY,SYNC_JOURNAL,equal } from '../src/private-sync.js';
import { STORAGE_KEY,loadRecords,persist,remove,liquidIntake,cashflow,localDate } from '../src/data.js';
import { makeSnapshot,shareRange } from '../src/ai-share.js';
import { createSupabaseSync,validateSyncConfig } from '../src/supabase-sync.js';
import { createAiReadHandler } from '../server/ai-read.js';
const r=(id='water',volume=200)=>({id,type:'water',status:'已飲用',date:'2026-11-01',time:'12:00',note:'private note',provenance:'private source',volume});
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const lock=fn=>fn();
function cloud() {
 const rows=new Map();let fail=false,drop=false,authorized=true;
 return {owner:'synthetic-project|user-a',rows,
  setFail(v){fail=v;},setDrop(){drop=true;},revoke(){authorized=false;},
  async list(){if(!authorized)throw Error('401');if(fail)throw Error('offline');return structuredClone([...rows.values()]);},
  async cas(op){if(!authorized)throw Error('401');if(fail)throw Error('offline');const old=rows.get(op.id);
   if(old && equal(old.record,op.record) && old.deleted===op.deleted)return structuredClone(old);
   if((old?.revision??0)!==op.expected)throw Error('409');
   const row={id:op.id,record:structuredClone(op.record),deleted:op.deleted,revision:(old?.revision??0)+1,server_updated_at:'2026-11-01T00:00:00Z'};
   rows.set(op.id,row);if(drop){drop=false;throw Error('lost response');}return structuredClone(row);
  }};
}
const sync=(storage,adapter,options={})=>synchronize({storage,adapter,lock,...options});
const seed=(s,records)=>persist(s,{version:7,records});
describe('private synchronization with isolated synthetic devices',()=>{
 it('offline create, reconnect, update same ID, delete tombstone, no resurrection',async()=>{
  const phone=memory(),pc=memory(),server=cloud();seed(phone,[r()]);server.setFail(true);
  await expect(sync(phone,server)).rejects.toThrow('offline');expect(loadRecords(phone).records).toEqual([r()]);
  server.setFail(false);await sync(phone,server);await sync(pc,server);expect(loadRecords(pc)).toEqual(loadRecords(phone));
  seed(pc,[r('water',350)]);await sync(pc,server);await sync(phone,server);expect(loadRecords(phone).records).toEqual([r('water',350)]);
  persist(phone,remove(loadRecords(phone),'water'));await sync(phone,server);await sync(pc,server);
  expect(loadRecords(pc).records).toEqual([]);expect(server.rows.get('water').deleted).toBe(true);
  await sync(pc,server);expect(server.rows.size).toBe(1);expect(server.rows.get('water').revision).toBe(3);
 });
 it('preserves v8 schema when pulling and resolving a same-ID correction',async()=>{
  const a=memory(),b=memory(),server=cloud();
  seed(a,[r()]);await sync(a,server);await sync(b,server);
  const correctedAt='2031-02-05T02:30:00.000Z';
  const corrected={...r('water',275),updatedAt:correctedAt,correctedAt};
  persist(a,{version:8,records:[corrected]});seed(b,[r('water',400)]);
  await sync(a,server);await sync(b,server);
  await resolveSyncConflict({storage:b,adapter:server,id:'water',choice:'cloud',lock});
  expect(loadRecords(b)).toEqual({version:8,records:[corrected]});
  const c=memory();await sync(c,server);
  expect(loadRecords(c)).toEqual(loadRecords(b));
 });
 it('lost response retry and duplicate rounds never duplicate ID or revision',async()=>{
  const s=memory(),server=cloud();seed(s,[r()]);server.setDrop();await expect(sync(s,server)).rejects.toThrow('lost response');
  await sync(s,server);await sync(s,server);expect(server.rows.size).toBe(1);expect(server.rows.get('water').revision).toBe(1);
 });
 it('delete after a lost first-upload response creates a tombstone instead of resurrecting',async()=>{
  const s=memory(),server=cloud();seed(s,[r()]);server.setDrop();await expect(sync(s,server)).rejects.toThrow();
  seed(s,[]);await sync(s,server);expect(server.rows.get('water').deleted).toBe(true);expect(loadRecords(s).records).toEqual([]);
 });
 it('concurrent same-ID edits preserve both versions until explicit resolution',async()=>{
  const a=memory(),b=memory(),server=cloud();seed(a,[r()]);await sync(a,server);await sync(b,server);
  seed(a,[r('water',300)]);seed(b,[r('water',400)]);await sync(a,server);const result=await sync(b,server);
  expect(result.conflicts).toHaveLength(1);expect(loadRecords(b).records[0].volume).toBe(400);expect(server.rows.get('water').record.volume).toBe(300);
  await resolveSyncConflict({storage:b,adapter:server,id:'water',choice:'local',lock});await sync(a,server);
  expect(loadRecords(a).records[0].volume).toBe(400);expect(server.rows.get('water').revision).toBe(3);
 });
 it('edit versus tombstone is a conflict and cloud resolution is explicit',async()=>{
  const a=memory(),b=memory(),server=cloud();seed(a,[r()]);await sync(a,server);await sync(b,server);
  seed(a,[]);seed(b,[r('water',350)]);await sync(a,server);await sync(b,server);expect(readSyncState(b).conflicts).toHaveLength(1);
  await resolveSyncConflict({storage:b,adapter:server,id:'water',choice:'cloud',lock});expect(loadRecords(b).records).toEqual([]);
 });
 it('rejects mismatched account, missing history, corrupt rows and stale conflict choices',async()=>{
  const a=memory(),b=memory(),server=cloud();seed(a,[r()]);await sync(a,server);await sync(b,server);
  await expect(sync(a,{...server,owner:'other'})).rejects.toThrow('帳戶');
  seed(a,[r('water',300)]);seed(b,[r('water',400)]);await sync(a,server);await sync(b,server);
  seed(b,[r('water',450)]);await expect(resolveSyncConflict({storage:b,adapter:server,id:'water',choice:'cloud',lock})).rejects.toThrow('過期');
  server.rows.clear();await expect(sync(a,server)).rejects.toThrow('遺失版本');
  await expect(sync(memory(),{...server,list:async()=>[{id:'bad'}]})).rejects.toThrow('版本');
 });
 it('local edits during network await are preserved; retry reconciles partial cloud success',async()=>{
  const s=memory(),server=cloud();seed(s,[r()]);const adapter={...server,async cas(op){const row=await server.cas(op);seed(s,[r('water',500)]);return row;}};
  await expect(sync(s,adapter)).rejects.toThrow('新修改');expect(loadRecords(s).records[0].volume).toBe(500);
  expect((await sync(s,server)).conflicts).toHaveLength(0);expect(server.rows.get('water').record.volume).toBe(500);
 });
 it('stop in flight prevents local apply, and expired authorization is rejected',async()=>{
  const s=memory(),server=cloud();let active=true;seed(s,[r()]);
  await expect(sync(s,{...server,async list(){active=false;return [];}},{active:()=>active})).rejects.toThrow('停止');
  expect(server.rows.size).toBe(0);server.revoke();await expect(sync(s,server)).rejects.toThrow('401');expect(loadRecords(s).records).toEqual([r()]);
 });
 it('local quota failure rolls back both records and cursor; crash journal recovers',async()=>{
  const a=memory(),b=memory(),server=cloud();seed(a,[r()]);await sync(a,server);
  const old=b.setItem;let once=true;b.setItem=(k,v)=>{if(k===SYNC_KEY && JSON.parse(v).bases.water && once){once=false;throw Error('quota');}old(k,v);};
  await expect(sync(b,server)).rejects.toThrow('quota');expect(b.getItem(STORAGE_KEY)).toBe(null);expect(readSyncState(b).bases).toEqual({});
  await sync(b,server);expect(loadRecords(b).records).toEqual([r()]);
  const before=b.getItem(STORAGE_KEY),after=JSON.stringify({version:7,records:[]});
  b.setItem(SYNC_JOURNAL,JSON.stringify({version:1,before,after,stateBefore:b.getItem(SYNC_KEY)}));b.setItem(STORAGE_KEY,after);recoverSync(b);expect(b.getItem(STORAGE_KEY)).toBe(before);
 });
 it('retains nulls, voucher, in-progress status, family quantities and refund accounting',async()=>{
  const phone=memory(),pc=memory(),server=cloud();
  const records=[r(),{id:'voucher',date:'2026-11-01',time:'13:00',note:'',type:'coffee',status:'飲用中',volume:480,amount:null,payment:'voucher'},
   {id:'meal',date:'2026-11-01',time:'12:00',note:'',type:'meal',name:'synthetic',status:'部分',amount:null,paid:null,paymentDate:null,orderDate:null,startTime:'',endTime:'',quantity:3,consumedQuantity:1,familyQuantity:1,remainingQuantity:1},
   {id:'refund',date:'2026-11-01',time:'',note:'',type:'spending',status:'已付款',amount:20,transactionKind:'refund'}];
  seed(phone,records);const before=loadRecords(phone);await sync(phone,server);await sync(pc,server);
  expect(loadRecords(pc)).toEqual(before);expect(liquidIntake(before,'2026-11-01').value).toBe(200);expect(cashflow(before,'2026-11-01').totals.refund.value).toBe(20);
 });
 it('rejects remote revision rollback and mutation without a revision increment',async()=>{
  const s=memory(),server=cloud();seed(s,[r()]);await sync(s,server);server.rows.get('water').record.volume=999;
  await expect(sync(s,server)).rejects.toThrow('同版本');expect(loadRecords(s).records[0].volume).toBe(200);
 });
 it('reserved property IDs cannot poison state or suppress records',async()=>{
  const s=memory(),server=cloud();seed(s,[r('__proto__'),r('constructor')]);await sync(s,server);await sync(s,server);expect(server.rows.size).toBe(2);
 });
});
describe('AI snapshot date and privacy correctness',()=>{
 it('real date validation, Taiwan midnight, week/month boundaries and leap days',()=>{
  expect(localDate(new Date('2026-10-31T16:01:00Z'))).toBe('2026-11-01');
  expect(shareRange('week','2026-11-01')).toEqual({from:'2026-10-26',to:'2026-11-01'});
  expect(shareRange('month','2024-02-03').to).toBe('2024-02-29');expect(shareRange('month','2026-12-03').to).toBe('2026-12-31');
  expect(()=>makeSnapshot({version:7,records:[]},{from:'2026-02-30'})).toThrow();
 });
 it('redacts free text/unknown fields, preserves IDs/status/version and does not mutate',()=>{
  const data={version:7,records:[{...r(),apiKey:'must-not-leak'}, {...r('event'),type:'event',name:'secret'}, {...r('journal'),type:'journal',mood:'private'}, {...r('other'),date:'2026-10-31'}]};const before=JSON.stringify(data);
  const snap=makeSnapshot(data,{from:'2026-11-01'});expect(snap.records).toHaveLength(1);expect(snap.version).toBe(7);expect(JSON.stringify(snap.records)).not.toMatch(/private|must-not-leak/);
  expect(snap.records[0].status).toBe('已飲用');expect(snap.generatedAt).toBeTruthy();expect(JSON.stringify(data)).toBe(before);
  expect(makeSnapshot(data,{from:'2026-11-01',selected:['event'],includeSensitive:true}).records[0].name).toBe('secret');
 });
 it('unchecking spending removes monetary fields from selected meals and drinks',()=>{
  const data={version:7,records:[{id:'meal',type:'meal',date:'2026-11-01',status:'部分',amount:99,paid:true,paymentDate:'2026-11-01',name:'synthetic'}]};
  const snap=makeSnapshot(data,{from:'2026-11-01',selected:['meal']});expect(snap.records[0]).not.toHaveProperty('amount');expect(snap.transactions).toEqual([]);expect(snap.records[0].status).toBe('部分');
 });
 it('payment-date projection catches prior purchases without double counting or leaking meal selection',()=>{
  const meal={id:'paid',type:'meal',date:'2026-11-02',paymentDate:'2026-11-01',paid:true,amount:null,name:'private name',status:'未確認'};
  const snap=makeSnapshot({version:7,records:[meal]},{from:'2026-11-01',selected:['spending']});
  expect(snap.records).toEqual([]);expect(snap.transactions[0]).toMatchObject({id:'paid',amount:null,transactionDate:'2026-11-01'});expect(snap.transactions[0]).not.toHaveProperty('name');
 });
});
describe('authenticated provider and read-only AI boundary',()=>{
 const config={url:'https://synthetic.supabase.co',key:'sb_publishable_synthetic12345'};
 it('refuses secret keys and arbitrary credential destinations',()=>{
  expect(()=>validateSyncConfig({...config,key:'service_role_secret'})).toThrow();expect(()=>validateSyncConfig({...config,url:'https://evil.example'})).toThrow();
 });
 it('requires login, fails closed at expiry and never persists session tokens',async()=>{
  let now=0;const requests=[];const a=createSupabaseSync(config,{clock:()=>now,fetcher:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.endsWith('/verify')?{access_token:'synthetic-token',user:{id:'user-a'},expires_in:1}:[]));}});
  await expect(a.list()).rejects.toThrow('失效');expect(requests).toHaveLength(0);
  await a.verifyCode('synthetic@example.invalid','123456');await a.list();expect(requests[1].options.headers.Authorization).toBe('Bearer synthetic-token');
  now=2000;await expect(a.list()).rejects.toThrow('失效');expect(a.authorized).toBe(false);
 });
 it('AI rejects anonymous/expired/revoked/out-of-scope/write requests and supplies server-owned identity',async()=>{
  let grant=null,calls=[];
  const handle=createAiReadHandler({clock:()=>1000,verifyGrant:async()=>grant,readRows:async args=>{calls.push(args);return {version:7,records:[r()]};}});
  const request=(query='',method='GET')=>handle(new Request('https://synthetic.invalid/records?from=2026-11-01&types=water'+query,{method}));
  expect((await request()).status).toBe(401);
  grant={owner:'a',expiresAt:2000,scopes:['records:read'],from:'2026-11-01',to:'2026-11-30',types:['water']};
  expect((await request('','POST')).status).toBe(405);expect((await request('&owner=other')).status).toBe(400);expect((await request('&to=2026-12-01')).status).toBe(403);
  const ok=await request();expect(ok.status).toBe(200);expect((await ok.json()).origin).toBe('cloud-synced');expect(calls).toHaveLength(1);expect(calls[0].owner).toBe('a');
  grant.revoked=true;expect((await request()).status).toBe(401);grant.revoked=false;grant.expiresAt=999;expect((await request()).status).toBe(401);
 });
});
