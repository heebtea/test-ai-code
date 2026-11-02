import { it, expect } from "vitest";
import {
  metricDay,
  metricPeriod,
  metricRange,
  moveMetricDate,
} from "../src/metric-model.js";
import {
  upsert,
  parseBackup,
  merge,
  validateRecord,
  localDate,
  fields,
  statuses,
} from "../src/data.js";
const day = "2026-11-02",
  data = (...records) => ({ version: 8, records });
const record = (type, id, extra = {}) => ({
  id,
  type,
  date: day,
  status: statuses[type][0],
  time: "12:00",
  note: "synthetic",
  ...Object.fromEntries(Object.keys(fields[type]).map((k) => [k, null])),
  ...(type === "coffee" ? { payment: "voucher", purchaseDate: null } : {}),
  ...(type === "meal"
    ? {
        name: "合成便當",
        paid: null,
        paymentDate: null,
        orderDate: null,
        startTime: "",
        endTime: "",
      }
    : {}),
  ...(type === "sunlight" ? { source: "" } : {}),
  ...extra,
});
it("same coffee transitions and corrections remain one ID and one charge across day/week/month", () => {
  let d = data(
    record("coffee", "one", {
      payment: "purchase",
      purchaseDate: day,
      amount: 60,
      volume: 480,
      status: "飲用中",
    }),
  );
  expect(metricDay(d, day, "coffee")).toMatchObject({
    value: null,
    pending: 1,
    state: "有紀錄但尚未完成",
  });
  d = upsert(d, { ...d.records[0], status: "已飲用", volume: 350 });
  d = upsert(d, { ...d.records[0], volume: 400 });
  expect(d.records).toHaveLength(1);
  for (const period of ["day", "week", "month"]) {
    expect(metricPeriod(d, day, period, "coffee").value).toBe(400);
    expect(metricPeriod(d, day, period, "spending").value).toBe(60);
  }
});
it("two cups, purchased/ redeemed pending and unknown volume retain separate statuses", () => {
  const d = data(
    record("coffee", "a", { volume: 480, status: "已飲用" }),
    record("coffee", "b", { volume: 300, status: "已飲用" }),
    record("coffee", "c", { volume: 480, status: "已購買" }),
    record("coffee", "d", { volume: null, status: "已飲用" }),
  );
  expect(metricDay(d, day, "coffee")).toMatchObject({
    value: 780,
    confirmed: 3,
    pending: 1,
    unknown: 1,
    count: 4,
  });
});
it("valid-day average excludes gaps and pending, includes explicit zero, discloses partial known values", () => {
  const d = data(
    record("sunlight", "a", { minutes: 0 }),
    record("sunlight", "b", { date: "2026-11-03", minutes: 20 }),
    record("sunlight", "c", { date: "2026-11-04", minutes: null }),
  );
  expect(metricPeriod(d, day, "week", "sunlight")).toMatchObject({
    value: 20,
    average: 10,
    validDays: 2,
    observedDays: 3,
    unknown: 1,
  });
  expect(metricDay(d, day, "sunlight").state).toBe("已確認為零");
  expect(metricDay(d, "2026-11-05", "sunlight").state).toBe("本機沒有紀錄");
  expect(metricDay(d, "2026-11-04", "sunlight").state).toContain("未知");
});
it("three ordered lunches, one personal portion; payment and eating remain independent", () => {
  const lunch = record("meal", "lunch", {
    mealType: "lunch",
    orderStatus: "ordered",
    quantity: 3,
    consumedQuantity: 1,
    familyQuantity: 2,
    remainingQuantity: 0,
    status: "吃完",
    paid: true,
    paymentDate: day,
    amount: 300,
  });
  const d = data(lunch);
  expect(metricPeriod(d, day, "week", "meal")).toMatchObject({
    value: 1,
    completed: 1,
    personal: { value: 1 },
  });
  expect(metricPeriod(d, day, "month", "spending").value).toBe(300);
  const paid = data({
    ...lunch,
    status: "未確認",
    consumedQuantity: null,
    familyQuantity: null,
    remainingQuantity: 3,
  });
  expect(metricDay(paid, day, "meal")).toMatchObject({
    value: null,
    pending: 1,
  });
  expect(metricDay(paid, day, "spending").value).toBe(300);
  const others = data({ ...lunch, consumedQuantity: 0, familyQuantity: 3 });
  expect(metricDay(others, day, "meal").value).toBe(0);
});
it("legacy eaten meal has no inferred self-consumption; partial personal eating counts once", () => {
  const legacy = record("meal", "old", { status: "吃完" });
  expect(metricDay(data(legacy), day, "meal")).toMatchObject({
    value: null,
    unknown: 1,
  });
  expect(
    metricDay(
      data({ ...legacy, status: "部分", consumedQuantity: 0.5 }),
      day,
      "meal",
    ),
  ).toMatchObject({
    value: 1,
    extra: { completed: 0, personal: { value: 0.5 } },
  });
});
it("same-day explicit overlapping activities are excluded, not prorated or double-added", () => {
  const a = record("activity", "a", {
      status: "已完成",
      steps: 1000,
      minutes: 30,
      startTime: "09:00",
      endTime: "09:30",
    }),
    b = { ...a, id: "b", startTime: "09:15", endTime: "09:45" },
    c = { ...a, id: "c", startTime: "10:00", endTime: "10:30", steps: 2000 };
  const stats = metricDay(data(a, b, c), day, "activity");
  expect(stats).toMatchObject({
    value: 2000,
    excluded: 2,
    extra: { minutes: { value: 30 } },
  });
  expect(stats.warnings.join("")).toContain("重疊");
  expect(
    metricDay(
      data(a, { ...b, startTime: "09:30", endTime: "10:00" }),
      day,
      "activity",
    ).value,
  ).toBe(2000);
});
it("multiple activities without intervals cannot be proven independent; malformed duration warns", () => {
  const a = record("activity", "a", {
    status: "已完成",
    steps: 1000,
    minutes: 30,
  });
  expect(metricDay(data(a, { ...a, id: "b" }), day, "activity")).toMatchObject({
    value: null,
    excluded: 2,
  });
  expect(
    metricDay(
      data({ ...a, startTime: "09:00", endTime: "09:15" }),
      day,
      "activity",
    ).excluded,
  ).toBe(1);
});
it("real payment date determines spending; refund/reimbursement separated, unknown not zero, vouchers excluded", () => {
  const d = data(
    record("spending", "p", {
      status: "已付款",
      paymentDate: "2026-11-03",
      transactionKind: "purchase",
      amount: 300,
    }),
    record("spending", "r", {
      status: "已付款",
      paymentDate: "2026-11-03",
      transactionKind: "refund",
      amount: 20,
    }),
    record("spending", "b", {
      status: "已付款",
      paymentDate: "2026-11-03",
      transactionKind: "reimbursement",
      amount: 10,
    }),
    record("spending", "u", {
      status: "已付款",
      paymentDate: "2026-11-03",
      amount: null,
    }),
    record("coffee", "v", { status: "已飲用", volume: 480 }),
  );
  expect(metricDay(d, day, "spending").value).toBeNull();
  const m = metricPeriod(d, day, "month", "spending");
  expect(m).toMatchObject({
    value: 270,
    unknown: 1,
    purchase: { value: 300 },
    refund: { value: 20 },
    reimbursement: { value: 10 },
  });
  expect(
    metricDay(
      data(
        record("spending", "u", {
          status: "已付款",
          paymentDate: null,
          amount: 99,
        }),
      ),
      day,
      "spending",
    ),
  ).toMatchObject({ value: null, pending: 1 });
});
it("natural month and Monday weeks include boundaries; month weeks are clipped and totals reconcile", () => {
  const d = data(
    record("coffee", "a", {
      date: "2026-10-31",
      status: "已飲用",
      volume: 100,
    }),
    record("coffee", "b", {
      date: "2026-11-01",
      status: "已飲用",
      volume: 200,
    }),
    record("coffee", "c", {
      date: "2026-11-02",
      status: "已飲用",
      volume: 300,
    }),
  );
  expect(metricPeriod(d, "2026-11-01", "week", "coffee").value).toBe(300);
  const m = metricPeriod(d, day, "month", "coffee");
  expect(m.value).toBe(500);
  expect(m.weeks.reduce((n, w) => n + (w.value ?? 0), 0)).toBe(500);
  expect(m.weeks[0]).toMatchObject({ start: "2026-11-01", end: "2026-11-01" });
  expect(moveMetricDate("2026-01-31", "month", 1)).toBe("2026-02-01");
  expect(metricRange("2028-02-12", "month").end).toBe("2028-02-29");
  expect(localDate(new Date("2026-11-01T16:01:00Z"))).toBe("2026-11-02");
});
it("invalid/load failure and duplicate IDs are not silently transformed into no records", () => {
  expect(() => metricPeriod(null, day, "week", "coffee")).toThrow("載入");
  expect(() => metricPeriod({ records: {} }, day, "week", "coffee")).toThrow(
    "解析",
  );
  expect(() => metricRange("2026-02-30", "month")).toThrow("無效");
  const r = record("coffee", "duplicate");
  expect(() => metricDay(data(r, r), day, "coffee")).toThrow("重複 ID");
});
it("statistics are read-only; v8 extensions round trip and legacy versions do not auto-upgrade", () => {
  const old = { version: 5, records: [record("coffee", "a", { volume: 480 })] },
    bytes = JSON.stringify(old);
  metricPeriod(old, day, "month", "coffee");
  expect(JSON.stringify(old)).toBe(bytes);
  expect(parseBackup(bytes)).toEqual(old);
  const meal = record("meal", "new", {
    mealType: "lunch",
    orderStatus: "ordered",
    quantity: 3,
    consumedQuantity: 1,
    familyQuantity: 2,
    remainingQuantity: 0,
    status: "吃完",
  });
  const updated = upsert(old, meal);
  expect(updated.version).toBe(8);
  expect(parseBackup(JSON.stringify(updated))).toEqual(updated);
  expect(merge(old, updated).data.version).toBe(8);
  expect(() => parseBackup(JSON.stringify({ ...updated, version: 6 }))).toThrow(
    "新版",
  );
  expect(() => validateRecord({ ...meal, consumedQuantity: 2 })).toThrow(
    "超過",
  );
});
it("cashflow with only a refund can be negative; the average preserves its sign", () => {
  const r = record("spending", "r", {
    status: "已付款",
    transactionKind: "refund",
    amount: 20,
  });
  expect(metricPeriod(data(r), day, "month", "spending")).toMatchObject({
    value: -20,
    average: -20,
    validDays: 1,
  });
});
