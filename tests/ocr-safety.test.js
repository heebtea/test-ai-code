import { it, expect } from "vitest";
import { empty, upsert } from "../src/data.js";
import { planCandidates } from "../src/ocr-records.js";
it("same-day repeated candidates cannot double-count and no-op merge is skipped", () => {
  const values = {
    type: "sleep",
    date: "2026-01-02",
    status: "已完成",
    time: "",
    note: "",
    minutes: "380",
    score: "",
  };
  const result = planCandidates(empty(), [
    { id: "a", values, action: "skip" },
    { id: "b", values, action: "skip" },
  ]);
  expect(result.added).toBe(1);
  expect(result.skipped).toBe(1);
  expect(result.data.records).toHaveLength(1);
  const again = planCandidates(result.data, [
    { id: "c", values, action: "merge", target: "a" },
  ]);
  expect(again.merged).toBe(0);
  expect(again.skipped).toBe(1);
});
it("record identity collision never replaces an existing entry", () => {
  const existing = {
    id: "a",
    type: "water",
    date: "2026-01-01",
    status: "已飲用",
    time: "",
    note: "",
    volume: 300,
  };
  const data = upsert(empty(), existing);
  expect(() =>
    planCandidates(data, [
      {
        id: "a",
        action: "add",
        values: {
          type: "water",
          date: "2026-01-02",
          status: "已飲用",
          time: "",
          note: "",
          volume: "900",
        },
      },
    ]),
  ).toThrow(/ID/);
  expect(data.records[0]).toEqual(existing);
});
