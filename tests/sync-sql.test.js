import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { it,expect } from 'vitest';
it('real PostgreSQL functions: anonymous denial, allowlist, owner isolation, CAS, tombstones and direct-write denial',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema public,auth to anon,authenticated;
 insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
 await db.exec(readFileSync(new URL('../supabase/private-sync.sql',import.meta.url),'utf8'));
 await db.exec('set role anon');await expect(db.query('select public.sbl_list()')).rejects.toThrow();
 await db.exec(`set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
 await expect(db.query('select public.sbl_list()')).rejects.toThrow();
 await db.exec(`reset role; insert into public.sbl_allowed_users select id from auth.users; set role authenticated;`);
 const record={id:'synthetic',type:'water',status:'已飲用',date:'2026-11-01',time:'12:00',note:'',volume:200};
 const cas=async(expected,r,deleted=false)=>(await db.query('select public.sbl_cas($1,$2,$3,$4) as r',['synthetic',expected,r===null?null:JSON.stringify(r),deleted])).rows[0].r;
 expect((await cas(0,record)).revision).toBe(1);expect((await cas(0,record)).revision).toBe(1);
 expect((await cas(1,{...record,volume:300})).revision).toBe(2);
 await expect(cas(1,{...record,volume:400})).rejects.toThrow('Revision conflict');
 await expect(db.query('select * from public.sbl_records')).rejects.toThrow();
 await expect(db.query('delete from public.sbl_records')).rejects.toThrow();
 await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'`);
 expect((await db.query('select public.sbl_list() as r')).rows[0].r).toEqual([]);
 await cas(0,{...record,volume:900});
 await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
 expect((await db.query('select public.sbl_list() as r')).rows[0].r[0].record.volume).toBe(300);
 expect((await cas(2,null,true)).revision).toBe(3);expect((await cas(2,null,true)).revision).toBe(3);
 await db.exec(`set request.jwt.claims='{"client_id":"ai-client"}'`);await expect(db.query('select public.sbl_list()')).rejects.toThrow('Not authorized');
 await db.exec(`set request.jwt.claims='{}'; reset role; delete from public.sbl_allowed_users where user_id='00000000-0000-0000-0000-000000000001'; set role authenticated;`);
 await expect(db.query('select public.sbl_list()')).rejects.toThrow('Not authorized');
 } finally {await db.close();}
},30000);
