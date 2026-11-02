import {
  metricTypes,
  metricDay,
  metricPeriod,
  moveMetricDate,
  dayState,
} from "./metric-model.js";
import { validDate, transactionDate, isPaid } from "./data.js";
import { mealTypes, orderStates } from "./stat-fields.js";
export {
  metricTypes,
  metricDay,
  metricPeriod,
  metricRange,
} from "./metric-model.js";
const names = {
  coffee: "咖啡",
  water: "飲水",
  beverage: "其他飲品",
  activity: "活動",
  sunlight: "日照",
  spending: "花費",
  meal: "餐點",
};
const unit = (t) =>
  ({ activity: "步", sunlight: "分鐘", spending: "NT$", meal: "餐" })[t] ||
  "mL";
const known = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = (v, t) =>
  known(v) ? v.toLocaleString("zh-TW") + " " + unit(t) : "數值未知";
const val = (v, u) => (known(v) ? v.toLocaleString("zh-TW") + " " + u : "未知");
function el(tag, cls = "", text = "") {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
}
function row(parent, label, text) {
  const r = el("div", "metric-detail-row");
  r.append(el("span", "", label), el("strong", "", text));
  parent.append(r);
}
function button(text, fn, cls = "") {
  const b = el("button", cls, text);
  b.type = "button";
  b.onclick = fn;
  return b;
}
export function recordLabel(r, type) {
  const parts = [
    r.startTime || r.time || "時間未知",
    r.endTime ? "至 " + r.endTime : "",
    r.name || names[r.type],
    r.status,
  ];
  if (type === "meal")
    parts.push(
      mealTypes[r.mealType] || mealTypes.unknown,
      orderStates[r.orderStatus] || (r.orderDate ? "已訂購" : "選購狀態未知"),
      "訂購 " + (r.orderDate || "日期未知"),
      "付款 " +
        (r.paid === true ? "已付款" : r.paid === false ? "未付款" : "未確認"),
      "付款日 " + (r.paymentDate || "未知"),
      "開吃 " + (r.startTime || "未確認"),
      "完食 " + (r.status === "吃完" ? r.endTime || "時間未知" : "尚未確認"),
      "購買 " + val(r.quantity, "份"),
      "本人 " + val(r.consumedQuantity, "份"),
      "他人 " + val(r.familyQuantity, "份"),
      "剩餘 " + val(r.remainingQuantity, "份"),
    );
  else if (type === "activity")
    parts.push(val(r.steps, "步"), val(r.minutes, "分鐘"));
  else if (type === "sunlight") parts.push(val(r.minutes, "分鐘"));
  else if (type !== "spending") parts.push("容量 " + val(r.volume, "mL"),
    "開始 " + (r.startTime || "時間未知"),
    "結束 " + (r.endTime || "時間未知"));
  if (type === "spending") parts.push(isPaid(r) ? "已付款／入帳金額 " + val(r.amount, "NT$") : "尚未確認付款，不計合計");
  if (["coffee", "meal", "beverage", "spending"].includes(r.type))
    parts.push(
      r.payment === "voucher"
        ? "兌換券，不重複計帳"
        : { purchase: "購買", refund: "退費", reimbursement: "回補" }[
            r.transactionKind || "purchase"
          ] +
            " " +
            val(r.amount, "NT$"),
      "付款／入帳日 " + (transactionDate(r) || "未知"),
    );
  parts.push(r.note, "ID " + r.id);
  return parts.filter(Boolean).join(" · ");
}
export function openMetricDetail(dialog, source, anchorDate, metricType) {
  if (!metricTypes.includes(metricType)) throw Error("不支援的統計類別");
  let active = "day",
    anchor = anchorDate,
    selectedDay = null;
  const read = () => (typeof source === "function" ? source() : source);
  function paint(focus) {
    const chartScroll = dialog.querySelector(".metric-chart-scroll")?.scrollLeft || 0;
    const scrollTop = dialog.scrollTop;
    dialog.replaceChildren();
    const top = el("div", "metric-detail-header");
    top.append(el("h2", "", names[metricType] + "統計"));
    const close = button("✕", () => dialog.close(), "metric-detail-close");
    close.setAttribute("aria-label", "關閉統計詳情");
    top.append(close);
    dialog.append(top);
    const tabs = el("div", "metric-period-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "統計期間");
    for (const [key, text] of [
      ["day", "日"],
      ["week", "週"],
      ["month", "月"],
    ]) {
      const b = button(
        text,
        () => {
          active = key;
          selectedDay = null;
          paint("tab-" + key);
        },
        active === key ? "is-active" : "",
      );
      b.dataset.focus = "tab-" + key;
      b.setAttribute("aria-pressed", String(active === key));
      tabs.append(b);
    }
    dialog.append(tabs);
    const dateRow = el("div", "metric-date-row"),
      input = el("input");
    input.type = "date";
    input.min = "1900-01-01";
    input.max = "2199-12-31";
    input.value = anchor;
    input.setAttribute("aria-label", "統計參考日期");
    input.dataset.focus = "date";
    input.onchange = () => {
      if (validDate(input.value)) {
        anchor = input.value;
        selectedDay = null;
        paint("date");
      }
    };
    for (const [n, label] of [
      [-1, "上一"],
      [1, "下一"],
    ]) {
      const next = moveMetricDate(anchor, active, n),
        b = button(
          label + { day: "日", week: "週", month: "月" }[active],
          () => {
            anchor = next;
            selectedDay = null;
            paint("nav" + n);
          },
        );
      b.dataset.focus = "nav" + n;
      b.disabled = !validDate(next);
      if (n < 0) dateRow.append(b);
      else {
        dateRow.append(input);
        dateRow.append(b);
      }
    }
    dialog.append(
      dateRow,
      button("重新讀取本機資料", () => paint(), "metric-refresh"),
    );
    let stats, data;
    try {
      data = read();
      stats = metricPeriod(data, anchor, active, metricType);
    } catch (e) {
      const error = el(
        "p",
        "metric-load-error",
        "資料載入或解析失敗：" +
          e.message +
          "。沒有將失敗當成空資料，原始紀錄未改動。",
      );
      error.setAttribute("role", "alert");
      dialog.append(error);
      return;
    }
    const overview = el("section", "metric-detail-overview");
    overview.append(
      el(
        "small",
        "",
        stats.start === stats.end
          ? stats.start
          : stats.start + " ～ " + stats.end,
      ),
    );
    overview.append(
      el(
        "strong",
        "",
        stats.value === null
          ? stats.count
            ? stats.excluded
              ? "區間待核對"
              : stats.unknown
                ? "有紀錄但數值未知"
                : "有紀錄但尚未完成"
            : "本機沒有紀錄"
          : fmt(stats.value, metricType),
      ),
    );
    overview.append(
      el(
        "p",
        "",
        "有紀錄 " +
          stats.observedDays +
          "／" +
          stats.days.length +
          " 天 · 共 " +
          stats.count +
          " 筆 · 有效數值 " +
          stats.validDays +
          " 天。",
      ),
    );
    row(
      overview,
      "每日平均（只除以有效數值天數）",
      fmt(stats.average, metricType),
    );
    overview.append(
      el(
        "p",
        "",
        "未記錄日期不補零；已確認零會納入平均。平均可能只代表已確認部分。",
      ),
    );
    if (["coffee", "water", "beverage"].includes(metricType)) {
      row(
        overview,
        "確認喝完杯／筆數",
        stats.confirmed + "（未知容量仍保留杯數）",
      );
      overview.append(
        el("p", "", "只有「已飲用」計入容量；購買、兌換或開喝不代表喝完。"),
      );
    }
    if (metricType === "activity")
      row(
        overview,
        "已確認活動分鐘（排除重疊）",
        val(stats.minutes.value, "分鐘") +
          " · " +
          stats.minutes.unknown +
          " 筆分鐘未知",
      );
    if (metricType === "meal") {
      row(overview, "本人已食用餐數（包含部分食用）", fmt(stats.value, "meal"));
      row(overview, "其中本人完食餐數", stats.completed + " 餐");
      row(overview, "本人已食用份量", val(stats.personal.value, "份"));
      overview.append(
        el(
          "p",
          "",
          "一筆明確本人食用的紀錄計一餐；購買三份不當作吃三餐。餐別未標註不依時間猜測。餐費使用原交易，不再加入另一筆花費。",
        ),
      );
    }
    if (metricType === "spending") {
      for (const [kind, label] of [
        ["purchase", "總購買（已付款）"],
        ["refund", "退費"],
        ["reimbursement", "回補"],
      ])
        row(overview, label, fmt(stats[kind].value, "spending"));
      overview.append(
        el(
          "p",
          "",
          "主數值為已確認淨支出＝購買－退費－回補；依實際付款／入帳日，不重複計咖啡券。",
        ),
      );
    }
    if (stats.pending)
      overview.append(
        el(
          "p",
          "metric-detail-warning",
          stats.pending + " 筆進行中／未完成／未確認，未計入完成合計。",
        ),
      );
    if (stats.unknown)
      overview.append(
        el(
          "p",
          "metric-detail-warning",
          stats.unknown + " 筆數值或本人份量未知，不當成 0；合計尚不完整。",
        ),
      );
    for (const warning of stats.warnings)
      overview.append(el("p", "metric-detail-warning", warning));
    dialog.append(overview);
    if (active !== "day") {
      const chart = el("section", "metric-chart");
      chart.append(el("h3", "", "每日趨勢 · 點選日期看明細"));
      const scroller = el("div", "metric-chart-scroll"),
        columns = el(
          "div",
          "metric-chart-columns" + (active === "month" ? " is-month" : ""),
        );
      const max = Math.max(1, ...stats.days.map((d) => Math.abs(d.value || 0)));
      for (const day of stats.days) {
        const column = button(
          "",
          () => {
            selectedDay = day.date;
            paint("day-" + day.date);
          },
          "metric-chart-column",
        );
        column.dataset.focus = "day-" + day.date;
        column.dataset.day = day.date;
        column.setAttribute("aria-pressed", String(selectedDay === day.date));
        column.setAttribute(
          "aria-label",
          day.date +
            "：" +
            dayState(day) +
            (day.value === null ? "" : " " + fmt(day.value, metricType)),
        );
        const rail = el("span", "metric-chart-rail"),
          bar = el(
            "span",
            "metric-chart-bar" +
              (day.value === null ? " is-missing" : "") +
              (day.value < 0 ? " is-negative" : ""),
          );
        if (known(day.value))
          bar.style.height =
            Math.max(
              day.value === 0 ? 2 : 4,
              (Math.abs(day.value) / max) * 100,
            ) + "%";
        rail.append(bar);
        column.append(
          el(
            "small",
            "metric-bar-value",
            known(day.value) ? String(day.value) : "—",
          ),
          rail,
          el("small", "", day.date.slice(5).replace("-", "/")),
        );
        columns.append(column);
      }
      scroller.append(columns);
      chart.append(
        scroller,
        el(
          "p",
          "",
          "— 表示沒有可確認數值；0 是明確記錄的零。花費圖顯示淨支出，負值另色標示。",
        ),
      );
      dialog.append(chart);
    }
    if (active === "month") {
      const compare = el("section", "metric-week-compare");
      compare.append(el("h3", "", "每週比較（只含本月日期）"));
      for (const w of stats.weeks)
        row(
          compare,
          w.start.slice(5) + "～" + w.end.slice(5),
          !w.observedDays ? "本機無紀錄 · 有效 0 天" :
          !w.validDays ? "有紀錄，尚無可確認數值 · 有效 0 天" :
          fmt(w.value, metricType) + " · 平均 " + fmt(w.average, metricType) + " · 有效 " + w.validDays + " 天",
        );
      dialog.append(compare);
    }
    const list = el("section", "metric-record-list");
    let entries = stats.entries;
    if (selectedDay) {
      entries = entries.filter((x) => x.date === selectedDay);
      const day = metricDay(data, selectedDay, metricType);
      list.append(
        el(
          "h3",
          "",
          selectedDay +
            " · " +
            day.state +
            (day.value === null ? "" : " · " + fmt(day.value, metricType)),
        ),
        button("返回整體趨勢／顯示整段期間", () => {
          const previous = selectedDay;
          selectedDay = null;
          paint("day-" + previous);
          dialog.querySelector(".metric-chart")?.scrollIntoView?.({block: "nearest"});
        }),
      );
      if (metricType === "spending") {
        for (const [key, label] of [["purchase", "當日已付款購買"], ["refund", "當日退費"], ["reimbursement", "當日回補"]]) row(list, label, fmt(day.extra[key].value, "spending"));
      }
    }
    list.append(el("h3", "", "逐筆時間線（" + entries.length + "）"));
    if (!entries.length)
      list.append(
        el("p", "", "本機沒有這段期間的紀錄。沒有紀錄不代表零攝取或零花費。"),
      );
    else {
      const ul = el("ul");
      for (const item of entries)
        ul.append(
          el(
            "li",
            "",
            item.date + " · " + recordLabel(item.record, metricType),
          ),
        );
      list.append(ul);
    }
    list.setAttribute("aria-live", "polite");
    dialog.insertBefore(list, dialog.querySelector(".metric-week-compare"));
    const scroller = dialog.querySelector(".metric-chart-scroll");
    if (scroller) scroller.scrollLeft = chartScroll;
    dialog.scrollTop = scrollTop;
    if (selectedDay && focus?.startsWith("day-")) list.scrollIntoView?.({block: "nearest"});
    if (focus)
      dialog
        .querySelector('[data-focus="' + focus + '"]')
        ?.focus({ preventScroll: true });
  }
  paint();
  dialog.showModal();
}
