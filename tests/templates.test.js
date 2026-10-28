// @vitest-environment jsdom
import { it, expect } from "vitest";
import { empty, upsert, parseBackup, merge } from "../src/data.js";
import { journalSections } from "../src/journal.js";
import { baseTemplate, validateTemplate } from "../src/templates.js";
it("journal text remains user-provided and roundtrips as v5 while v3 data remains intact", () => {
  const record = {
    id: "note",
    date: "2026-10-27",
    type: "journal",
    status: "已記錄",
    note: "",
    time: "",
    theme: "合成主題",
    highlight: "",
    wellbeing: "",
    mood: "",
    todo: "帶傘",
  };
  const d = upsert(empty(), record);
  expect(journalSections(d, record.date).map((x) => x.value)).toEqual([
    "合成主題",
    "帶傘",
  ]);
  expect(parseBackup(JSON.stringify(d))).toEqual(d);
  const old = {
    version: 3,
    records: [
      {
        id: "water",
        date: record.date,
        type: "water",
        status: "已飲用",
        note: "",
        time: "",
        volume: 100,
      },
    ],
  };
  const combined = merge(d, old).data;
  expect(combined.records).toHaveLength(2);
  expect(merge(combined, old).added).toBe(0);
  expect(() => upsert(d, { ...record, theme: undefined })).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...d, version: 3 }))).toThrow();
});
it("template mappings are explicit and reject duplicates or unsafe styles", () => {
  const t = baseTemplate();
  expect(validateTemplate(t)).toEqual(t);
  expect(() =>
    validateTemplate({ ...t, mapping: t.mapping.map(() => t.mapping[0]) }),
  ).toThrow();
  expect(() =>
    validateTemplate({ ...t, background: "red; color: black" }),
  ).toThrow();
});
