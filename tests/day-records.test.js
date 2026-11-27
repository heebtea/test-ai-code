import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { applyComplete, exportComplete, prepareDayBackup, previewComplete } from "../src/backup.js";
import { cashflow, loadRecords, persist, STORAGE_KEY, THEME_KEY } from "../src/data.js";
import { deleteDayRecords, hasDayRecovery, mergeWithoutDeletedRecords, restoreDayRecords } from "../src/day-records.js";
import { getPhoto, putPhoto } from "../src/photos.js";
import { equal, readSyncState, resolveSyncConflict, synchronize, SYNC_KEY } from "../src/private-sync.js";
import { baseTemplate, listTemplates, putTemplate } from "../src/templates.js";
import { day, dayRecordsFixture } from "./fixtures/day-records.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const image = new Blob([Uint8Array.from(atob(png), (value) => value.charCodeAt(0))], { type: "image/png" });
const memory = () => {
  const state = new Map();
  return {
    getItem: (key) => state.get(key) ?? null,
    setItem: (key, value) => state.set(key, String(value)),
    removeItem: (key) => state.delete(key),
  };
};
let storage, initial;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const queues = new Map();
  vi.stubGlobal("navigator", { locks: { request(name, fn) {
    const next = (queues.get(name) || Promise.resolve()).then(fn);
    queues.set(name, next.catch(() => {}));
    return next;
  } } });
  storage = memory();
  vi.stubGlobal("localStorage", storage);
  initial = dayRecordsFixture();
  persist(storage, initial);
});
afterEach(() => vi.unstubAllGlobals());

it("backs up and removes only date-owned records, preserves cross-date transactions and resources, and restores after reload", async () => {
  const crossDate = { ...initial.records[6], id: "neighbor-transaction", date: "2026-11-26", paymentDate: day, amount: 20 };
  initial.records.push(crossDate);
  persist(storage, initial);
  storage.setItem(THEME_KEY, "dark");
  await putPhoto("event", image);
  await putPhoto("neighbor", image);
  await putTemplate({ ...baseTemplate(), id: "custom", name: "合成模板", image });
  const backup = await prepareDayBackup(day, initial, storage);
  const portable = JSON.parse(backup.text);
  expect(portable.photos.map(({ id }) => id)).toEqual(["event"]);
  expect(portable.records.records).toHaveLength(13);
  expect(portable.settings).toEqual({});
  expect(await deleteDayRecords(backup, storage)).toBe(13);
  expect(loadRecords(storage).records.map(({ id }) => id)).toEqual(["neighbor", "neighbor-transaction"]);
  expect(cashflow(loadRecords(storage), day).knownNet).toBe(20);
  expect(await getPhoto("event")).toBeInstanceOf(Blob);
  expect(await getPhoto("neighbor")).toBeInstanceOf(Blob);
  expect(await listTemplates()).toHaveLength(1);
  expect(storage.getItem(THEME_KEY)).toBe("dark");
  expect(JSON.parse(await exportComplete(storage)).photos.map(({ id }) => id)).toEqual(["neighbor"]);
  expect(hasDayRecovery(day, storage)).toBe(true);
  expect((await restoreDayRecords(day, storage)).restored).toBe(13);
  expect(hasDayRecovery(day, storage)).toBe(false);
  expect(cashflow(loadRecords(storage), day).knownNet).toBe(761);

  const fresh = memory();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const restore = await previewComplete(backup.text, fresh);
  const result = await applyComplete(restore, {}, fresh);
  expect(result).toMatchObject({ applied: 14, recordsRestoredFromDay: true });
  expect(await getPhoto("event")).toBeInstanceOf(Blob);
  expect(loadRecords(fresh).records).toEqual(portable.records.records);
});

