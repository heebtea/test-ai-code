// @vitest-environment jsdom
import { beforeEach, it, expect, vi } from "vitest";
import * as m from "../src/data.js";
const r = (type = "water", extra = {}) => ({
  id: "test-id",
  type,
  date: "2026-01-02",
  status: m.statuses[type][0],
  note: "",
  time: "",
  ...Object.fromEntries(Object.keys(m.fields[type]).map((k) => [k, null])),
  volume: 200,
  ...extra,
});
it("empty state and date boundaries", () => {
  expect(m.loadRecords(localStorage)).toEqual(m.empty());
  expect(m.rows(m.empty(), "2026-01-02", "water")).toEqual([]);
  expect(m.shiftDate("2024-02-28", 1)).toBe("2024-02-29");
  expect(m.validDate("2026-02-30")).toBe(false);
});
it("CRUD, stable correction, date isolation", () => {
  let d = m.upsert(m.empty(), r());
  d = m.upsert(d, r("water", { volume: 300 }));
  expect(d.records).toHaveLength(1);
  expect(m.sum(d.records, "volume").value).toBe(300);
  expect(m.rows(d, "2026-01-03", "water")).toEqual([]);
  expect(m.remove(d, "test-id").records).toEqual([]);
  expect(() => m.upsert(d, r("water", { date: "2026-01-03" }))).toThrow();
});
it("unknown is not zero; expenses sum individually and exclude vouchers/unpaid", () => {
  const coffee = r("coffee", {
    payment: "purchase",
    volume: null,
    amount: null,
    note: "unknown price",
  });
  const voucher = r("coffee", {
    id: "voucher",
    payment: "voucher",
    volume: 250,
    amount: null,
  });
  const expense = r("spending", {
    id: "paid",
    volume: undefined,
    amount: 12.35,
    status: "已付款",
  });
  delete expense.volume;
  const unpaid = { ...expense, id: "unpaid", status: "未付款", amount: 100 };
  const d = { version: 2, records: [coffee, voucher, expense, unpaid] };
  m.validate(d);
  expect(m.sum(m.expenses(d, coffee.date), "amount")).toEqual({
    value: 12.35,
    unknown: 1,
  });
  expect(m.sum([coffee], "amount").value).toBeNull();
  expect(m.sum([{ amount: 0 }], "amount").value).toBe(0);
  expect(() => m.validateRecord({ ...voucher, amount: 0 })).toThrow();
});
it("all types can be corrected and deleted", () => {
  for (const type of m.types) {
    const v = {
      id: type,
      date: "2026-01-02",
      type,
      status: m.statuses[type][0],
      note: "confirmed",
      time: "",
      ...Object.fromEntries(Object.keys(m.fields[type]).map((k) => [k, null])),
      ...(type === "coffee" ? { payment: "purchase" } : {}),
    };
    const d = m.upsert(m.empty(), v);
    expect(m.upsert(d, { ...v, note: "corrected" }).records).toHaveLength(1);
    expect(m.remove(d, type).records).toHaveLength(0);
  }
});
it("backup roundtrip, repeated import and conflicts preserve local", () => {
  const d = m.upsert(m.empty(), r());
  expect(m.parseBackup(JSON.stringify(d))).toEqual(d);
  expect(m.merge(d, d).data).toEqual(d);
  const result = m.merge(d, m.upsert(d, r("water", { volume: 999 })));
  expect(result.conflicts).toBe(1);
  expect(result.data).toEqual(d);
});
it("reject malformed, duplicate, unsafe and invalid data without mutation", () => {
  for (const s of [
    "null",
    "{}",
    "{bad",
    JSON.stringify({ version: 2, records: [r(), r()] }),
    JSON.stringify({ version: 2, records: [r("water", { volume: -1 })] }),
    JSON.stringify({ version: 2, records: [r("water", { extra: "x" })] }),
    JSON.stringify({ version: 2, records: [r("water", { volume: "3" })] }),
  ])
    expect(() => m.parseBackup(s)).toThrow();
  expect(() => m.validateRecord(r("water", { time: "25:00" }))).toThrow();
});
it("storage failure propagates and corrupted original is preserved", () => {
  const storage = { getItem: () => "{broken", setItem: vi.fn() };
  expect(() => m.loadRecords(storage)).toThrow();
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(() =>
    m.persist(
      {
        setItem: () => {
          throw Error("quota");
        },
      },
      m.empty(),
    ),
  ).toThrow("quota");
});
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  await import("../src/main.js");
});
it("UI empty, add, edit same ID, date isolation and delete confirmation", () => {
  expect(document.querySelectorAll(".metric")).toHaveLength(5);
  expect(
    [...document.querySelectorAll(".metric")].every(
      (e) => e.textContent === "尚無資料",
    ),
  ).toBe(true);
  document.querySelector("[data-add=water]").click();
  document.querySelector("[name=volume]").value = "250";
  document.querySelector("#edit-form").requestSubmit();
  document.querySelector("[data-edit]").click();
  document.querySelector("[name=volume]").value = "350";
  document.querySelector("#edit-form").requestSubmit();
  expect(JSON.parse(localStorage.getItem(m.STORAGE_KEY)).records).toHaveLength(
    1,
  );
  document.querySelector("#prev").click();
  expect(document.querySelector(".water .metric").textContent).toBe("尚無資料");
  document.querySelector("#next").click();
  expect(document.querySelector(".water .metric").textContent).toContain("350");
  document.querySelector("[data-delete]").click();
  document.querySelector("#no").click();
  expect(document.querySelector("[data-edit]")).not.toBeNull();
  document.querySelector("[data-delete]").click();
  document.querySelector("#yes").click();
  expect(document.querySelector("[data-edit]")).toBeNull();
});
it("UI escapes malicious notes and does not insert HTML", () => {
  document.querySelector("[data-add=spending]").click();
  document.querySelector("[name=note]").value = "<img src=x onerror=alert(1)>";
  document.querySelector("#edit-form").requestSubmit();
  expect(document.querySelector(".spending img")).toBeNull();
  expect(document.querySelector(".spending").textContent).toContain("<img");
});
it("UI failed writes do not change state", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw Error("quota");
  });
  document.querySelector("[data-add=water]").click();
  document.querySelector("[name=volume]").value = "12";
  document.querySelector("#edit-form").requestSubmit();
  expect(document.querySelector("#editor .error").textContent).toContain(
    "未儲存",
  );
  expect(document.querySelector(".water .metric").textContent).toBe("尚無資料");
  vi.restoreAllMocks();
});
it("UI corrupt storage locks writes; theme failure is handled", async () => {
  localStorage.setItem(m.STORAGE_KEY, "broken");
  vi.resetModules();
  await import("../src/main.js");
  expect(document.querySelector("[data-add]").disabled).toBe(true);
  expect(localStorage.getItem(m.STORAGE_KEY)).toBe("broken");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("blocked");
  });
  document.querySelector("#theme").click();
  expect(document.querySelector("#message").textContent).toContain(
    "無法儲存偏好",
  );
  vi.restoreAllMocks();
});

