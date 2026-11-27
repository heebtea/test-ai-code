import { canonical, parseComplete } from "./backup.js";
import { loadRecords, persist, STORAGE_KEY, validate } from "./data.js";
import { isDeletedLocally, readSyncState } from "./private-sync.js";
import { guardedWrite } from "./storage-guard.js";

export const MAX_RECORD_IMPORT = 10_000_000;

export function previewRecordImport(text, storage) {
  if (text.length > MAX_RECORD_IMPORT) throw Error("檔案超過 10 MB");
  const incoming = parseComplete(text, { rejectDuplicateRecords: true });
  if (!incoming.legacy) throw Error("完整備份請使用「還原完整／舊版備份」");
  const snapshot = storage.getItem(STORAGE_KEY);
  const current = loadRecords(storage);
  const sync = readSyncState(storage);
  const byId = new Map(current.records.map((record) => [record.id, record]));
  const errors = [...incoming.errors];
  const version = Math.max(current.version, incoming.version);
  const rows = [];

  for (const entry of incoming.entries) {
    const { id, value: record } = entry;
    const before = byId.get(id);
    if (!before) {
      const deleted = isDeletedLocally(sync, id);
      rows.push({ id, record, state: deleted ? "deleted" : "new" });
      continue;
    }
    if (before.type !== record.type) {
      rows.push({ id, record, before, state: "category" });
      continue;
    }
    // Older exports omit newer optional fields. An explicit null is a correction.
    const after = { ...before, ...record };
    try {
      validate({ version, records: [after] });
      rows.push({ id, record, before, after, state: canonical(before) === canonical(after) ? "same" : "conflict" });
    } catch (error) {
      errors.push({ id, reason: error.message });
    }
  }
  return { snapshot, current, version, rows, errors };
}

export function recordImportCounts(preview, choices) {
  const counts = { added: 0, updated: 0, same: 0, conflicts: 0, skipped: 0, invalid: preview.errors.length };
  for (const row of preview.rows) {
    if (row.state === "new") counts.added++;
    if (row.state === "same") counts.same++;
    if (["conflict", "category"].includes(row.state)) counts.conflicts++;
    if (row.state === "conflict" && choices.get(row.id) === "incoming") counts.updated++;
    else if (["conflict", "category", "deleted"].includes(row.state)) counts.skipped++;
  }
  return counts;
}

export function applyRecordImport(preview, choices, storage) {
  return guardedWrite(() => {
    if (storage.getItem(STORAGE_KEY) !== preview.snapshot)
      throw Error("紀錄已更新，請重新選擇檔案預覽");
    const records = new Map(preview.current.records.map((record) => [record.id, record]));
    const sync = readSyncState(storage);
    const counts = recordImportCounts(preview, choices);
    for (const row of preview.rows) {
      if (row.state === "new") {
        if (isDeletedLocally(sync, row.id)) throw Error("刪除狀態已更新，請重新預覽");
        records.set(row.id, row.record);
      }
      if (row.state === "conflict") {
        const choice = choices.get(row.id);
        if (choice === "incoming") records.set(row.id, row.after);
        else if (choice !== "local") throw Error("請先決定每筆衝突的處理方式");
      }
    }
    if (counts.added || counts.updated) {
      persist(storage, { version: preview.version, records: [...records.values()] });
    }
    return counts;
  });
}

export function revisionHint(before, after) {
  const timestamp = (record) => Math.max(...["updatedAt", "correctedAt"].map(
    (key) => record[key] ? Date.parse(record[key]) : -Infinity,
  ));
  const local = timestamp(before), incoming = timestamp(after);
  if (!Number.isFinite(local) || !Number.isFinite(incoming)) return "至少一側未提供修改或補正時間";
  if (local === incoming) return "兩側最後修改或補正時間相同";
  return (incoming > local ? "匯入檔" : "現有紀錄") + "的修改或補正時間較晚";
}
