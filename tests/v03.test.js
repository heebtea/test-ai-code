// @vitest-environment jsdom
import { it, expect } from "vitest";
import * as m from "../src/data.js";
const date = "2026-01-02";
const base = (type, extra = {}) => ({
  id: type,
  date,
  type,
  status: m.statuses[type][0],
  note: "",
  time: "",
  ...Object.fromEntries(Object.keys(m.fields[type]).map((k) => [k, null])),
  ...extra,
});
const meal = (extra = {}) =>
  base("meal", {
    name: "合成測試餐點",
    paid: null,
    paymentDate: null,
    orderDate: null,
    startTime: "",
    endTime: "",
    ...extra,
  });
it("v0.2 storage and JSON stay intact until explicit save; conflicts preserve old data", () => {
  const old = {
    version: 2,
    records: [
      base("coffee", {
        volume: 240,
        amount: 60,
        payment: "purchase",
        status: "已飲用",
      }),
    ],
  };
  const raw = JSON.stringify(old);
  localStorage.setItem(m.STORAGE_KEY, raw);
  expect(m.loadRecords(localStorage)).toEqual(old);
  expect(localStorage.getItem(m.STORAGE_KEY)).toBe(raw);
  const next = m.upsert(m.loadRecords(localStorage), meal());
  m.persist(localStorage, next);
  expect(next.version).toBe(4);
  expect(next.records[0]).toEqual(old.records[0]);
  const conflict = {
    version: 2,
    records: [{ ...old.records[0], amount: 999 }],
  };
  expect(m.merge(next, m.parseBackup(JSON.stringify(conflict))).conflicts).toBe(
    1,
  );
  expect(m.merge(next, old).added).toBe(0);
  expect(m.parseBackup(JSON.stringify(next))).toEqual(next);
});
it("meal and sunlight independent CRUD keep null and explicit zero", () => {
  for (const r of [
    meal(),
    base("sunlight", { minutes: null, source: "Apple Watch", note: "未知" }),
  ]) {
    const d = m.upsert(m.empty(), r);
    expect(d.records[0]).toEqual(r);
    expect(m.upsert(d, { ...r, note: "補正" }).records).toHaveLength(1);
    expect(m.remove(d, r.id).records).toEqual([]);
  }
  expect(
    m.sum([base("sunlight", { minutes: null })], "minutes").value,
  ).toBeNull();
  expect(m.sum([base("sunlight", { minutes: 0 })], "minutes").value).toBe(0);
  expect(m.sum([{ amount: undefined }, { amount: null }], "amount")).toEqual({
    value: null,
    unknown: 2,
  });
});
it("ordering, payment and partial eating are independent; prior purchases and vouchers do not double count", () => {
  const records = [
    meal({
      amount: 120,
      paid: true,
      orderDate: "2026-01-01",
      paymentDate: "2026-01-01",
      status: "部分",
    }),
    base("coffee", {
      payment: "purchase",
      purchaseDate: "2026-01-01",
      amount: 60,
      volume: 240,
      status: "已飲用",
    }),
    base("coffee", {
      id: "voucher",
      payment: "voucher",
      amount: null,
      volume: 240,
      status: "飲用中",
    }),
    base("spending", { amount: 500, status: "已付款", note: "合成購券支出" }),
  ];
  const d = { version: 3, records };
  m.validate(d);
  expect(m.sum(m.expenses(d, date), "amount").value).toBe(500);
  expect(m.sum(m.expenses(d, "2026-01-01"), "amount").value).toBe(180);
  expect(m.rows(d, date, "meal")[0].status).toBe("部分");
  expect(
    m.expenses(
      { version: 3, records: [meal({ paid: true, amount: 120 })] },
      date,
    ),
  ).toEqual([]);
  expect(
    m.expenses(
      { version: 3, records: [meal({ paid: false, amount: 120 })] },
      date,
    ),
  ).toEqual([]);
});
it("rejects inconsistent meal payment and malformed times/source", () => {
  for (const r of [
    meal({ paid: false, paymentDate: date }),
    meal({ name: "" }),
    meal({ startTime: "13:00", endTime: "12:00" }),
    meal({ paid: "yes" }),
    meal({ orderDate: "2026-02-30" }),
    base("sunlight", { minutes: 5, source: 3 }),
  ])
    expect(() => m.validateRecord(r)).toThrow();
});
it("meal UI saves separate fields and partial meal is never shown as fully eaten", async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  await import("../src/main.js");
  document.querySelector("[data-add=meal]").click();
  document.querySelector("[name=name]").value = "合成午餐";
  document.querySelector("[name=amount]").value = "99";
  document.querySelector("[name=status]").value = "部分";
  document.querySelector("[name=paid]").value = "yes";
  document.querySelector("[name=paymentDate]").value =
    document.querySelector("#date").value;
  document.querySelector("#edit-form").requestSubmit();
  expect(document.querySelector(".meal .metric").textContent).toContain(
    "完整食用尚無資料",
  );
  expect(document.querySelector(".spending .metric").textContent).toContain(
    "99",
  );
  document.querySelector(".meal [data-edit]").click();
  document.querySelector("[name=status]").value = "吃完";
  document.querySelector("#edit-form").requestSubmit();
  expect(document.querySelector(".meal .metric").textContent).toContain(
    "1 筆吃完",
  );
});
