import { validate, validateRecord, loadRecords, STORAGE_KEY } from './data.js';
import { canonical } from './backup.js';
import { storageLock, assertWritable } from './storage-guard.js';

export const SYNC_KEY = 'second-brain-sync-v1';
export const SYNC_JOURNAL = 'second-brain-sync-commit';
const clone = x => JSON.parse(JSON.stringify(x));
export const equal = (a,b) => canonical(a) === canonical(b);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export function validateRemote(rows) {
  if (!Array.isArray(rows) || rows.length > 20000) throw Error('雲端紀錄數量／格式無效');
  const ids = new Set();
  for(const row of rows) {
    if(!row || !validId(row.id) || ids.has(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.deleted !== 'boolean' || !Number.isFinite(Date.parse(row.server_updated_at))) throw Error('雲端版本或刪除標記無效');
    if(row.deleted ? row.record !== null : !row.record || row.record.id !== row.id) throw Error('雲端 ID 不一致');
    if(!row.deleted) validateRecord(row.record);
    ids.add(row.id);
  }
  return rows;
}
const value = row => row?.deleted ? null : row?.record ?? null;
export function planSync(data, state, remote) {
  validate(data); validateRemote(remote);
  const local = new Map(data.records.map(r=>[r.id,r])), cloud = new Map(remote.map(r=>[r.id,r]));
  const bases = state.bases || {};
  const ids = new Set([...local.keys(), ...cloud.keys(), ...Object.keys(bases), ...Object.keys(state.pending || {})]);
  const writes=[], pulls=[], conflicts=[], acknowledged=[];
  for(const id of ids) {
    const l=local.get(id) ?? null, r=cloud.get(id);
    let b=Object.hasOwn(bases,id)?bases[id]:null;
    const pending=state.pending && Object.hasOwn(state.pending,id) ? state.pending[id] : null;
    // A request can commit remotely before the response is lost. Preserve its ancestry.
    if(!b && pending && r) {
      if(equal(pending.record,value(r))) b=r;
      else if(!equal(l,value(r))) { conflicts.push({id,local:l,remote:r}); continue; }
    }
    if(b && !r) throw Error('雲端遺失版本歷史；停止同步，請檢查專案與備份');
    if(b && r && (r.revision < b.revision || (r.revision === b.revision && !equal(value(r),value(b))))) throw Error('雲端版本倒退或同版本內容變動；停止同步');
    if(r && equal(l,value(r))) { acknowledged.push(r); continue; }
    if(!b) {
      if(!r && l) writes.push({id,expected:0,record:l,deleted:false});
      else if(r && !l) { pulls.push(r); acknowledged.push(r); }
      else if(r && l) conflicts.push({id,local:l,remote:r});
      continue;
    }
    const localChanged=!equal(l,value(b));
    const cloudChanged=r.revision !== b.revision;
    if(localChanged && cloudChanged) conflicts.push({id,local:l,remote:r});
    else if(localChanged) writes.push({id,expected:b.revision,record:l,deleted:l===null});
    else { pulls.push(r); acknowledged.push(r); }
  }
  return {writes,pulls,conflicts,acknowledged};
}
export function readSyncState(storage) {
  const raw=storage.getItem(SYNC_KEY);
  if(raw===null) return {version:1,owner:null,bases:{},conflicts:[],lastSync:null};
  const state=JSON.parse(raw);
  if(state.version!==1 || !state.bases || !Array.isArray(state.conflicts)) throw Error('同步狀態損壞；保留本機資料，請匯出備份');
  validateRemote(Object.values(state.bases));
  return state;
}
// Crash recovery is conservative and never replaces an unrelated subsequent edit.
export function recoverSync(storage) {
  const raw=storage.getItem(SYNC_JOURNAL); if(!raw) return;
  const j=JSON.parse(raw), current=storage.getItem(STORAGE_KEY);
  if(!j || j.version!==1 || ![j.before,j.after].includes(current)) throw Error('同步回復需人工檢查；原始資料保留');
  if(j.before===null) storage.removeItem(STORAGE_KEY); else storage.setItem(STORAGE_KEY,j.before);
  if(j.stateBefore===null) storage.removeItem(SYNC_KEY); else storage.setItem(SYNC_KEY,j.stateBefore);
  storage.removeItem(SYNC_JOURNAL);
}
function commitLocal(storage, expected, data, state) {
  assertWritable(storage);
  if(storage.getItem(STORAGE_KEY)!==expected) throw Error('同步期間本機有新修改，請重試；新資料已保留');
  const after=JSON.stringify(validate(data)), stateBefore=storage.getItem(SYNC_KEY);
  storage.setItem(SYNC_JOURNAL,JSON.stringify({version:1,before:expected,after,stateBefore}));
  try {
    storage.setItem(STORAGE_KEY,after);
    storage.setItem(SYNC_KEY,JSON.stringify(state));
    storage.removeItem(SYNC_JOURNAL);
  } catch(e) {
    try { recoverSync(storage); } catch { /* Journal blocks all later writes until recovery succeeds. */ }
    throw e;
  }
}
async function performSync({storage,adapter,lock=storageLock,active=()=>true,now=()=>new Date().toISOString()}) {
  let raw, data, state;
  const owner=adapter.owner;
  if(!owner || !active()) throw Error('尚未授權同步');
  await lock(()=>{
    assertWritable(storage);
    raw=storage.getItem(STORAGE_KEY); data=loadRecords(storage); state=readSyncState(storage);
    if(state.owner && state.owner!==owner) throw Error('同步帳戶／專案不同；拒絕將既有紀錄傳至其他帳戶');
    // Persist account binding even if the first upload only partially succeeds.
    state.owner=owner; storage.setItem(SYNC_KEY,JSON.stringify(state));
  });
  const check=()=>{if(!active()) throw Error('同步已停止；本機資料未套用');};
  check();
  const remote=await adapter.list(); check();
  const plan=planSync(data,state,remote);
  // Durable outbox before the first request; survives timeout, stop and process death.
  state.pending={...(state.pending||{}),...Object.fromEntries(plan.writes.map(op=>[op.id,op]))};
  await lock(()=>{
    check(); assertWritable(storage);
    if(storage.getItem(STORAGE_KEY)!==raw) throw Error('同步期間本機有新修改，請重試');
    storage.setItem(SYNC_KEY,JSON.stringify(state));
  });
  for(const op of plan.writes) {
    check();
    const row=await adapter.cas(op); check();
    validateRemote([row]);
    if(row.id!==op.id || !equal(value(row),op.record)) throw Error('雲端寫入回應不一致');
    plan.acknowledged.push(row);
  }
  const records=new Map(data.records.map(r=>[r.id,r]));
  for(const row of plan.pulls) { if(row.deleted) records.delete(row.id); else records.set(row.id,clone(row.record)); }
  const bases={...state.bases};
  for(const row of plan.acknowledged) Object.defineProperty(bases,row.id,{value:clone(row),enumerable:true,configurable:true,writable:true});
  const pending={...state.pending}; for(const row of plan.acknowledged) delete pending[row.id];
  const next={...state,bases,pending,conflicts:plan.conflicts,lastSync:plan.conflicts.length ? state.lastSync : now(),lastAttempt:now()};
  await lock(()=>{check();commitLocal(storage,raw,{version:Math.max(data.version,7),records:[...records.values()]},next);});
  return next;
}
async function performResolve({storage,adapter,id,choice,lock=storageLock,active=()=>true}) {
  if(!['local','cloud'].includes(choice)) throw Error('請明確選擇保留版本');
  let raw,data,state,conflict;
  await lock(()=>{
    assertWritable(storage);raw=storage.getItem(STORAGE_KEY);data=loadRecords(storage);state=readSyncState(storage);
    if(state.owner!==adapter.owner || !active()) throw Error('尚未授權');
    conflict=state.conflicts.find(c=>c.id===id);
    if(!conflict || !equal(data.records.find(r=>r.id===id)??null,conflict.local)) throw Error('衝突預覽已過期，請重新同步');
  });
  const current=(await adapter.list()).find(r=>r.id===id);
  if(!current || current.revision!==conflict.remote.revision) throw Error('雲端版本已變，請重新同步');
  let row=current;
  if(choice==='local') row=await adapter.cas({id,expected:current.revision,record:conflict.local,deleted:conflict.local===null});
  validateRemote([row]);
  if(row.id!==id) throw Error('雲端 ID 不一致');
  const records=data.records.filter(r=>r.id!==id); if(!row.deleted) records.push(row.record);
  Object.defineProperty(state.bases,id,{value:row,enumerable:true,configurable:true,writable:true});
  state.conflicts=state.conflicts.filter(c=>c.id!==id);
  if(state.pending) delete state.pending[id];
  await lock(()=>{if(!active()) throw Error('同步已停止');commitLocal(storage,raw,{version:7,records},state);});
  return state;
}

export function synchronize(options) {
  // Serialize cloud rounds across tabs, separately from short local commit locks.
  return globalThis.navigator?.locks
    ? navigator.locks.request('second-brain-sync-network',()=>performSync(options))
    : performSync(options);
}

export function resolveSyncConflict(options) {
  return globalThis.navigator?.locks
    ? navigator.locks.request('second-brain-sync-network',()=>performResolve(options))
    : performResolve(options);
}
