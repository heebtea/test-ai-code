import { it, expect } from "vitest";
import { timeline, journalSections } from "../src/journal.js";
import { parseBackup, upsert, empty, merge } from "../src/data.js";
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
