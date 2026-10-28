// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { empty, upsert, STORAGE_KEY } from "../src/data.js";
const sample = {
  candidates: [
    {
      type: "sleep",
      date: "2026-01-02",
      minutes: 380,
      score: null,
      status: "已完成",
      recommended: true,
      reason: "數值及日期有辨識依據",
      source: "sleep",
    },
    {
      type: "activity",
      date: "2026-01-02",
      steps: 5432,
      status: "已完成",
      recommended: true,
      reason: "數值及日期有辨識依據",
      source: "steps",
    },
    {
      type: "sunlight",
      date: "2026-01-02",
      minutes: 12,
      status: "已記錄",
      recommended: true,
      reason: "數值及日期有辨識依據",
      source: "sun",
    },
    {
      type: "meal",
      date: "2026-01-02",
      name: "合成餐點",
      amount: null,
      recommended: false,
      reason: "狀態待確認",
      source: "meal",
    },
    {
      type: "spending",
      date: "2026-01-02",
      amount: 55,
      recommended: false,
      reason: "狀態待確認",
      source: "cost",
    },
  ],
  raw: { whole: "synthetic" },
};
vi.mock("../src/ocr.js", () => ({ recognizeCard: vi.fn(async () => sample) }));
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  await import("../src/main.js");
});
async function recognize() {
  document.querySelector("#ocr-open").click();
  const input = document.querySelector("#ocr-image");
  Object.defineProperty(input, "files", {
    value: [new File(["x"], "synthetic.png", { type: "image/png" })],
    configurable: true,
  });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".ocr-row")).toHaveLength(5),
  );
}
it("preselects supported metrics, leaves uncertain purchases unchecked, supports select/clear and one final confirmation", async () => {
  await recognize();
  const rows = [...document.querySelectorAll(".ocr-row")];
  expect(
    rows.filter((r) => r.querySelector("[data-select]").checked),
  ).toHaveLength(3);
  expect(rows.filter((r) => r.querySelector("details").open)).toHaveLength(0);
  document.querySelector("#ocr-clear").click();
  expect(document.querySelectorAll("[data-select]:checked")).toHaveLength(0);
  document.querySelector("#ocr-select-trusted").click();
  expect(document.querySelectorAll("[data-select]:checked")).toHaveLength(3);
  document.querySelector("#ocr-commit").click();
  expect(document.querySelector("#confirm").textContent).toContain("成功 3 筆");
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  document.querySelector("#no").click();
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  document.querySelector("#ocr-commit").click();
  document.querySelector("#yes").click();
  await vi.waitFor(() =>
    expect(document.querySelector("#ocr-result").textContent).toContain(
      "待處理 2 筆",
    ),
  );
  const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
  expect(d.records).toHaveLength(3);
  expect(d.records.map((r) => r.type).sort()).toEqual([
    "activity",
    "sleep",
    "sunlight",
  ]);
  expect(d.records.some((r) => r.type === "spending")).toBe(false);
  document.querySelector("#ocr-cancel").click();
  document.querySelector("#date").value = "2026-01-02";
  document.querySelector("#date").dispatchEvent(new Event("change"));
  expect(document.querySelector(".water .metric").textContent).toBe("尚無資料");
  expect(document.querySelector(".sleep .metric").textContent).toContain("380");
});
it("existing same day defaults to skip and another tab update cannot be overwritten", async () => {
  const r = {
    id: "old",
    type: "sleep",
    date: "2026-01-02",
    time: "",
    note: "",
    status: "已完成",
    minutes: 360,
    deep: null,
    rem: null,
    score: null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(upsert(empty(), r)));
  vi.resetModules();
  await import("../src/main.js");
  await recognize();
  const sleep = [...document.querySelectorAll(".ocr-row")].find(
    (x) => x.querySelector("strong").textContent === "睡眠",
  );
  expect(sleep.querySelector("[data-select]").checked).toBe(false);
  expect(sleep.dataset.conflict).toBe("true");
  document.querySelector("#ocr-commit").click();
  expect(document.querySelector("#confirm").textContent).toContain("跳過 1 筆");
  const other = upsert(JSON.parse(localStorage.getItem(STORAGE_KEY)), {
    id: "other",
    type: "water",
    date: "2026-01-02",
    time: "",
    note: "",
    status: "已飲用",
    volume: 123,
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
  document.querySelector("#yes").click();
  await vi.waitFor(() =>
    expect(document.querySelector("#confirm .error").textContent).toContain(
      "另一分頁",
    ),
  );
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(other);
});

it("selects every candidate, saves uncertain records as drafts in one confirmation", async () => {
  await recognize();
  document.querySelector("#ocr-select-all").click();
  expect(document.querySelectorAll("[data-select]:checked")).toHaveLength(5);
  document.querySelector("#ocr-commit").click();
  expect(document.querySelector("#confirm").textContent).toContain("暫存待確認 2 筆");
  document.querySelector("#yes").click();
  await vi.waitFor(() => expect(document.querySelector("#ocr-result").textContent).toContain("暫存待確認 2 筆"));
  const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  expect(data.records.filter(r => r.type === "draft")).toHaveLength(2);
  expect(data.records.some(r => r.type === "meal" || r.type === "spending")).toBe(false);
});
