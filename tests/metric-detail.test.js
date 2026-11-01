import { describe, it, expect } from "vitest";
import { metricRange, metricDay, metricPeriod, metricTypes } from "../src/metric-detail.js";

const data = (...records) => ({ version: 7, records });
const r = (id, type, date, details = {}) => ({ id, type, date, ...details });

describe("日／週／月統計日期", () => {
  it("六種生活項目都有日週月", () => {
    expect(metricTypes).toEqual(["coffee", "water", "beverage", "activity", "sunlight", "spending"]);
    expect(metricRange("2026-11-02", "day")).toEqual({ start: "2026-11-02", end: "2026-11-02" });
    expect(metricRange("2026-11-02", "week")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(metricRange("2026-11-08", "week")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(metricRange("2026-01-01", "week")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(metricRange("2028-02-17", "month")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("空白日期不是 0，月統計不延伸到其他月份", () => {
    const v = metricPeriod(data(r("a", "water", "2026-10-31", { status: "已飲用", volume: 200 })), "2026-11-02", "month", "water");
    expect(v.value).toBeNull();
    expect(v.observedDays).toBe(0);
    expect(v.days).toHaveLength(30);
  });
});
describe("液體攝取：只算確定喝下的量", () => {
  it("兌換咖啡喝完才計入；券不重算花費", () => {
    const d = data(
      r("a", "coffee", "2026-11-02", { status: "飲用中", volume: null, payment: "voucher", amount: null }),
      r("b", "coffee", "2026-11-02", { status: "已飲用", volume: 480, payment: "voucher", amount: null }),
      r("c", "coffee", "2026-11-03", { status: "已飲用", volume: 320, payment: "purchase", amount: 75, purchaseDate: "2026-11-02" }),
    );
    expect(metricDay(d, "2026-11-02", "coffee")).toMatchObject({ value: 480, pending: 1, unknown: 0 });
    expect(metricDay(d, "2026-11-02", "spending")).toMatchObject({ value: 75, count: 1 });
    expect(metricPeriod(d, "2026-11-02", "week", "coffee").value).toBe(800);
  });
  it("裝水容量、飲用中、未知容量不得猜算", () => {
    const d = data(
      r("a", "water", "2026-11-02", { status: "飲用中", capacity: 700, volume: null }),
      r("b", "water", "2026-11-02", { status: "已飲用", volume: null }),
      r("c", "water", "2026-11-02", { status: "已飲用", volume: 600 }),
    );
    expect(metricDay(d, "2026-11-02", "water")).toMatchObject({ value: 600, pending: 1, unknown: 1 });
  });
  it("飲品只算已飲用，未確認付款另處理", () => {
    const d = data(
      r("a", "beverage", "2026-11-02", { status: "飲用中", volume: null, paid: null, amount: null, paymentDate: null }),
      r("b", "beverage", "2026-11-02", { status: "已飲用", volume: 700, paid: true, amount: 40, paymentDate: "2026-11-02" }),
    );
    expect(metricDay(d, "2026-11-02", "beverage")).toMatchObject({ value: 700, pending: 1 });
    expect(metricDay(d, "2026-11-02", "spending").value).toBe(40);
  });
});
describe("活動與日照", () => {
  it("只計完成的步數與時間", () => {
    const d = data(
      r("a", "activity", "2026-11-02", { status: "未完成", steps: 5000, minutes: 60 }),
      r("b", "activity", "2026-11-02", { status: "已完成", steps: 4200, minutes: 35 }),
      r("c", "activity", "2026-11-03", { status: "已完成", steps: 3000, minutes: null }),
    );
    const m = metricPeriod(d, "2026-11-02", "week", "activity");
    expect(m.value).toBe(7200);
    expect(m.minutes).toEqual({ value: 35, unknown: 1 });
    expect(m.pending).toBe(1);
  });
  it("日照的已確認零與缺漏必須分開", () => {
    const d = data(
      r("a", "sunlight", "2026-11-02", { status: "已記錄", minutes: 0 }),
      r("b", "sunlight", "2026-11-03", { status: "已記錄", minutes: null }),
    );
    const v = metricPeriod(d, "2026-11-02", "week", "sunlight");
    expect(v.value).toBe(0);
    expect(v.unknown).toBe(1);
    expect(v.observedDays).toBe(2);
    expect(v.days.find((x) => x.date === "2026-11-04").value).toBeNull();
  });
});
describe("花費：依實際付款日分帳，不重複扣券", () => {
  it("購買、退費、回補分開，未知金額保留", () => {
    const d = data(
      r("a", "spending", "2026-11-02", { status: "已付款", transactionKind: "purchase", amount: 100 }),
      r("b", "spending", "2026-11-02", { status: "已付款", transactionKind: "refund", amount: 20 }),
      r("c", "spending", "2026-11-03", { status: "已付款", transactionKind: "reimbursement", amount: 10 }),
      r("d", "spending", "2026-11-03", { status: "已付款", transactionKind: "purchase", amount: null }),
      r("e", "spending", "2026-11-02", { status: "未付款", amount: 900 }),
      r("f", "meal", "2026-11-01", { status: "吃完", paid: true, paymentDate: "2026-11-02", amount: 110 }),
    );
    const v = metricPeriod(d, "2026-11-02", "week", "spending");
    expect(v.purchase.value).toBe(210);
    expect(v.refund.value).toBe(20);
    expect(v.reimbursement.value).toBe(10);
    expect(v.value).toBe(180);
    expect(v.unknown).toBe(1);
    expect(v.count).toBe(5);
    expect(v.entries.find((x) => x.record.id === "f").date).toBe("2026-11-02");
  });
  it("只有未知金額時不顯示 0 元", () => {
    const d = data(r("a", "spending", "2026-11-02", { status: "已付款", amount: null }));
    const v = metricDay(d, "2026-11-02", "spending");
    expect(v.value).toBeNull();
    expect(v.unknown).toBe(1);
  });
  it("統計純讀取，不修改原始備份", () => {
    const d = data(r("a", "coffee", "2026-11-02", { status: "已飲用", volume: 480 }));
    const before = JSON.stringify(d);
    metricPeriod(d, "2026-11-02", "month", "coffee");
    expect(JSON.stringify(d)).toBe(before);
  });
});
