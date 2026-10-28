// @vitest-environment jsdom
import { it, expect } from "vitest";
import { parseBackup, upsert, empty, validateRecord } from "../src/data.js";
import { sleepDay, sleepTrend, openSleepDetail } from "../src/sleep-detail.js";

const day = "2026-10-28";
const legacy = {
  id: "sleep-20261028", type: "sleep", date: day, status: "已完成",
  note: "", time: "", minutes: 355, deep: 65, rem: 48, score: 74,
};
it("renders legacy sleep breakdown without inventing awake or a timeline", () => {
  const data = parseBackup(JSON.stringify({ version: 5, records: [legacy] }));
  const result = sleepDay(data, day);
  expect(result).toMatchObject({
    count: 1, minutes: 355, deep: 65, rem: 48,
    core: 242, awake: null, score: 74, coreEstimated: true,
  });
  expect(result.segments).toEqual([]);
  document.body.innerHTML = '<dialog id="sleep-dialog"></dialog>';
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const dialog = document.querySelector("dialog");
  openSleepDetail(dialog, data, day);
  expect(dialog.textContent).toContain("5 小時 55 分");
  expect(dialog.textContent).toContain("4 小時 2 分");
  expect(dialog.textContent).toContain("清醒");
  expect(dialog.textContent).toContain("尚無資料");
  expect(dialog.querySelector(".sleep-stage-band")).not.toBeNull();
  expect(dialog.querySelector(".sleep-chart-panel")).toBeNull();
  expect(dialog.textContent).toContain("沒有真實起迄時間");
  for (const period of ["週", "月", "6 個月"]) {
    [...dialog.querySelectorAll(".sleep-tab")].find((b) => b.textContent === period).click();
    expect(dialog.querySelector(".sleep-trend-bars")).not.toBeNull();
    expect(dialog.textContent).toContain("缺漏日不視為 0 分鐘");
  }
});
it("keeps unrecorded days missing in trends and does not mix unrelated dates", () => {
  const data = { version: 5, records: [legacy] };
  const week = sleepTrend(data, day, "week");
  expect(week).toHaveLength(7);
  expect(week.filter((r) => r.average !== null)).toHaveLength(1);
  expect(week.at(-1).average).toBe(355);
  const month = sleepTrend(data, day, "month");
  expect(month).toHaveLength(30);
  expect(month.filter((r) => r.average === null)).toHaveLength(29);
  const six = sleepTrend(data, day, "sixMonths");
  expect(six).toHaveLength(6);
  expect(six.at(-1)).toEqual({ label: "10月", average: 355, days: 1 });
});
it("accepts only timezone-aware non-overlapping factual segments", () => {
  const detailed = {
    ...legacy, awake: 23, core: 242,
    segments: [
      { start: "2026-10-28T01:00:00+08:00", end: "2026-10-28T01:05:00+08:00", stage: "awake" },
      { start: "2026-10-28T01:05:00+08:00", end: "2026-10-28T01:20:00+08:00", stage: "core" },
    ],
  };
  expect(validateRecord(detailed)).toEqual(detailed);
  expect(upsert(empty(), detailed).records).toHaveLength(1);
  document.body.innerHTML = '<dialog id="sleep-dialog"></dialog>';
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  openSleepDetail(document.querySelector("dialog"), { version: 5, records: [detailed] }, day);
  expect(document.querySelector(".sleep-chart-panel svg")).not.toBeNull();
  expect(document.querySelectorAll(".sleep-chart-panel rect")).toHaveLength(2);
  expect(() => validateRecord({ ...detailed, segments: [{ ...detailed.segments[0], stage: "fictional" }] })).toThrow();
  expect(() => validateRecord({ ...detailed, segments: [{ ...detailed.segments[0], start: "2026-10-28T01:00:00" }] })).toThrow();
  expect(() => validateRecord({ ...detailed, segments: [detailed.segments[0], { ...detailed.segments[0] }] })).toThrow();
  expect(() => validateRecord({ ...detailed, core: 300 })).toThrow();
});
