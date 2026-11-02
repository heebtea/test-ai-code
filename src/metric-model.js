import {
  shiftDate,
  validDate,
  sum,
  transactions,
  transactionDate,
  isPaid,
} from "./data.js";
export const metricTypes = [
  "coffee",
  "water",
  "beverage",
  "activity",
  "sunlight",
  "spending",
  "meal",
];
const known = (v) => typeof v === "number" && Number.isFinite(v);
const total = (values) => {
  const ns = values.filter(known);
  return ns.length
    ? Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100
    : null;
};
const round = (n) => Math.round(n * 100) / 100;
function check(data) {
  if (!data || !Array.isArray(data.records))
    throw Error("資料載入或解析失敗，不能顯示統計");
  const ids = new Set();
  for (const r of data.records) {
    if (!r || typeof r.id !== "string" || ids.has(r.id))
      throw Error("資料含無效或重複 ID，請先檢查原始資料");
    ids.add(r.id);
  }
}
function month(date, n) {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}
export function metricRange(anchor, period) {
  if (!validDate(anchor)) throw Error("統計日期無效");
  if (period === "day") return { start: anchor, end: anchor };
  if (period === "week") {
    const d = new Date(anchor + "T12:00:00Z").getUTCDay(),
      start = shiftDate(anchor, -(d === 0 ? 6 : d - 1));
    return { start, end: shiftDate(start, 6) };
  }
  if (period === "month")
    return {
      start: anchor.slice(0, 7) + "-01",
      end: shiftDate(month(anchor, 1), -1),
    };
  throw Error("不支援的統計期間");
}
export function moveMetricDate(anchor, period, n) {
  return period === "month"
    ? month(anchor, n)
    : shiftDate(anchor, n * (period === "week" ? 7 : 1));
}
function activitySelection(items, warnings) {
  const done = items.filter((r) => r.status === "已完成");
  const intervals = new Map(),
    bad = new Set();
  const minute = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (const r of done) {
    if (r.startTime && r.endTime) {
      const a = minute(r.startTime),
        b = minute(r.endTime);
      if (b <= a || (known(r.minutes) && r.minutes > b - a)) {
        bad.add(r.id);
        warnings.push("活動 " + r.id + " 的時間區間與分鐘數矛盾，暫不計入");
      } else intervals.set(r.id, { a, b });
    }
  }
  if (
    done.length > 1 &&
    done.some((r) => !intervals.has(r.id) && !bad.has(r.id))
  ) {
    done.forEach((r) => bad.add(r.id));
    warnings.push(
      "多筆活動缺少完整區間，無法排除重疊，暫不合計；請補正開始／結束時間",
    );
  }
  for (let i = 0; i < done.length; i++)
    for (let j = i + 1; j < done.length; j++) {
      const a = intervals.get(done[i].id),
        b = intervals.get(done[j].id);
      if (a && b && a.a < b.b && b.a < a.b) {
        bad.add(done[i].id);
        bad.add(done[j].id);
      }
    }
  if (bad.size)
    warnings.push(
      bad.size + " 筆活動重疊或區間不明，排除步數及分鐘，保留原始明細供核對",
    );
  else if (done.length === 1 && !intervals.size)
    warnings.push("活動未標區間；單筆照實列示，新增第二筆前請補區間以檢查重疊");
  return { accepted: done.filter((r) => !bad.has(r.id)), excluded: bad.size };
}
export function dayState(day) {
  if (!day.count) return "本機沒有紀錄";
  if (day.value === null) {
    if (day.excluded) return "有紀錄但區間待核對";
    if (day.unknown) return "有紀錄但數值／本人份量未知";
    return "有紀錄但尚未完成";
  }
  return day.value === 0
    ? "已確認為零"
    : day.unknown || day.pending || day.excluded
      ? "已確認部分合計"
      : "已確認合計";
}
export function metricDay(data, date, type) {
  check(data);
  if (!validDate(date) || !metricTypes.includes(type))
    throw Error("統計日期或類別無效");
  const warnings = [],
    extra = {};
  let items = data.records.filter((r) => r.date === date && r.type === type),
    accepted,
    pending,
    excluded = 0;
  if (type === "spending") {
    const settled = transactions(data, date);
    const unassigned = data.records.filter(
      (r) =>
        ["spending", "meal", "beverage", "coffee"].includes(r.type) &&
        !(r.type === "coffee" && r.payment === "voucher") &&
        r.date === date &&
        (!isPaid(r) || !transactionDate(r)),
    );
    items = [...settled, ...unassigned];
    accepted = settled;
    pending = unassigned.length;
    if (unassigned.length)
      warnings.push(
        unassigned.length +
          " 筆未付款／付款未確認／付款日期未知，不推定為本日支出",
      );
  } else if (type === "activity") {
    const a = activitySelection(items, warnings);
    accepted = a.accepted;
    excluded = a.excluded;
    pending = items.filter((r) => r.status !== "已完成").length;
  } else {
    accepted = items.filter((r) =>
      type === "sunlight"
        ? r.status === "已記錄"
        : type === "meal"
          ? ["部分", "吃完"].includes(r.status)
          : r.status === "已飲用",
    );
    pending = items.length - accepted.length;
  }
  const field =
    type === "activity"
      ? "steps"
      : type === "sunlight"
        ? "minutes"
        : type === "spending"
          ? "amount"
          : "volume";
  let { value, unknown } = sum(accepted, field);
  if (type === "activity") extra.minutes = sum(accepted, "minutes");
  if (type === "meal") {
    const personal = accepted.filter((r) => known(r.consumedQuantity));
    unknown = accepted.length - personal.length;
    value = personal.length
      ? personal.filter((r) => r.consumedQuantity > 0).length
      : null;
    extra.personal = sum(personal, "consumedQuantity");
    extra.family = sum(items, "familyQuantity");
    extra.remaining = sum(items, "remainingQuantity");
    extra.completed = personal.filter(
      (r) => r.consumedQuantity > 0 && r.status === "吃完",
    ).length;
    if (unknown)
      warnings.push(
        unknown + " 筆食用者／本人份量未知，不以購買份數推定本人餐數",
      );
    for (const r of items)
      if (r.consumedQuantity > 0 && !["部分", "吃完"].includes(r.status))
        warnings.push(r.id + " 本人份量與未確認狀態矛盾，請補正");
  }
  if (type === "spending") {
    for (const kind of ["purchase", "refund", "reimbursement"])
      extra[kind] = sum(
        accepted.filter((r) => (r.transactionKind || "purchase") === kind),
        "amount",
      );
    value = accepted.some((r) => known(r.amount))
      ? round(
          (extra.purchase.value ?? 0) -
            (extra.refund.value ?? 0) -
            (extra.reimbursement.value ?? 0),
        )
      : null;
  }
  const result = {
    date,
    type,
    items: [...items].sort(
      (a, b) =>
        (a.startTime || a.time || "99:99").localeCompare(
          b.startTime || b.time || "99:99",
        ) || a.id.localeCompare(b.id),
    ),
    count: items.length,
    confirmed: accepted.length,
    pending,
    unknown,
    value,
    extra,
    excluded,
    warnings,
  };
  result.state = dayState(result);
  return result;
}
function aggregate(days) {
  const value = total(days.map((d) => d.value)),
    validDays = days.filter((d) => known(d.value)).length;
  return {
    value,
    validDays,
    average: validDays ? round(value / validDays) : null,
    observedDays: days.filter((d) => d.count > 0).length,
  };
}
export function metricPeriod(data, anchor, period, type) {
  check(data);
  const { start, end } = metricRange(anchor, period),
    days = [];
  for (let date = start; date <= end; date = shiftDate(date, 1))
    days.push(metricDay(data, date, type));
  const result = {
    start,
    end,
    period,
    type,
    days,
    ...aggregate(days),
    count: days.reduce((n, d) => n + d.count, 0),
    confirmed: days.reduce((n, d) => n + d.confirmed, 0),
    pending: days.reduce((n, d) => n + d.pending, 0),
    unknown: days.reduce((n, d) => n + d.unknown, 0),
    excluded: days.reduce((n, d) => n + d.excluded, 0),
    entries: days.flatMap((d) =>
      d.items.map((record) => ({ date: d.date, record })),
    ),
    warnings: days.flatMap((d) => d.warnings.map((w) => d.date + "：" + w)),
  };
  if (type === "activity")
    result.minutes = {
      value: total(days.map((d) => d.extra.minutes.value)),
      unknown: days.reduce((n, d) => n + d.extra.minutes.unknown, 0),
    };
  if (type === "meal") {
    result.personal = {
      value: total(days.map((d) => d.extra.personal.value)),
      unknown: result.unknown,
    };
    result.completed = days.reduce((n, d) => n + d.extra.completed, 0);
  }
  if (type === "spending")
    for (const kind of ["purchase", "refund", "reimbursement"])
      result[kind] = {
        value: total(days.map((d) => d.extra[kind].value)),
        unknown: days.reduce((n, d) => n + d.extra[kind].unknown, 0),
      };
  const groups = new Map();
  for (const day of days) {
    const week = metricRange(day.date, "week").start;
    if (!groups.has(week)) groups.set(week, []);
    groups.get(week).push(day);
  }
  result.weeks = [...groups.values()].map((ds) => ({
    start: ds[0].date,
    end: ds.at(-1).date,
    ...aggregate(ds),
  }));
  return result;
}
