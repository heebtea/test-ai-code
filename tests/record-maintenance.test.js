import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { applyComplete, exportComplete, prepareDayBackup, previewComplete } from "../src/backup.js";
import { drinkSummary, sleepSummary } from "../src/daily-summary.js";
import { cashflow, liquidIntake, loadRecords, persist, STORAGE_KEY, THEME_KEY } from "../src/data.js";
import { deleteDayRecords, hasDayRecovery, restoreDayRecords } from "../src/day-records.js";
import { journalDocumentSections } from "../src/journal-document.js";
import { metricPeriod } from "../src/metric-model.js";
import { getPhoto, putPhoto } from "../src/photos.js";
import { equal, readSyncState, resolveSyncConflict, synchronize, SYNC_KEY } from "../src/private-sync.js";
import { applyRecordImport, previewRecordImport, recordImportCounts } from "../src/record-import.js";
import { baseTemplate, listTemplates, putTemplate } from "../src/templates.js";
import { day, recordMaintenanceFixture } from "./fixtures/record-maintenance.js";

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
const choose = (preview, choice) => new Map(preview.rows.filter((r) => r.state === "conflict").map((r) => [r.id, choice]));
const encoded = JSON.stringify;
let storage, initial, corrections;
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
  ({ initial, corrections } = recordMaintenanceFixture());
  persist(storage, initial);
});
afterEach(() => vi.unstubAllGlobals());

it("corrects only explicitly selected records and recalculates day, week, month and journal without doubling money", async () => {
  const before = storage.getItem(STORAGE_KEY);
  const preview = previewRecordImport(encoded(corrections), storage);
  expect(storage.getItem(STORAGE_KEY)).toBe(before);
  expect(recordImportCounts(preview, choose(preview, "local"))).toMatchObject({ conflicts: 2, skipped: 2, updated: 0 });
  await applyRecordImport(preview, choose(preview, "local"), storage);
  expect(storage.getItem(STORAGE_KEY)).toBe(before);
  await applyRecordImport(preview, choose(preview, "incoming"), storage);
  const corrected = loadRecords(storage);
  expect(corrected.records.map(({ id }) => id)).toEqual(initial.records.map(({ id }) => id));
  expect(corrected.records.find((r) => r.type === "meal")).toEqual(initial.records.find((r) => r.type === "meal"));
  expect(liquidIntake(corrected, day)).toMatchObject({ value: 1971, breakdown: { water: { value: 900 }, coffee: { value: 1071 } } });
  expect(cashflow(corrected, day)).toMatchObject({ knownNet: 741, totals: { purchase: { value: 841 }, reimbursement: { value: 100 } } });
  for (const [period, water] of [["day", 900], ["week", 942], ["month", 942]]) {
    expect(metricPeriod(corrected, day, period, "water").value).toBe(water);
    expect(metricPeriod(corrected, day, period, "coffee").value).toBe(1071);
    expect(metricPeriod(corrected, day, period, "spending").value).toBe(741);
  }
  const sections = journalDocumentSections(corrected, day);
  expect(sections.find((entry) => entry.id === "liquid-summary").value).toContain("1971 mL");
  expect(sections.find((entry) => entry.id === "coffee-corrected").value).toContain("杯型標示容量");
  expect(sections.find((entry) => entry.id === "water").value).toContain("已飲用量 900 mL");
  expect(sections.find((entry) => entry.id === "expense-summary").value).toContain("741 NT$");
  const repeated = previewRecordImport(encoded(corrections), storage);
  expect(recordImportCounts(repeated, new Map())).toMatchObject({ added: 0, updated: 0, same: 2 });
  await applyRecordImport(repeated, new Map(), storage);
  expect(loadRecords(storage)).toEqual(corrected);
});

it("compares nested records canonically and skips duplicate and cross-type IDs", async () => {
  const segments = [{ start: "2026-11-27T00:00:00Z", end: "2026-11-27T01:00:00Z", stage: "core" }];
  const sleep = { ...initial.records[0], segments };
  persist(storage, { version: 8, records: [sleep, ...initial.records.slice(1)] });
  const data = {
    version: 8,
    records: [
      { ...sleep, segments: [{ stage: "core", end: segments[0].end, start: segments[0].start }] },
      { ...initial.records[3], id: "sleep" },
      { ...initial.records[3], id: "duplicate" },
      { ...initial.records[3], id: "duplicate", volume: -1 },
      null,
    ],
  };
  // Use a distinct existing ID for the cross-type conflict.
  data.records[1].id = "coffee-known";
  const preview = previewRecordImport(encoded(data), storage);
  expect(recordImportCounts(preview, new Map())).toEqual({ added: 0, updated: 0, same: 1, conflicts: 1, skipped: 1, invalid: 3 });
  await applyRecordImport(preview, choose(preview, "incoming"), storage);
  expect(loadRecords(storage).records.find(({ id }) => id === "coffee-known").type).toBe("coffee");
});

