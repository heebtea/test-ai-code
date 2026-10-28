import { it, expect } from "vitest";
import { baseTemplate } from "../src/templates.js";
import { planJournalLayout, renderJournalTemplate, wrapJournalText } from "../src/journal-layout.js";

function fakeCanvas() {
  const drawn = [];
  const ctx = {
    font: "24px sans-serif",
    fillStyle: "",
    measureText(value) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 24);
      return { width: Array.from(String(value)).reduce((s, ch) =>
        s + (/[A-Za-z0-9]/.test(ch) ? size * 0.52 : size), 0) };
    },
    fillRect(...a) { drawn.push(["rect", ...a]); },
    fillText(...a) { drawn.push(["text", ...a]); },
  };
  return { canvas: { width: 0, height: 0, getContext: () => ctx }, ctx, drawn };
}
const long = "今日使用結構化 JSON 整理資料，已確認的付款、實際飲用和完食紀錄分開，不用再靠 OCR 亂猜；";
const sections = [
  { title: "每日主題", value: long.repeat(2) },
  { title: "睡眠", value: "355 分鐘" },
  { title: "活動", value: "10,571 步" },
  { title: "日照", value: "97 分鐘" },
  { title: "餐點", value: "豬排滑蛋飯（吃完）、肉桂捲（吃完）、麥香魚中薯（吃完）、綜合青菜（吃完）、茶葉蛋（吃完）" },
  { title: "咖啡已飲用", value: "480 mL" },
  { title: "其他飲品已飲用", value: "1,400 mL" },
  { title: "今日已飲用總量", value: "1,880 mL" },
  { title: "已付款花費", value: "275 NT$" },
  { title: "今日亮點", value: long.repeat(2) },
  { title: "身體狀況", value: long },
  { title: "心情", value: "心情爽！麥香魚與快樂水都有吃喝完，今日總算取得具體成果。" },
  { title: "待辦事項", value: "21:37 收衣；明日嶺東 08:20 前報到，請事先確認公車與校區。" },
];
const times = [
  "08:08", "09:20", "11:02", "12:00", "12:20", "14:37", "14:54",
  "15:00", "17:58", "18:18", "18:35", "19:33", "19:34", "19:47",
  "20:16", "20:30", "21:00", "21:37", "22:10",
];
const events = times.map((time, i) => ({
  time,
  label: i % 2 === 0 ? "開始飲用" : "餐點紀錄",
  record: { name: i % 2 ? "綜合青菜與茶葉蛋" : "無糖黃金蕎麥茶" },
}));

it("wraps Chinese and long unbroken text, preserving the characters", () => {
  const { ctx } = fakeCanvas();
  const text = "臺灣今天喝了700mL無糖黃金蕎麥茶和12345678901234567890可樂";
  const lines = wrapJournalText(ctx, text, 130);
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.join("")).toBe(text);
  expect(lines.every((line) => ctx.measureText(line).width <= 130)).toBe(true);
});
it("uses tall measured cards and draws far more than 3 events within the PNG", () => {
  const { canvas, drawn } = fakeCanvas();
  const template = baseTemplate();
  const plan = renderJournalTemplate(canvas, sections, events, "2026-10-28", template);
  expect(canvas.width).toBe(1080);
  expect(canvas.height).toBe(1920);
  expect(plan.height).toBeLessThanOrEqual(1523);
  expect(plan.rows.some((row) => row.cards.some((card) => card.item.key === "timeline" && card.content.rows.length > 2))).toBe(true);
  expect(plan.shown).toBeGreaterThan(3);
  expect(drawn.some((cmd) => cmd[0] === "text" && cmd[1].includes("今日使用結構化"))).toBe(true);
  expect(drawn.some((cmd) => cmd[0] === "text" && cmd[1].includes("綜合青菜"))).toBe(true);
  expect(drawn.filter((cmd) => cmd[0] === "text" && cmd[1] === "19:47").length).toBe(1);
  // All content background rectangles stay above the reserved page footer.
  expect(drawn.filter((cmd) => cmd[0] === "rect" && cmd[2] >= 292)
    .every((cmd) => cmd[2] + cmd[4] <= 1815)).toBe(true);
  expect(drawn.some((cmd) => cmd[0] === "text" && cmd[1] === "每日主題：")).toBe(false);
});
it("preserves custom template mapping and leaves the underlying data unchanged", () => {
  const { ctx } = fakeCanvas();
  const oneCol = { ...baseTemplate(), columns: 1, mapping: [...baseTemplate().mapping].reverse() };
  const source = JSON.stringify({ sections, events, oneCol });
  const plan = planJournalLayout(ctx, sections, events, oneCol);
  expect(plan.rows.every((row) => row.cards.length === 1)).toBe(true);
  expect(plan.rows[0].cards[0].item.key).toBe("todo");
  expect(JSON.stringify({ sections, events, oneCol })).toBe(source);
  expect(plan.height).toBeLessThanOrEqual(1523);
});
it("does not draw past the page when many very long notes are present", () => {
  const { canvas, drawn } = fakeCanvas();
  const huge = sections.map((v) => ({ ...v, value: String(v.value).repeat(6) }));
  const manyEvents = Array.from({ length: 180 }, (_, i) => ({
    time: String(Math.floor(i / 60)).padStart(2, "0") + ":" + String(i % 60).padStart(2, "0"),
    label: "事件完成",
    record: { name: "大量時間軸測試紀錄" },
  }));
  const plan = renderJournalTemplate(canvas, huge, manyEvents, "2026-10-28", baseTemplate());
  expect(plan.height).toBeLessThanOrEqual(1523);
  expect(plan.clipped).toBeGreaterThan(0);
  expect(drawn.some((c) => c[0] === "text" && String(c[1]).includes("原始紀錄"))).toBe(true);
});
