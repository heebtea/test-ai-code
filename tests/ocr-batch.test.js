import { it, expect } from "vitest";
import { extractCandidates } from "../src/ocr.js";
import { candidateRecord, planCandidates } from "../src/ocr-records.js";
import { empty, upsert, parseBackup } from "../src/data.js";
const raw = {
  date: "2026.01.02",
  date2: "2026.01.02",
  sleep: "6 小時 20 分",
  sleepblock: "睡眠",
  steps: "5,432",
  sunlight: "12 分鐘",
  whole: "睡眠 步數 5,432 日照時間 12 分鐘",
  confidences: { date: 90, date2: 90, sleep: 90, steps: 90, sunlight: 90 },
};
it("only supported metrics with clear date and corroboration are recommended", () => {
  const result = extractCandidates(raw);
  expect(result.candidates.slice(0, 3).map((c) => c.recommended)).toEqual([
    true,
    true,
    true,
  ]);
  expect(result.candidates[0].minutes).toBe(380);
  expect(result.candidates[1].steps).toBe(5432);
  expect(
    extractCandidates({
      ...raw,
      confidences: { ...raw.confidences, steps: 10 },
    }).candidates[1].recommended,
  ).toBe(false);
  expect(
    extractCandidates({
      ...raw,
      date: "2026.01.02 2026.01.03",
    }).candidates.every((c) => !c.recommended),
  ).toBe(true);
  expect(
    extractCandidates({ ...raw, whole: "沒有來源文字" })
      .candidates.filter((c) => c.type !== "sleep")
      .every((c) => !c.recommended),
  ).toBe(true);
});
it("ambiguous meal coffee and spending stay unselected, require explicit status and never invent payment", () => {
  const found = extractCandidates({
    ...raw,
    whole: raw.whole + "\n12:00 午餐 $55\n咖啡 $40",
  }).candidates.filter((c) => ["meal", "coffee", "spending"].includes(c.type));
  expect(found.length).toBeGreaterThan(1);
  expect(found.every((c) => !c.recommended)).toBe(true);
  expect(() =>
    candidateRecord(
      { type: "spending", date: "2026-01-02", amount: "55", status: "" },
      "x",
    ),
  ).toThrow();
  const meal = candidateRecord(
    {
      type: "meal",
      date: "2026-01-02",
      name: "餐點",
      amount: "55",
      paid: "",
      status: "未確認",
    },
    "m",
  );
  expect(meal.paid).toBe(null);
  expect(meal.status).toBe("未確認");
});
it("different daily metrics require review; merge only fills blanks and v3 data stays intact", () => {
  const old = {
    id: "sleep",
    type: "sleep",
    date: "2026-01-02",
    time: "",
    note: "",
    status: "已完成",
    minutes: 380,
    deep: null,
    rem: null,
    score: null,
  };
  const initial = upsert(empty(), old);
  const values = {
    type: "sleep",
    date: old.date,
    time: "",
    note: "",
    status: "已完成",
    minutes: "400",
    score: "80",
  };
  expect(() => planCandidates(initial, [
    { id: "new", values, action: "skip" },
  ])).toThrow(/內容不同/);
  const merged = planCandidates(initial, [
    { id: "new", values, action: "merge", target: "sleep" },
  ]);
  expect(merged.data.records[0].minutes).toBe(380);
  expect(merged.data.records[0].score).toBe(80);
  const v3 = {
    version: 3,
    records: [
      {
        id: "water",
        type: "water",
        date: old.date,
        status: "已飲用",
        time: "",
        note: "",
        volume: 200,
      },
    ],
  };
  expect(parseBackup(JSON.stringify(v3))).toEqual(v3);
});

it("uncertain sleep score remains a separate pending candidate rather than entering the trusted duration", () => {
  const r = extractCandidates({
    ...raw,
    sleepblock: "睡眠分數 71",
    confidences: { ...raw.confidences, sleepblock: 42 },
  });
  const sleeps = r.candidates.filter((c) => c.type === "sleep");
  expect(sleeps).toHaveLength(2);
  expect(sleeps[0].score).toBeNull();
  expect(sleeps[0].recommended).toBe(true);
  expect(sleeps[1].score).toBe(71);
  expect(sleeps[1].recommended).toBe(false);
});

it("medium/low OCR confidence never produces trusted candidates, even when dates and labels match", () => {
  const result = extractCandidates({...raw,confidences:{...raw.confidences,sleep:79,steps:60,sunlight:40}});
  expect(result.candidates.every(c=>!c.recommended)).toBe(true);
  expect(extractCandidates({...raw,confidences:{...raw.confidences,date:69}}).candidates.every(c=>!c.recommended)).toBe(true);
});
