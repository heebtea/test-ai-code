import { it, expect } from "vitest";
import { extractCandidates } from "../src/ocr.js";
it("conflicting dates detected in independent passes or header never qualify for automatic selection", () => {
  const raw = {
    date: "2026.01.02",
    date2: "2026.01.02",
    sleep: "7小時15分",
    sleepblock: "睡眠",
    steps: "6,543",
    sunlight: "18分鐘",
    whole: "2026.01.03 睡眠 步數6,543 日照18分鐘",
    confidences: { date: 90, date2: 90, sleep: 90, steps: 90, sunlight: 90 },
  };
  expect(extractCandidates(raw).dateConflict).toBe(true);
  expect(extractCandidates(raw).candidates.every((c) => !c.recommended)).toBe(
    true,
  );
  const r = extractCandidates({
    ...raw,
    whole: "睡眠 步數6,543 日照18分鐘",
    date2: "2026.01.03",
  });
  expect(r.dateConflict).toBe(true);
  expect(r.candidates.every((c) => !c.recommended)).toBe(true);
});
