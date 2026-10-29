// New v0.5 tabs cooperate while a multi-store restore is in progress.
export const RESTORE_KEY = 'second-brain-restore-in-progress';
export const STORAGE_LOCK = 'second-brain-private-storage';
export function assertWritable(storage = globalThis.localStorage) {
  if (storage?.getItem(RESTORE_KEY)) throw Error('備份還原／回復尚未完成，暫停寫入；請關閉其他分頁後重新整理');
}
export function storageLock(run) {
  if (!globalThis.navigator?.locks) throw Error('此瀏覽器不支援安全還原鎖；請更新 Safari／瀏覽器後再試');
  return navigator.locks.request(STORAGE_LOCK, run);
}
export function guardedWrite(run) {
  assertWritable();
  // Normal editing remains usable on older browsers; restore requires Web Locks.
  return globalThis.navigator?.locks
    ? storageLock(() => { assertWritable(); return run(); })
    : run();
}
