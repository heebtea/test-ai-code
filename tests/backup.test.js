import { beforeEach, it, expect, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { exportComplete, previewComplete, applyComplete, recoverComplete, parseComplete, canonical, FORMAT } from '../src/backup.js';
import { STORAGE_KEY, THEME_KEY, empty, persist } from '../src/data.js';
import { RESTORE_KEY } from '../src/storage-guard.js';
import { putPhoto, getPhoto } from '../src/photos.js';
import { baseTemplate, putTemplate, listTemplates } from '../src/templates.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const blob = () => new Blob([Uint8Array.from(atob(png), c=>c.charCodeAt(0))],{type:'image/png'});
const water = (id='water', volume=321) => ({id,date:'2025-02-03',type:'water',time:'10:00',note:'合成紀錄',volume,status:'已飲用'});
let storage;
beforeEach(()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());
  let queue=Promise.resolve();
  vi.stubGlobal('navigator',{locks:{request:(_name,run)=>{const result=queue.then(run);queue=result.catch(()=>{});return result;}}});
  const values=new Map();
  storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  vi.stubGlobal('localStorage',storage);
});
async function seed() {
  persist(storage,{version:6,records:[water()]});
  await putPhoto('water',blob());
  await putTemplate({...baseTemplate(),id:'custom',name:'合成模板',image:blob()});
  storage.setItem('second-brain-template','custom'); storage.setItem(THEME_KEY,'dark');
}
async function freshDevice() {
  vi.stubGlobal('indexedDB',new IDBFactory());
  for(const key of [STORAGE_KEY,THEME_KEY,'second-brain-template',RESTORE_KEY])storage.removeItem(key);
}
it('complete portable round trip retains exact photo bytes, template image/settings and all records',async()=>{
  await seed(); const text=await exportComplete(); const saved=JSON.parse(text);
  expect(saved.photos[0].data).toBe(png);expect(saved.templates[0].image.data).toBe(png);
  await freshDevice(); const preview=await previewComplete(text);
  expect(preview.counts).toEqual({new:5,same:0,conflict:0});
  await applyComplete(preview);
  const restored=JSON.parse(await exportComplete());delete restored.createdAt;delete saved.createdAt;
  expect(restored).toEqual(saved);
  const repeat=await previewComplete(text);expect(repeat.counts.same).toBe(5);
  expect((await applyComplete(repeat)).applied).toBe(0);
});
it('cancel/preview makes no writes; conflicts default to local and explicit replacement affects only selected items',async()=>{
  await seed();const before=await exportComplete();
  const incoming=JSON.parse(before);incoming.records.records[0].volume=999;incoming.records.records.push(water('new',100));incoming.settings.theme='light';
  const preview=await previewComplete(JSON.stringify(incoming));
  expect(await exportComplete().then(JSON.parse).then(x=>x.records)).toEqual(JSON.parse(before).records);
  expect(preview.counts.conflict).toBe(2);
  await applyComplete(preview);
  expect(JSON.parse(storage.getItem(STORAGE_KEY)).records.map(r=>r.volume)).toEqual([321,100]);
  expect(storage.getItem(THEME_KEY)).toBe('dark');
  await applyComplete(await previewComplete(JSON.stringify(incoming)),{'record:water':'replace'});
  expect(JSON.parse(storage.getItem(STORAGE_KEY)).records[0].volume).toBe(999);
  expect(storage.getItem(THEME_KEY)).toBe('dark');
});
it.each([2,3,4,5,6,7])('legacy v%s imports records without deleting local photos/templates or inventing metadata',async version=>{
  await seed();await applyComplete(await previewComplete(JSON.stringify({version,records:[water('legacy')]})));
  expect(await getPhoto('water')).toBeInstanceOf(Blob);expect(await listTemplates()).toHaveLength(1);
  expect(JSON.parse(storage.getItem(STORAGE_KEY)).records[1]).toEqual(water('legacy'));
});
it('invalid records/images and orphan references are previewed with reasons; malformed container and future version rejected',async()=>{
  const raw={format:FORMAT,backupVersion:1,records:{version:6,records:[water('ok'),{...water('bad'),volume:-1},water('ok')]},photos:[{id:'ok',mime:'image/png',data:'YWJj'},{id:'orphan',mime:'image/png',data:png}],templates:[],settings:{theme:'weird',template:'missing'}};
  const preview=await previewComplete(JSON.stringify(raw));
  expect(preview.errors).toHaveLength(6);expect(preview.errors.every(e=>e.reason)).toBe(true);
  await applyComplete(preview);expect(JSON.parse(storage.getItem(STORAGE_KEY)).records).toEqual([water('ok')]);
  expect(()=>parseComplete('{oops')).toThrow(/解析/);
  expect(()=>parseComplete(JSON.stringify({...raw,backupVersion:99}))).toThrow(/版本/);
  expect(()=>parseComplete(JSON.stringify({...raw,photos:{}}))).toThrow(/容器/);
});
it('storage failure after writing photos and templates rolls back all new entries and original raw localStorage',async()=>{
  await seed();const incoming=JSON.parse(await exportComplete());
  incoming.records.records.push(water('new'));incoming.photos.push({id:'new',mime:'image/png',data:png});
  incoming.templates.push({...incoming.templates[0],id:'new-template'});
  const preview=await previewComplete(JSON.stringify(incoming));const before=storage.getItem(STORAGE_KEY);
  const original=storage.setItem;let fail=true;
  storage.setItem=(key,value)=>{if(key===STORAGE_KEY&&fail){fail=false;throw Error('synthetic quota');}original(key,value);};
  await expect(applyComplete(preview)).rejects.toThrow(/已回復/);
  expect(storage.getItem(STORAGE_KEY)).toBe(before);expect(await getPhoto('new')).toBeUndefined();
  expect(await listTemplates()).toHaveLength(1);expect(storage.getItem(RESTORE_KEY)).toBeNull();
  expect(await recoverComplete()).toBe('');
});
it('persistent write failure retains recovery snapshot, blocks writes, and restart recovers once storage works',async()=>{
  await seed();const preview=await previewComplete(JSON.stringify({version:6,records:[water('new')]}));
  const original=storage.setItem;storage.setItem=(key,value)=>{if(key===STORAGE_KEY)throw Error('disk');original(key,value);};
  await expect(applyComplete(preview)).rejects.toThrow(/回復尚未完成/);
  expect(storage.getItem(RESTORE_KEY)).toBeTruthy();expect(()=>persist(storage,empty())).toThrow(/暫停寫入/);
  storage.setItem=original;expect(await recoverComplete()).toContain('已回復');
  expect(JSON.parse(storage.getItem(STORAGE_KEY)).records).toEqual([water()]);
});
it('stale preview detects changes in records, photos and settings and never writes',async()=>{
  await seed();const text=JSON.stringify({version:6,records:[water('new')]});
  let preview=await previewComplete(text);storage.setItem(THEME_KEY,'light');
  await expect(applyComplete(preview)).rejects.toThrow(/重新預覽/);
  preview=await previewComplete(text);await putTemplate({...baseTemplate(),id:'other',name:'other'});
  await expect(applyComplete(preview)).rejects.toThrow(/重新預覽/);
  expect(JSON.parse(storage.getItem(STORAGE_KEY)).records).toHaveLength(1);
});
it('skip record/template also skips dependent new photo/selected template; no orphan references',async()=>{
  await seed();const text=await exportComplete();await freshDevice();
  await applyComplete(await previewComplete(text),{'record:water':'skip','template:custom':'skip'});
  expect(await getPhoto('water')).toBeUndefined();expect(storage.getItem('second-brain-template')).toBeNull();
});
it('JSON property ordering does not create false conflicts',async()=>{
  await seed();const r=water();const reversed=Object.fromEntries(Object.entries(r).reverse());
  const p=await previewComplete(JSON.stringify({version:6,records:[reversed]}));expect(p.counts.same).toBe(1);
  expect(canonical(r)).toBe(canonical(reversed));
});
async function putRecovery(value) {
  const q=indexedDB.open('second-brain-private-recovery',1);
  const db=await new Promise((resolve,reject)=>{q.onupgradeneeded=()=>q.result.createObjectStore('journal');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('journal','readwrite');tx.objectStore('journal').put(value,'pending');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
}
it('restart recovers an uncommitted partial restore from durable journal; committed journal never undoes successful data',async()=>{
  await seed();const original=storage.getItem(STORAGE_KEY);
  const pending={before:{local:{[STORAGE_KEY]:original},photos:[],templates:[]},touched:{local:[STORAGE_KEY],photos:['new'],templates:[]},committed:false};
  await putRecovery(pending);await putPhoto('new',blob());storage.setItem(STORAGE_KEY,JSON.stringify({version:6,records:[water('changed')]}));storage.setItem(RESTORE_KEY,'restoring');
  expect(await recoverComplete()).toContain('已回復');expect(storage.getItem(STORAGE_KEY)).toBe(original);expect(await getPhoto('new')).toBeUndefined();expect(await getPhoto('water')).toBeInstanceOf(Blob);
  storage.setItem(STORAGE_KEY,JSON.stringify({version:6,records:[water('changed')]}));
  await putRecovery({...pending,committed:true});storage.setItem(RESTORE_KEY,'restoring');
  expect(await recoverComplete()).toContain('已完成');expect(JSON.parse(storage.getItem(STORAGE_KEY)).records[0].id).toBe('changed');
});
it('two concurrent restore attempts are serialized and the stale one is refused',async()=>{
  await seed();const preview=await previewComplete(JSON.stringify({version:6,records:[water('new')]}));
  const results=await Promise.allSettled([applyComplete(preview),applyComplete(preview)]);
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect(results[1].reason.message).toContain('重新預覽');
  expect(JSON.parse(storage.getItem(STORAGE_KEY)).records).toHaveLength(2);
});