it("a failed delete restores both record bytes and sync state; stale backup cannot delete newer records", async () => {
  const backup = await prepareDayBackup(day, initial, storage);
  const old = storage.getItem(STORAGE_KEY), write = storage.setItem;
  storage.setItem = (key, value) => { if (key === SYNC_KEY) throw Error("合成配額"); write(key, value); };
  await expect(deleteDayRecords(backup, storage)).rejects.toThrow("配額");
  expect(storage.getItem(STORAGE_KEY)).toBe(old);
  expect(hasDayRecovery(day, storage)).toBe(false);
  expect(storage.getItem(SYNC_KEY)).toBeNull();
  storage.setItem = write;
  persist(storage, { ...initial, records: initial.records.slice(1) });
  await expect(deleteDayRecords(backup, storage)).rejects.toThrow("已更新");
  expect(loadRecords(storage).records).toHaveLength(13);
});

function simulatedCloud() {
  const rows = new Map();
  return {
    rows,
    owner: "synthetic-only",
    async list() { return structuredClone([...rows.values()]); },
    async cas({ id, expected, record, deleted }) {
      const current = rows.get(id);
      if (current && current.deleted === deleted && equal(current.record, record)) return current;
      if ((current?.revision || 0) !== expected || (deleted && !current)) throw Error("409");
      const row = { id, revision: expected + 1, record, deleted, server_updated_at: "2026-11-27T08:00:00Z" };
      rows.set(id, row);
      return structuredClone(row);
    },
  };
}

it("propagates tombstones, blocks stale JSON, and syncs deliberate undo across synthetic devices", async () => {
  const adapter = simulatedCloud(), second = memory();
  const sync = (local) => synchronize({ storage: local, adapter });
  await sync(storage);
  await sync(second);
  await deleteDayRecords(await prepareDayBackup(day, initial, storage), storage);
  await sync(storage);
  await sync(second);
  expect(adapter.rows.get("water")).toMatchObject({ deleted: true, revision: 2, record: null });
  expect(loadRecords(second).records.map(({ id }) => id)).toEqual(["neighbor"]);
  const stale = mergeWithoutDeletedRecords(loadRecords(second), initial, readSyncState(second));
  expect(stale).toMatchObject({ added: 0, skipped: 13 });
  persist(second, stale.data);
  await sync(second);
  expect(adapter.rows.get("water").deleted).toBe(true);
  await restoreDayRecords(day, storage);
  await sync(storage);
  await sync(second);
  expect(adapter.rows.get("water")).toMatchObject({ deleted: false, revision: 3 });
  expect(loadRecords(second).records).toHaveLength(14);
});

it("retains a never-synced deletion and refuses to delete a remotely moved ID", async () => {
  const adapter = simulatedCloud();
  const water = initial.records[3];
  await deleteDayRecords(await prepareDayBackup(day, initial, storage), storage);
  await synchronize({ storage, adapter });
  expect(readSyncState(storage).dayDeletions.water).toMatchObject({ date: day, type: "water" });
  await adapter.cas({ id: water.id, expected: 0, record: water, deleted: false });
  const moved = { ...initial.records[0], date: "2026-11-29" };
  await adapter.cas({ id: moved.id, expected: 0, record: moved, deleted: false });
  const result = await synchronize({ storage, adapter });
  expect(adapter.rows.get(water.id).deleted).toBe(true);
  expect(adapter.rows.get(moved.id).deleted).toBe(false);
  expect(result.conflicts.map(({ id }) => id)).toEqual([moved.id]);
  await expect(resolveSyncConflict({ storage, adapter, id: moved.id, choice: "local" })).rejects.toThrow("其他日期");
  expect(loadRecords(storage).records.map(({ id }) => id)).toEqual(["neighbor"]);
});

it("does not overwrite a record moved to another date when restoring the downloaded day backup", async () => {
  const backup = await prepareDayBackup(day, initial, storage);
  await deleteDayRecords(backup, storage);
  const moved = { ...initial.records.find(({ id }) => id === "water"), date: "2026-11-29" };
  const remaining = loadRecords(storage);
  persist(storage, { ...remaining, records: [...remaining.records, moved] });
  const preview = await previewComplete(backup.text, storage);
  expect(preview.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "water", reason: expect.stringMatching(/日期或類別衝突/) }),
  ]));
  await applyComplete(preview, { "record:water": "replace" }, storage);
  expect(loadRecords(storage).records.filter(({ id }) => id === "water")).toEqual([moved]);
});
