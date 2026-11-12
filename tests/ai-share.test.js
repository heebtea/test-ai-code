import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_TYPES, makeDaySnapshot, makeChatText, makeSnapshot } from "../src/ai-share.js";

import { validate } from "../src/data.js";
import { data, from, to, correctedAt } from "./fixtures/ai-bridge.js";

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
    expect(snap.records[0]).not.toHaveProperty("mood");
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

describe("v8 bridge snapshot", () => {
  it("retains safe metadata, partial consumption and v8 fields without leaking free text", () => {
    validate(data);
    const snapshot = makeSnapshot(data, { from, to });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('PRIVATE_TEST_');
    expect(snapshot.latestRecordUpdatedAt).toBe(correctedAt);
    expect(snapshot.records.find(r => r.id === 'test-meal')).toMatchObject({
      sourceKind: 'ocr', updatedAt: correctedAt, correctedAt, status: '部分',
      mealType: 'lunch', orderStatus: 'ordered', consumedQuantity: 0.5,
      familyQuantity: 1, remainingQuantity: 1.5, paid: true, unit: '份',
    });
    expect(snapshot.records.find(r => r.id === 'test-coffee')).toMatchObject({
      status: '飲用中', sourceKind: 'manual',
    });
    expect(snapshot.records.find(r => r.id === 'test-activity')).toMatchObject({
      startTime: '10:00', endTime: '10:10', updatedAt: null, correctedAt: null,
    });
    const nameOptIn = makeSnapshot(data, { from, to, selected: ['event'], includeSensitive: true });
    expect(nameOptIn.records[0].name).toBe('PRIVATE_TEST_EVENT');
    const nested = structuredClone(data);
    nested.records.find(r => r.id === 'test-sleep').segments[0].photo = 'PRIVATE_TEST_PHOTO';
    nested.records.push({
      id: 'test-sunlight', type: 'sunlight', date: from, time: '12:30', status: '已記錄',
      minutes: 25, note: '', source: 'Apple Watch', provenance: '手動輸入',
    });
    expect(makeSnapshot(nested, { from, to }).records.at(-1)).toMatchObject({
      sourceKind: 'manual', measurementSourceKind: 'apple-watch',
    });
    expect(JSON.stringify(makeSnapshot(nested, { from, to, includeSensitive: true }))).not.toContain('PRIVATE_TEST_PHOTO');
  });

  it("accounts by payment date once and preserves unknown, unpaid, refund and reimbursement", () => {
    const full = makeSnapshot(data, { from, to });
    expect(full.records.every(r => !Object.hasOwn(r, 'amount'))).toBe(true);
    const snapshot = makeSnapshot(data, { from: to, selected: ['spending'] });
    expect(snapshot.transactions.map(r => [r.id, r.transactionKind, r.amount, r.transactionDate])).toEqual([
      ['test-meal', 'purchase', 125, to],
      ['test-unknown-amount', 'purchase', null, to],
      ['test-refund', 'refund', 20, to],
      ['test-reimbursement', 'reimbursement', 10, to],
    ]);
    expect(snapshot.transactions[0]).toMatchObject({ correctedAt, recordDate: from });
    expect(makeSnapshot(data, { from, selected: ['spending'] }).transactions).toEqual([]);
    expect(full.pendingTransactions.map(r => [r.id, r.paymentState, r.recordedAmount])).toEqual([
      ['test-unpaid', 'unpaid', 40], ['test-unknown-date', 'date-unknown', 50],
    ]);
    const noMoney = makeSnapshot(data, { from, selected: ['meal', 'coffee'] });
    expect(noMoney.transactions).toEqual([]);
    expect(noMoney.pendingTransactions).toEqual([]);
    expect(noMoney.records.every(r => !('paid' in r) && !('payment' in r))).toBe(true);
    expect(() => makeSnapshot({ ...data, records: [data.records[0], data.records[0]] }, { from })).toThrow('重複 ID');
  });
});
