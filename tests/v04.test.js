import { it, expect } from "vitest";
import { timeline, journalSections } from "../src/journal.js";
import { parseBackup, upsert, empty, merge, liquidIntake } from "../src/data.js";
const day = "2026-01-02";
const common = (id, type) => ({
  id,
  type,
  date: day,
  note: "",
  time: "",
  status: "已記錄",
});
it("timeline sorts explicit timestamps and distinguishes partial completion", () => {
  const coffee = {
    ...common("c", "coffee"),
    status: "飲用中",
    payment: "voucher",
    volume: 400,
    amount: null,
    startTime: "10:00",
    endTime: "10:30",
  };
  const meal = {
    ...common("m", "meal"),
    status: "部分",
    name: "合成午餐",
    paid: null,
    paymentDate: null,
    orderDate: null,
    startTime: "12:00",
    endTime: "12:30",
    amount: null,
  };
  const event = { ...common("e", "event"), name: "測試事件", time: "09:00" };
  const data = { version: 4, records: [meal, coffee, event] };
  expect(timeline(data, day).map((x) => `${x.time} ${x.label}`)).toEqual([
    "09:00 重要事件",
    "10:00 開始喝咖啡",
    "10:30 結束飲用",
    "12:00 開始用餐",
    "12:30 結束用餐",
  ]);
  expect(journalSections(data, day).some((x) => x.title === "咖啡已飲用")).toBe(
    false,
  );
  expect(
    journalSections(data, day).find((x) => x.title === "餐點").value,
  ).toContain("部分");
  expect(upsert(empty(), event).records[0]).toEqual(event);
  expect(() => upsert(empty(), { ...event, time: "" })).toThrow();
});
it("v2 and v3 import remains exact and v4 backup round trips without duplication", () => {
  const record = {
    ...common("w", "water"),
    status: "已飲用",
    volume: 123,
    time: "09:10",
  };
  const old2 = { version: 2, records: [record] },
    old3 = { version: 3, records: [record] };
  const d = merge(empty(), parseBackup(JSON.stringify(old2))).data;
  expect(merge(d, parseBackup(JSON.stringify(old3))).added).toBe(0);
  expect(parseBackup(JSON.stringify(d))).toEqual(d);
  expect(journalSections({ version: 4, records: [] }, day)).toEqual([]);
});

it("legacy OCR drafts remain readable but are excluded from daily statistics", () => {
  const draft = {
    id: "old-ocr-draft", date: "", type: "draft", status: "待確認", note: "", time: "",
    classification: "unclassified", source: "舊圖卡片段", payload: JSON.stringify({ source: "待確認文字" }),
  };
  const backup = { version: 6, records: [draft] };
  expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  expect(merge(empty(), backup).data.records).toEqual([draft]);
  expect(journalSections(backup, day)).toEqual([]);
});

it("daily liquid total combines confirmed water coffee beverages without guessing pending volumes", () => {
  const records = [
    { id: "water-done", type: "water", date: day, status: "已飲用", note: "", time: "", volume: 100 },
    { id: "water-pending", type: "water", date: day, status: "飲用中", note: "", time: "", volume: null, capacity: 800, startTime: "19:33", endTime: "" },
    { id: "coffee-done", type: "coffee", date: day, status: "已飲用", note: "", time: "", volume: 480, amount: null, payment: "voucher", startTime: "08:08", endTime: "09:20" },
    { id: "coffee-pending", type: "coffee", date: day, status: "飲用中", note: "", time: "", volume: 250, amount: null, payment: "voucher" },
    { id: "tea-done", type: "beverage", date: day, status: "已飲用", note: "", time: "", name: "無糖茶", volume: 700, amount: null, paid: null, paymentDate: null, startTime: "11:00", endTime: "12:00" },
    { id: "cola-done", type: "beverage", date: day, status: "已飲用", note: "", time: "", name: "可樂", volume: 700, amount: null, paid: null, paymentDate: null, startTime: "18:00", endTime: "18:35" },
    { id: "tea-pending", type: "beverage", date: day, status: "飲用中", note: "", time: "", name: "未喝完茶", volume: 500, amount: null, paid: null, paymentDate: null, startTime: "", endTime: "" },
  ];
  const data = parseBackup(JSON.stringify({ version: 6, records }));
  const tally = liquidIntake(data, day);
  expect(tally.value).toBe(1980);
  expect(tally.pending).toBe(3);
  expect(tally.breakdown.water.value).toBe(100);
  expect(tally.breakdown.coffee.value).toBe(480);
  expect(tally.breakdown.beverage.value).toBe(1400);
  expect(journalSections(data, day).find((x) => x.title === "今日已飲用總量").value).toBe("1,980 mL");
  expect(journalSections(data, day).find((x) => x.title === "飲水").value).toBe("100 mL");
  expect(() => parseBackup(JSON.stringify({ version: 6, records: [{ ...records[1], volume: 800 }] }))).toThrow();
  const completed = { ...records[1], status: "已飲用", volume: 800, endTime: "20:30" };
  const updated = { version: 6, records: records.map((r) => r.id === completed.id ? completed : r) };
  expect(liquidIntake(updated, day).value).toBe(2780);
  expect(liquidIntake({ version: 6, records }, "2026-01-03").value).toBeNull();
});
