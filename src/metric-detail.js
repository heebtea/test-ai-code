import { rows, transactions, shiftDate, sum } from "./data.js";

export const metricTypes = ["coffee", "water", "beverage", "activity", "sunlight", "spending"];
const names = {
  coffee: "咖啡", water: "飲水", beverage: "飲品",
  activity: "活動", sunlight: "日照", spending: "花費",
};
const unit = (type) => type === "spending" ? "NT$" : type === "activity" ? "步" : type === "sunlight" ? "分鐘" : "mL";

function isKnown(value) { return typeof value === "number" && Number.isFinite(value); }
function round(value) { return Math.round(value * 100) / 100; }
function sumValues(values) {
  const known = values.filter(isKnown);
  return known.length ? round(known.reduce((a, b) => a + b, 0)) : null;
}
function addMonths(date, n) {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}
export function metricRange(anchor, period) {
  if (period === "day") return { start: anchor, end: anchor };
  if (period === "week") {
    const day = new Date(anchor + "T12:00:00Z").getUTCDay();
    const start = shiftDate(anchor, -(day === 0 ? 6 : day - 1));
    return { start, end: shiftDate(start, 6) };
  }
  if (period === "month") {
    const start = anchor.slice(0, 7) + "-01";
    return { start, end: shiftDate(addMonths(start, 1), -1) };
  }
  throw Error("不支援的統計期間");
}
export function metricDay(data, date, type) {
  if (!metricTypes.includes(type)) throw Error("不支援的統計類別");
  const items = type === "spending" ? transactions(data, date) : rows(data, date, type);
  const accepted = type === "sunlight" || type === "spending"
    ? items
    : items.filter((r) => r.status === (type === "activity" ? "已完成" : "已飲用"));
  const pending = items.length - accepted.length;
  const field = type === "activity" ? "steps" : type === "sunlight" ? "minutes" : type === "spending" ? "amount" : "volume";
  const stats = sum(accepted, field);
  let value = stats.value, unknown = stats.unknown;
  const extra = {};
  if (type === "activity") {
    extra.minutes = sum(accepted, "minutes");
  }
  if (type === "spending") {
    const kinds = ["purchase", "refund", "reimbursement"];
    for (const kind of kinds) {
      extra[kind] = sum(items.filter((r) => (r.transactionKind || "purchase") === kind), "amount");
    }
    const hasAmount = items.some((r) => isKnown(r.amount));
    value = hasAmount ? round((extra.purchase.value || 0) - (extra.refund.value || 0) - (extra.reimbursement.value || 0)) : null;
    unknown = items.filter((r) => !isKnown(r.amount)).length;
  }
  return { date, type, items, count: items.length, confirmed: accepted.length, pending, unknown, value, extra };
}
export function metricPeriod(data, anchor, period, type) {
  const { start, end } = metricRange(anchor, period);
  const days = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    days.push(metricDay(data, date, type));
  }
  const totals = {
    start, end, period, type, days,
    observedDays: days.filter((d) => d.count > 0).length,
    count: days.reduce((a, d) => a + d.count, 0),
    confirmed: days.reduce((a, d) => a + d.confirmed, 0),
    pending: days.reduce((a, d) => a + d.pending, 0),
    unknown: days.reduce((a, d) => a + d.unknown, 0),
    value: sumValues(days.map((d) => d.value)),
    entries: days.flatMap((d) => d.items.map((record) => ({ date: d.date, record }))),
  };
  if (type === "activity") {
    totals.minutes = { value: sumValues(days.map((d) => d.extra.minutes.value)), unknown: days.reduce((a, d) => a + d.extra.minutes.unknown, 0) };
  }
  if (type === "spending") {
    for (const kind of ["purchase", "refund", "reimbursement"]) {
      totals[kind] = { value: sumValues(days.map((d) => d.extra[kind].value)), unknown: days.reduce((a, d) => a + d.extra[kind].unknown, 0) };
    }
  }
  return totals;
}
function el(tag, className = "", content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = content;
  return node;
}
function money(n) { return isKnown(n) ? "NT$" + n.toLocaleString("zh-TW") : "金額未知"; }
function fmt(value, type) {
  return isKnown(value) ? (type === "spending" ? money(value) : value.toLocaleString("zh-TW") + " " + unit(type)) : "尚無已確認數值";
}
function recordLabel(record, type) {
  if (type === "spending") {
    const kind = { purchase: "購買", refund: "退費", reimbursement: "回補" }[record.transactionKind || "purchase"];
    return [kind, ({ meal: "餐點", coffee: "咖啡", beverage: "飲品", spending: "花費" })[record.type], record.name, money(record.amount), record.status].filter(Boolean).join(" · ");
  }
  const field = type === "activity" ? "steps" : type === "sunlight" ? "minutes" : "volume";
  return [record.time || record.startTime, record.name, record.status, isKnown(record[field]) ? fmt(record[field], type) : "數量未確認", record.note].filter(Boolean).join(" · ");
}
function row(parent, label, value) {
  const line = el("div", "metric-detail-row");
  line.append(el("span", "", label), el("strong", "", value));
  parent.append(line);
}
export function openMetricDetail(dialog, data, anchorDate, metricType) {
  if (!metricTypes.includes(metricType)) throw Error("不支援的統計類別");
  let active = "day", anchor = anchorDate;
  function paint() {
    dialog.replaceChildren();
    const top = el("div", "metric-detail-header");
    top.append(el("h2", "", names[metricType] + "統計"));
    const close = el("button", "metric-detail-close", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "關閉統計詳情");
    close.onclick = () => dialog.close();
    top.append(close);
    dialog.append(top);
    const tabs = el("div", "metric-period-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "統計期間");
    for (const [key, title] of [["day", "日"], ["week", "週"], ["month", "月"]]) {
      const btn = el("button", active === key ? "is-active" : "", title);
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(active === key));
      btn.onclick = () => { active = key; paint(); };
      tabs.append(btn);
    }
    dialog.append(tabs);
    const dateRow = el("div", "metric-date-row");
    const label = el("label", "", "參考日期");
    const input = el("input");
    input.type = "date";
    input.min = "1900-01-01";
    input.max = "2199-12-31";
    input.value = anchor;
    input.setAttribute("aria-label", "統計參考日期");
    input.onchange = () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.value) && !Number.isNaN(Date.parse(input.value + "T12:00:00Z"))) {
        anchor = input.value; paint();
      }
    };
    dateRow.append(label, input);
    dialog.append(dateRow);
    const stats = metricPeriod(data, anchor, active, metricType);
    const overview = el("section", "metric-detail-overview");
    overview.append(el("small", "", stats.start === stats.end ? stats.start : stats.start + " ～ " + stats.end));
    overview.append(el("strong", "", fmt(stats.value, metricType)));
    overview.append(el("p", "", "有紀錄 " + stats.observedDays + "／" + stats.days.length + " 天 · 共 " + stats.count + " 筆；沒有紀錄的日子不當成 0。"));
    if (metricType === "activity") row(overview, "已完成活動時間", fmt(stats.minutes.value, "sunlight") + (stats.minutes.unknown ? "（" + stats.minutes.unknown + " 筆未知）" : ""));
    if (metricType === "spending") {
      row(overview, "已確認購買", fmt(stats.purchase.value, "spending"));
      row(overview, "退費", fmt(stats.refund.value, "spending"));
      row(overview, "回補", fmt(stats.reimbursement.value, "spending"));
      overview.append(el("p", "", "上方主數值為已確認淨支出＝購買－退費－回補。咖啡券兌換不重複計費。"));
    } else {
      overview.append(el("p", "", metricType === "activity" ? "僅已完成的活動計入；活動區段請避免重疊。" : "僅確定完成的攝取計入；日照依已記錄分鐘彙總。"));
    }
    if (stats.pending) overview.append(el("p", "metric-detail-warning", stats.pending + " 筆飲用中／未完成／未確認，不計入統計。"));
    if (stats.unknown) overview.append(el("p", "metric-detail-warning", stats.unknown + " 筆數值未知；目前顯示已確認合計，不代表全部數量。"));
    dialog.append(overview);
    if (active !== "day") {
      const chart = el("section", "metric-chart");
      chart.append(el("h3", "", "每日趨勢"));
      const scroller = el("div", "metric-chart-scroll");
      const columns = el("div", "metric-chart-columns");
      if (active === "month") columns.classList.add("is-month");
      const valueForBar = (d) => metricType === "spending" ? d.extra.purchase.value : d.value;
      const validValues = stats.days.map(valueForBar).filter(isKnown);
      const max = Math.max(1, ...validValues.map(Math.abs));
      for (const d of stats.days) {
        const val = valueForBar(d);
        const column = el("div", "metric-chart-column");
        const rail = el("div", "metric-chart-rail");
        const bar = el("div", "metric-chart-bar" + (val === null ? " is-missing" : ""));
        if (isKnown(val)) bar.style.height = Math.max(val === 0 ? 2 : 4, Math.min(100, Math.abs(val) / max * 100)) + "%";
        const description = d.date + "：" + (metricType === "spending" ? "已確認購買 " : "") + fmt(val, metricType);
        bar.title = description;
        bar.setAttribute("aria-label", description);
        rail.append(bar);
        column.append(rail, el("small", "", d.date.slice(5).replace("-", "/")));
        columns.append(column);
      }
      scroller.append(columns);
      chart.append(scroller, el("p", "", "空白代表未提供可確認數值；花費圖僅顯示購買金額，退費及回補另列。"));
      dialog.append(chart);
    }
    const list = el("section", "metric-record-list");
    list.append(el("h3", "", "逐筆明細（" + stats.entries.length + "）"));
    if (!stats.entries.length) list.append(el("p", "", "目前可見資料沒有這段期間的紀錄。"));
    else {
      const ul = el("ul");
      for (const item of stats.entries) {
        ul.append(el("li", "", item.date + " · " + recordLabel(item.record, metricType)));
      }
      list.append(ul);
    }
    dialog.append(list);
  }
  paint();
  dialog.showModal();
}
