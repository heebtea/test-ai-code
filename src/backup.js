import { empty, validate, validateRecord, STORAGE_KEY, THEME_KEY } from './data.js';
import { validateTemplate } from './templates.js';
import { assertWritable, storageLock, RESTORE_KEY } from './storage-guard.js';

export const FORMAT = 'second-brain-lite-complete';
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const TEMPLATE_KEY = 'second-brain-template';
const localKeys = [STORAGE_KEY, THEME_KEY, TEMPLATE_KEY];
const specs = {
  photos: ['second-brain-private-photos', 'photos', false],
  templates: ['second-brain-private-templates', 'templates', true],
  recovery: ['second-brain-private-recovery', 'journal', false],
};
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const mediaTypes = ['image/png', 'image/jpeg', 'image/webp'];
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
async function database(kind) {
  const [name, store, keyPath] = specs[kind];
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(name, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(store, keyPath ? { keyPath: 'id' } : undefined);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
    q.onblocked = () => reject(Error('資料庫被其他分頁占用，請先關閉其他分頁'));
  });
}
async function transaction(kind, mode, action) {
  const db = await database(kind);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(specs[kind][1], mode);
      let result;
      try { action(tx.objectStore(specs[kind][1]), value => { result = value; }); }
      catch (e) { tx.abort(); reject(e); }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('資料庫交易中斷'));
    });
  } finally { db.close(); }
}
function readStore(kind) {
  return transaction(kind, 'readonly', (s, done) => {
    const keys = s.getAllKeys(), values = s.getAll();
    values.onsuccess = () => done(values.result.map((value, i) => [keys.result[i], value]));
  });
}
const writeStore = (kind, entries) => transaction(kind, 'readwrite', s => {
  for (const [id, value] of entries) {
    if (value === undefined) s.delete(id);
    else if (specs[kind][2]) s.put(value);
    else s.put(value, id);
  }
});
const journal = () => transaction('recovery', 'readonly', (s, done) => {
  const q = s.get('pending'); q.onsuccess = () => done(q.result);
});
async function snapshot(storage) {
  const local = Object.fromEntries(localKeys.map(key => [key, storage.getItem(key)]));
  const photos = await readStore('photos');
  const templates = await readStore('templates');
  if (localKeys.some(key => storage.getItem(key) !== local[key])) throw Error('資料已被其他分頁修改，請重新預覽');
  return { local, photos, templates };
}
async function encodeBlob(blob) {
  if (!(blob instanceof Blob) || !mediaTypes.includes(blob.type) || blob.size > 10 * 1024 * 1024) throw Error('照片格式或大小無效');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { mime: blob.type, data: btoa(raw) };
}
function decodeBlob(value) {
  if (!value || !mediaTypes.includes(value.mime) || typeof value.data !== 'string' || value.data.length > 14 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) throw Error('照片格式／Base64 無效或超過 10 MB');
  const bytes = Uint8Array.from(atob(value.data), c => c.charCodeAt(0));
  if (bytes.length > 10 * 1024 * 1024 || !bytes.length) throw Error('照片大小無效');
  const ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
  const isImage = value.mime === 'image/png' ? bytes[0] === 137 && ascii(1, 4) === 'PNG'
    : value.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!isImage) throw Error('照片內容與檔案類型不符');
  return new Blob([bytes], { type: value.mime });
}
async function envelope(snap) {
  const records = snap.local[STORAGE_KEY] === null ? empty() : validate(JSON.parse(snap.local[STORAGE_KEY]));
  const photos = [];
  for (const [id, blob] of snap.photos) photos.push({ id, ...await encodeBlob(blob) });
  const templates = [];
  for (const [, t] of snap.templates) templates.push({ ...validateTemplate(t), image: t.image ? await encodeBlob(t.image) : null });
  return { format: FORMAT, backupVersion: 1, appVersion: '0.5.0', records, photos, templates,
    settings: { theme: snap.local[THEME_KEY], template: snap.local[TEMPLATE_KEY] } };
}
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))).map(b => b.toString(16).padStart(2, '0')).join('');
async function view(storage) {
  const snap = await snapshot(storage), value = await envelope(snap);
  return { snap, value, fingerprint: await digest(value) };
}
export async function exportComplete(storage = localStorage) {
  return storageLock(async () => {
    assertWritable(storage);
    const { value } = await view(storage);
    const result = JSON.stringify({ ...value, createdAt: new Date().toISOString() });
    if (new Blob([result]).size > MAX_BACKUP_BYTES) throw Error('完整備份超過 100 MB；請另存照片原檔後再處理，未產生不完整備份');
    return result;
  });
}
export function parseComplete(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) throw Error('備份超過 100 MB');
  let raw;
  try { raw = JSON.parse(text); } catch { throw Error('JSON 無法解析，原有資料未修改'); }
  const legacy = raw?.format === undefined;
  if (!legacy && (raw.format !== FORMAT || raw.backupVersion !== 1)) throw Error('不支援此完整備份版本');
  const source = legacy ? raw : raw.records;
  if (!source || ![2,3,4,5,6,7].includes(source.version) || !Array.isArray(source.records) || source.records.length > 10000) throw Error('不支援的紀錄版本或紀錄數量');
  if (Object.keys(source).some(k=>!['version','records'].includes(k))) throw Error('紀錄容器含不支援欄位，請確認備份版本');
  const incoming = { legacy, version: source.version, entries: [], errors: [] };
  const seen = new Set();
  const add = (kind, id, value, validateValue) => {
    const key = kind + ':' + id;
    try {
      if (!validId(id) || seen.has(key)) throw Error('ID 無效或備份內重複 ID');
      seen.add(key); validateValue(value);
      incoming.entries.push({ kind, id, key, value });
    } catch (e) { incoming.errors.push({ kind, id: String(id), reason: e.message }); }
  };
  for (const r of source.records) add('record', r?.id, r, r => validate({ version: source.version, records: [r] }));
  if (!legacy) {
    if (!Array.isArray(raw.photos) || !Array.isArray(raw.templates) || raw.photos.length > 10000 || raw.templates.length > 1000 || !raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings)) throw Error('照片、模板或設定容器無效');
    for (const p of raw.photos) add('photo', p?.id, p, p => decodeBlob(p));
    for (const t of raw.templates) add('template', t?.id, t, t => {
      if (t.id === 'default') throw Error('內建模板不可覆寫');
      const allowed = ['id','name','background','accent','font','columns','illustration','mapping','image'];
      if (Object.keys(t).some(k => !allowed.includes(k))) throw Error('模板含未知欄位');
      validateTemplate({ ...t, image: t.image ? decodeBlob(t.image) : null });
    });
    for (const [id, value] of Object.entries(raw.settings)) add('setting', id, value, value => {
      if (!['theme', 'template'].includes(id)) throw Error('未知設定');
      if (id === 'theme' && value !== null && !['dark','light'].includes(value)) throw Error('主題無效');
      if (id === 'template' && value !== null && !validId(value)) throw Error('模板選擇無效');
    });
  }
  return incoming;
}
export function planComplete(current, incoming) {
  const maps = {
    record: new Map(current.records.records.map(r => [r.id, r])),
    photo: new Map(current.photos.map(p => [p.id, p])),
    template: new Map(current.templates.map(t => [t.id, t])),
    setting: new Map(Object.entries(current.settings)),
  };
  const rows = incoming.entries.map(entry => {
    const old = maps[entry.kind].get(entry.id);
    const status = old == null ? (entry.value == null ? 'same' : 'new') : canonical(old) === canonical(entry.value) ? 'same' : 'conflict';
    return { ...entry, old, status };
  });
  const errors = [...incoming.errors];
  const recordIds = new Set([...maps.record.keys(), ...rows.filter(r => r.kind === 'record').map(r => r.id)]);
  const templateIds = new Set(['default', ...maps.template.keys(), ...rows.filter(r => r.kind === 'template').map(r => r.id)]);
  const validRows = rows.filter(row => {
    const bad = row.kind === 'photo' && !recordIds.has(row.id) ? '照片對應紀錄不存在'
      : row.kind === 'setting' && row.id === 'template' && row.value && !templateIds.has(row.value) ? '選取的模板不存在' : '';
    if (bad) errors.push({ kind: row.kind, id: row.id, reason: bad });
    return !bad;
  });
  return { rows: validRows, errors, legacy: incoming.legacy,
    counts: Object.fromEntries(['new','same','conflict'].map(k => [k, validRows.filter(r => r.status === k).length])) };
}
export async function previewComplete(text, storage = localStorage) {
  const incoming = parseComplete(text);
  return storageLock(async () => {
    assertWritable(storage);
    const current = await view(storage);
    return { ...planComplete(current.value, incoming), incoming, fingerprint: current.fingerprint };
  });
}
function selectedChanges(plan, choices) {
  const changes = plan.rows.filter(r => r.status === 'new' ? choices[r.key] !== 'skip' : r.status === 'conflict' && choices[r.key] === 'replace');
  const blocked = new Set(plan.rows.filter(r => r.kind === 'record' && r.status === 'conflict' && choices[r.key] !== 'replace').map(r => r.id));
  // Never attach the incoming photo to a conflicting local record kept by the user.
  const keptRecordIds = new Set(plan.rows.filter(r=>r.kind==='record' && (r.old || changes.includes(r))).map(r=>r.id));
  const keptTemplateIds = new Set(['default', ...plan.rows.filter(r=>r.kind==='template' && (r.old || changes.includes(r))).map(r=>r.id)]);
  return changes.filter(r => {
    if (r.kind === 'photo') return !blocked.has(r.id) && (keptRecordIds.has(r.id) || !plan.rows.some(x=>x.kind==='record' && x.id===r.id));
    if (r.kind === 'setting' && r.id === 'template' && r.value) return keptTemplateIds.has(r.value) || !plan.rows.some(x=>x.kind==='template' && x.id===r.value);
    return true;
  });
}
async function restoreBefore(pending, storage) {
  for (const kind of ['photos', 'templates']) {
    const before = new Map(pending.before[kind]);
    await writeStore(kind, pending.touched[kind].map(id => [id, before.get(id)]));
  }
  for (const key of pending.touched.local) {
    const value = pending.before.local[key];
    if (value === null) storage.removeItem(key); else storage.setItem(key, value);
  }
  await writeStore('recovery', [['pending', undefined]]);
  storage.removeItem(RESTORE_KEY);
}
// Recovery data contains local private data only. It never enters Git or a network request.
export async function recoverComplete(storage = localStorage) {
  return storageLock(async () => {
    const pending = await journal();
    if (pending) {
      storage.setItem(RESTORE_KEY, 'recovering');
      if (pending.committed) {
        await writeStore('recovery', [['pending', undefined]]);
        storage.removeItem(RESTORE_KEY);
        return '上次完整還原已完成';
      }
      await restoreBefore(pending, storage);
      return '已回復中斷還原前的資料';
    }
    storage.removeItem(RESTORE_KEY);
    return '';
  });
}
export async function applyComplete(preview, choices = {}, storage = localStorage) {
  return storageLock(async () => {
    assertWritable(storage);
    const current = await view(storage);
    if (current.fingerprint !== preview.fingerprint) throw Error('資料已改變，請重新預覽；尚未寫入');
    const plan = planComplete(current.value, preview.incoming);
    const changes = selectedChanges(plan, choices);
    if (!changes.length) return { applied: 0, skipped: plan.rows.length, errors: plan.errors };
    const records = new Map(current.value.records.records.map(r => [r.id, r]));
    for (const r of changes.filter(r => r.kind === 'record')) { validateRecord(r.value); records.set(r.id, r.value); }
    const recordData = validate({ version: Math.max(6, current.value.records.version, preview.incoming.version), records: [...records.values()] });
    const pending = { before: current.snap, touched: {
      photos: changes.filter(r => r.kind === 'photo').map(r => r.id),
      templates: changes.filter(r => r.kind === 'template').map(r => r.id),
      local: [...new Set(changes.filter(r => ['record','setting'].includes(r.kind)).map(r => r.kind === 'record' ? STORAGE_KEY : r.id === 'theme' ? THEME_KEY : TEMPLATE_KEY))],
    }, committed: false };
    // Persist the undo snapshot before the first data mutation, then mark all new tabs read-only.
    await writeStore('recovery', [['pending', pending]]);
    if (localKeys.some(key => storage.getItem(key) !== current.snap.local[key])) {
      await writeStore('recovery', [['pending', undefined]]);
      throw Error('其他分頁已修改資料，還原取消；未寫入');
    }
    try {
      storage.setItem(RESTORE_KEY, 'restoring');
      await writeStore('photos', changes.filter(r => r.kind === 'photo').map(r => [r.id, decodeBlob(r.value)]));
      await writeStore('templates', changes.filter(r => r.kind === 'template').map(r => [r.id, { ...r.value, image: r.value.image ? decodeBlob(r.value.image) : null }]));
      if (changes.some(r => r.kind === 'record')) storage.setItem(STORAGE_KEY, JSON.stringify(recordData));
      for (const r of changes.filter(r => r.kind === 'setting')) {
        const key = r.id === 'theme' ? THEME_KEY : TEMPLATE_KEY;
        if (r.value === null) storage.removeItem(key); else storage.setItem(key, r.value);
      }
      // The commit marker is durable before cleanup. A crash after this point keeps the restored state.
      await writeStore('recovery', [['pending', { ...pending, committed: true }]]);
    } catch (error) {
      try { await restoreBefore(pending, storage); }
      catch { throw Error('還原中斷且回復尚未完成，請保留瀏覽器資料並重新整理；已暫停寫入'); }
      throw Error('還原失敗，已回復原有資料：' + error.message, { cause: error });
    }
    // Cleanup failures leave the committed journal for startup recovery, not a false rollback.
    try { await writeStore('recovery', [['pending', undefined]]); storage.removeItem(RESTORE_KEY); }
    catch { throw Error('還原已完成，但回復記錄清理失敗；請重新整理後繼續'); }
    return { applied: changes.length, skipped: plan.rows.length - changes.length, errors: plan.errors };
  });
}