it("rejects invalid dates, ranges, fractions and oversize backups", () => {
  for (const date of ["2026-99-01", "2026-02-29", "bad", "1899-01-01"])
    expect(m.validDate(date)).toBe(false);
  for (const volume of [undefined, Infinity, NaN, 1.2, -1, 100001])
    expect(() => m.validateRecord(r("water", { volume }))).toThrow();
  expect(() => m.parseBackup(" ".repeat(10000001))).toThrow();
  expect(() =>
    m.validate({ version: 2, records: [], unexpected: 1 }),
  ).toThrow();
});
it("identical imported content with different key order is not a conflict", () => {
  const d = m.upsert(m.empty(), r());
  const reordered = Object.fromEntries(Object.entries(d.records[0]).reverse());
  expect(m.merge(d, { version: 2, records: [reordered] }).conflicts).toBe(0);
});
it("another tab update cannot be overwritten", () => {
  document.querySelector("[data-add=water]").click();
  document.querySelector("[name=volume]").value = "22";
  localStorage.setItem(m.STORAGE_KEY, JSON.stringify(m.upsert(m.empty(), r())));
  document.querySelector("#edit-form").requestSubmit();
  expect(document.querySelector("#editor .error").textContent).toContain(
    "另一分頁",
  );
  expect(
    JSON.parse(localStorage.getItem(m.STORAGE_KEY)).records[0].volume,
  ).toBe(200);
});
it("sleep stages cannot exceed total and amounts preserve decimal precision", () => {
  expect(() =>
    m.validateRecord({
      id: "sleep",
      date: "2026-01-01",
      type: "sleep",
      status: "已完成",
      note: "",
      time: "",
      minutes: 10,
      deep: 8,
      rem: 8,
      score: null,
    }),
  ).toThrow();
  expect(m.sum([{ amount: 0.1 }, { amount: 0.2 }], "amount").value).toBe(0.3);
});
