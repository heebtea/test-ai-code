import { canonical, getDayRecovery, putDayRecovery } from "./backup.js";
import { loadRecords, STORAGE_KEY, validate, validDate } from "./data.js";
import { commitLocal, readSyncState, SYNC_JOURNAL } from "./private-sync.js";
import { assertWritable, storageLock } from "./storage-guard.js";

export function hasDayRecovery(date, storage) {
  return Boolean(readSyncState(storage).dayBackups?.[date]);
}

export function deleteDayRecords(backup, storage) {
  return storageLock(async () => {
    assertWritable(storage);
    if (!validDate(backup.date) || storage.getItem(STORAGE_KEY) !== backup.snapshot)
      throw Error("紀錄已更新，請重新開啟刪除預覽及備份");
    const current = loadRecords(storage);
    const selected = current.records.filter((record) => record.date === backup.date);
    if (!selected.length || canonical(selected) !== canonical(backup.records.records))
      throw Error("備份與選定日期的紀錄不一致");
    const state = readSyncState(storage);
    const previous = state.dayBackups?.[backup.date];
    const key = "day:" + crypto.randomUUID();
    const dayDeletions = { ...state.dayDeletions, ...Object.fromEntries(
      selected.map(({ id, date, type }) => [id, { date, type }]),
    ) };
    const dayBackups = { ...state.dayBackups, [backup.date]: key };
    const next = { ...current, records: current.records.filter((record) => record.date !== backup.date) };

    // The recovery snapshot is durable before the records and sync intent move together.
    await putDayRecovery(key, backup.records);
    try {
      commitLocal(storage, backup.snapshot, next, { ...state, dayDeletions, dayBackups });
    } catch (error) {
      if (!storage.getItem(SYNC_JOURNAL)) await putDayRecovery(key, undefined).catch(() => {});
      throw error;
    }
    if (previous) await putDayRecovery(previous, undefined).catch(() => {});
    return selected.length;
  });
}

export function restoreDayRecords(date, storage) {
  return storageLock(async () => {
    assertWritable(storage);
    if (!validDate(date)) throw Error("復原日期無效");
    const snapshot = storage.getItem(STORAGE_KEY);
    const current = loadRecords(storage);
    const state = readSyncState(storage);
    const key = state.dayBackups?.[date];
    const backup = key && await getDayRecovery(key);
    if (!backup) throw Error("找不到當日回復點，請使用已下載的當日備份");
    validate(backup);
    if (backup.records.some((record) => record.date !== date)) throw Error("當日回復點的日期不一致");
    const existing = new Map(current.records.map((record) => [record.id, record]));
    const additions = backup.records.filter((record) => !existing.has(record.id));
    if (backup.records.some((record) => existing.get(record.id)?.type &&
      existing.get(record.id).type !== record.type))
      throw Error("既有紀錄使用相同 ID 但類別不同，請以下載檔逐筆核對");
    const dayBackups = { ...state.dayBackups };
    delete dayBackups[date];
    const next = { version: Math.max(current.version, backup.version), records: [...current.records, ...additions] };
    commitLocal(storage, snapshot, next, { ...state, dayBackups });
    await putDayRecovery(key, undefined).catch(() => {});
    return { restored: additions.length, kept: backup.records.length - additions.length };
  });
}