it.each([2, 3, 4, 5, 6, 7, 8])("imports v%s into v8 without guessing omitted metadata or numeric nulls", async (version) => {
  await applyRecordImport(previewRecordImport(encoded(corrections), storage), new Map([["coffee-corrected", "incoming"], ["water", "local"]]), storage);
  const oldCoffee = { ...initial.records[2] };
  delete oldCoffee.updatedAt;
  const old = { version, records: [{ ...oldCoffee, note: "舊版補正" }, { ...initial.records.at(-1), id: "legacy" }] };
  const preview = previewRecordImport(encoded(old), storage);
  expect(recordImportCounts(preview, choose(preview, "incoming"))).toMatchObject({ added: 1, updated: 1 });
  await applyRecordImport(preview, choose(preview, "incoming"), storage);
  expect(loadRecords(storage)).toMatchObject({ version: 8 });
  expect(loadRecords(storage).records.find((r) => r.id === oldCoffee.id)).toMatchObject({ volume: null, provenance: "合成補正", correctedAt: corrections.records[0].correctedAt });
});

it("leaves raw records untouched when the final write fails or another tab changes them", async () => {
  const preview = previewRecordImport(encoded(corrections), storage);
  const before = storage.getItem(STORAGE_KEY), write = storage.setItem;
  storage.setItem = (key, value) => { if (key === STORAGE_KEY) throw Error("合成儲存配額錯誤"); write(key, value); };
  await expect(applyRecordImport(preview, choose(preview, "incoming"), storage)).rejects.toThrow("配額");
  expect(storage.getItem(STORAGE_KEY)).toBe(before);
  storage.setItem = write;
  persist(storage, { ...initial, records: [...initial.records, { ...initial.records[0], id: "concurrent" }] });
  const after = storage.getItem(STORAGE_KEY);
  await expect(applyRecordImport(preview, choose(preview, "incoming"), storage)).rejects.toThrow("重新");
  expect(storage.getItem(STORAGE_KEY)).toBe(after);
});

it("distinguishes unknown, in progress, explicitly partial and zero consumption", () => {
  expect(sleepSummary(initial, day, initial.records.filter((record) => record.type === "sleep"))).toEqual(["8 小時 31 分鐘（511 分鐘）", "睡眠分數 80 分"]);
  expect(drinkSummary(initial.records.filter((record) => record.type === "coffee"), "coffee")).toEqual(["已完飲 2 杯", "已知容量 480 mL", "另 1 杯容量未知"]);
  const [water] = initial.records.filter((record) => record.type === "water");
  expect(drinkSummary([water], "water")).toEqual(["900 mL 飲用中", "實際攝取量待確認"]);
  expect(drinkSummary([{ ...water, status: "已飲用" }], "water")).toEqual(["1 筆已飲用，攝取量未知"]);
  const partial = { ...water, status: "部分", volume: 250 };
  const zero = { ...water, status: "已飲用", volume: 0, id: "zero" };
  const data = { version: 8, records: [partial, zero] };
  persist(storage, data);
  expect(drinkSummary(loadRecords(storage).records, "water")).toEqual(["0 mL 已飲用（已確認為零）", "250 mL 部分攝取"]);
  expect(liquidIntake(data, day)).toMatchObject({ value: 250, partial: 1 });
  expect(metricPeriod(data, day, "day", "water").value).toBe(250);
  expect(journalDocumentSections(data, day).find((entry) => entry.id === "water").value).toContain("部分攝取量 250 mL；裝水容量 900 mL");
});

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
  const stale = previewRecordImport(encoded(initial), second);
  expect(recordImportCounts(stale, new Map())).toMatchObject({ added: 0, skipped: 13, same: 1 });
  await applyRecordImport(stale, new Map(), second);
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
