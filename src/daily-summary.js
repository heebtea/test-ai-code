import { sum } from "./data.js";
import { sleepDay } from "./sleep-detail.js";

const number = (value) => value.toLocaleString("zh-TW");

export function sleepSummary(data, date, records) {
  if (!records.length) return ["尚無資料"];
  const { value, unknown } = sum(records, "minutes");
  const duration = value === null
    ? "睡眠時長未知"
    : `${Math.floor(value / 60)} 小時 ${value % 60} 分鐘（${number(value)} 分鐘）`;
  const lines = [duration];
  if (value !== null && unknown) lines.push(`另 ${unknown} 筆時長未知`);
  const { score } = sleepDay(data, date);
  if (score !== null) lines.push(`睡眠分數 ${score} 分`);
  return lines;
}

export function drinkSummary(records, type) {
  if (!records.length) return ["尚無資料"];
  const done = records.filter((record) => record.status === "已飲用");
  const partial = records.filter((record) => record.status === "部分");
  const open = records.filter((record) => record.status === "飲用中");
  const waiting = records.length - done.length - partial.length - open.length;
  const { value, unknown } = sum(done, "volume");
  const lines = [];
  if (done.length && type === "coffee") {
    const cups = `已完飲 ${done.length} 杯`;
    lines.push(!unknown && value > 0 ? `${cups}，共 ${number(value)} mL` : cups);
    if (value === 0) lines.push("已知容量 0 mL（已確認為零）");
    if (unknown) {
      if (value > 0) lines.push(`已知容量 ${number(value)} mL`);
      lines.push(`${value !== null ? "另 " : ""}${unknown} 杯容量未知`);
    }
  } else if (done.length) {
    if (value !== null) lines.push(`${number(value)} mL 已飲用${value === 0 ? "（已確認為零）" : ""}`);
    if (unknown) lines.push(`${unknown} 筆已飲用，攝取量未知`);
  }
  if (partial.length) {
    const consumed = sum(partial, "volume");
    lines.push(consumed.value === null
      ? "部分攝取，實際攝取量未知"
      : `${number(consumed.value)} mL 部分攝取${consumed.value === 0 ? "（已確認為零）" : ""}`);
    if (consumed.value !== null && consumed.unknown) lines.push(`另 ${consumed.unknown} 筆部分攝取量未知`);
  }
  if (open.length) {
    const capacity = type === "water" && open.length === 1 ? open[0].capacity : null;
    lines.push(capacity == null ? `${open.length} 筆飲用中` : `${number(capacity)} mL 飲用中`);
    lines.push("實際攝取量待確認");
  }
  if (waiting) lines.push(`${waiting} 筆待確認飲用狀態`);
  return lines;
}

export function hydrationSummary(intake) {
  if (!intake.count) return ["尚無資料"];
  const lines = [];
  if (intake.value !== null) {
    lines.push(`${number(intake.value)} mL 已飲用${intake.value === 0 ? "（已確認為零）" : ""}`);
  }
  if (intake.unknown) lines.push(`${intake.unknown} 筆攝取量未知`);
  if (intake.pending) lines.push(`${intake.pending} 筆待確認攝取`);
  if (intake.partial) lines.push(`含 ${intake.partial} 筆部分攝取紀錄`);
  return lines;
}
