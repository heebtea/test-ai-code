import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_TYPES, makeDaySnapshot, makeChatText } from "../src/ai-share.js";

const sample = {
  version: 6,
  records: [
    { id: "s1", date: "2026-10-29", type: "sleep", status: "已完成", minutes: 346 },
    { id: "m1", date: "2026-10-29", type: "meal", status: "吃完", name: "排骨飯", amount: 110 },
    { id: "j1", date: "2026-10-29", type: "journal", status: "已記錄", mood: "私密內容" },
    { id: "s2", date: "2026-10-28", type: "sleep", status: "已完成", minutes: 355 },
  ],
};

describe("AI snapshot privacy boundary", () => {
  it("shares only selected date, excluding private journal and events by default", () => {
    const snap = makeDaySnapshot(sample, "2026-10-29");
    expect(snap.version).toBe(6);
    expect(snap.records.map((r) => r.id)).toEqual(["s1", "m1"]);
    expect(DEFAULT_SHARE_TYPES).not.toContain("journal");
    expect(DEFAULT_SHARE_TYPES).not.toContain("event");
  });
  it("shares journal only with explicit selection and never mutates source", () => {
    const snap = makeDaySnapshot(sample, "2026-10-29", ["journal"]);
    expect(snap.records).toHaveLength(1);
    snap.records[0].mood = "changed";
    expect(sample.records[2].mood).toBe("私密內容");
  });
  it("produces copyable message, with non-sync disclaimer", () => {
    const message = makeChatText(makeDaySnapshot(sample, "2026-10-29", ["sleep"]), "2026-10-29");
    expect(message).toContain("不是即時同步");
    expect(message).toContain('"minutes": 346');
    expect(message).not.toContain("私密內容");
  });
  it("rejects invalid data or unknown sharing categories", () => {
    expect(() => makeDaySnapshot(null, "2026-10-29")).toThrow();
    expect(() => makeDaySnapshot(sample, "2026-10-29", ["unknown"])).toThrow();
  });
});
