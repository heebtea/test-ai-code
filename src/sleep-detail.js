const stageNames = { awake: "清醒", rem: "快速動眼期", core: "核心睡眠", deep: "深睡" };
const stageOrder = ["awake", "rem", "core", "deep"];

function el(tag, className = "", label = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label) node.textContent = label;
  return node;
}

const validNum = (value) => Number.isInteger(value) && value >= 0;
export function sleepDay(data, date) {
  const records = data.records.filter((r) => r.type === "sleep" && r.date === date);
  const known = (field) => {
    if (!records.length || records.some((r) => !validNum(r[field]))) return null;
    return records.reduce((total, r) => total + r[field], 0);
  };
  const minutes = known("minutes");
  const deep = known("deep");
  const rem = known("rem");
  const explicitCore = known("core");
  const core = explicitCore === null && minutes !== null && deep !== null && rem !== null
    ? minutes - deep - rem
    : explicitCore;
  const awake = known("awake");
  const scores = records.filter((r) => validNum(r.score)).map((r) => r.score);
  const score = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;
  const segments = records.flatMap((r) => Array.isArray(r.segments) ? r.segments : []);
  return {
    count: records.length, minutes, deep, rem, core, awake, score, segments,
    coreEstimated: explicitCore === null && core !== null,
  };
}

function shiftDay(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthStart(date, n) {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return d.toISOString().slice(0, 7);
}
export function sleepTrend(data, date, period) {
  if (period === "sixMonths") {
    const groups = Array.from({ length: 6 }, (_, i) => monthStart(date, i - 5));
    return groups.map((month) => {
      const dates = [...new Set(data.records.filter((r) => r.type === "sleep" && r.date.startsWith(month) && r.date <= date).map((r) => r.date))];
      const values = dates.map((d) => sleepDay(data, d).minutes).filter(validNum);
      const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
      return { label: month.slice(5) + "月", average: avg, days: values.length };
    });
  }
  const n = period === "week" ? 7 : 30;
  return Array.from({ length: n }, (_, i) => {
    const d = shiftDay(date, i - n + 1);
    const day = sleepDay(data, d);
    return { label: d.slice(5).replace("-", "/"), average: day.minutes, days: day.minutes === null ? 0 : 1 };
  });
}
function duration(minutes) {
  if (minutes === null) return "尚無資料";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? h + " 小時 " + m + " 分" : m + " 分鐘";
}
function stageRow(parent, name, value, note = "") {
  const row = el("div", "sleep-stage-row");
  const dot = el("i", "sleep-dot sleep-dot-" + name);
  dot.setAttribute("aria-hidden", "true");
  const title = el("span", "", stageNames[name] + (note ? " · " + note : ""));
  const number = el("strong", "", duration(value));
  row.append(dot, title, number);
  parent.append(row);
}
function dayDistribution(container, day) {
  const panel = el("section", "sleep-stage-panel");
  panel.append(el("h3", "", "睡眠階段"));
  const bar = el("div", "sleep-stage-band");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", "睡眠階段比例，僅根據已知資料顯示");
  const stages = [
    ["deep", day.deep], ["core", day.core], ["rem", day.rem],
  ];
  const used = stages.filter((entry) => validNum(entry[1]));
  if (day.minutes !== null && day.minutes > 0 && used.length) {
    for (const [key, amount] of used) {
      const seg = el("span", "sleep-band-" + key);
      seg.style.flexGrow = String(amount);
      seg.style.flexBasis = "0";
      seg.title = stageNames[key] + "：" + duration(amount);
      bar.append(seg);
    }
    const remainder = day.minutes - used.reduce((s, entry) => s + entry[1], 0);
    if (remainder > 0) {
      const rest = el("span", "sleep-band-unknown");
      rest.style.flexGrow = String(remainder);
      rest.style.flexBasis = "0";
      rest.title = "未分類：" + duration(remainder);
      bar.append(rest);
    }
    panel.append(bar);
  } else {
    panel.append(el("p", "sleep-empty", "尚無足夠睡眠階段資料，不能推算比例。"));
  }
  for (const key of stageOrder) stageRow(panel, key, day[key], key === "core" && day.coreEstimated ? "由總睡眠扣除深睡及 REM 推算" : "");
  panel.append(el("p", "sleep-caption", "清醒時間不包含在總睡眠時間內；沒有原始分段時不會製作逐時睡眠曲線。"));
  container.append(panel);
}

function exactTimeline(container, segments) {
  const sorted = [...segments].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!sorted.length) return;
  const start = Date.parse(sorted[0].start);
  const end = Math.max(...sorted.map((r) => Date.parse(r.end)));
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return;
  const panel = el("section", "sleep-chart-panel");
  panel.append(el("h3", "", "實際睡眠階段時間軸"));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 660 244");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "依匯入之實際分段時間製作，未記錄時間留白");
  const NS = "http://www.w3.org/2000/svg";
  const addSvg = (tag, attrs, label) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (label) node.textContent = label;
    svg.append(node);
    return node;
  };
  for (let i = 0; i < stageOrder.length; i++) {
    const stage = stageOrder[i];
    addSvg("text", { x: 5, y: 39 + i * 43, class: "sleep-axis-label" }, stageNames[stage]);
    addSvg("line", { x1: 94, y1: 46 + i * 43, x2: 640, y2: 46 + i * 43, class: "sleep-grid-line" });
  }
  for (const segment of sorted) {
    const x = 94 + (Date.parse(segment.start) - start) / span * 546;
    const w = (Date.parse(segment.end) - Date.parse(segment.start)) / span * 546;
    const y = 23 + stageOrder.indexOf(segment.stage) * 43;
    const rect = addSvg("rect", { x, y, width: Math.max(0.5, w), height: 24, rx: 6, class: "sleep-rect-" + segment.stage });
    const title = document.createElementNS(NS, "title");
    title.textContent = stageNames[segment.stage] + " " + segment.start + "～" + segment.end;
    rect.append(title);
  }
  const showTime = (timestamp) => new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
  addSvg("text", { x: 94, y: 229, class: "sleep-axis-label" }, showTime(start));
  addSvg("text", { x: 640, y: 229, class: "sleep-axis-label", "text-anchor": "end" }, showTime(end));
  panel.append(svg, el("p", "sleep-caption", "僅繪製有提供起迄時間的實際階段；空白區段代表沒有資料。"));
  container.append(panel);
}
function trends(container, data, date, period) {
  const records = sleepTrend(data, date, period);
  const values = records.filter((r) => r.average !== null).map((r) => r.average);
  const mean = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const totalDays = records.reduce((a, b) => a + b.days, 0);
  const stat = el("section", "sleep-trend-stat");
  stat.append(el("span", "", period === "sixMonths" ? "各月已記錄日的平均睡眠" : "有紀錄日期的平均睡眠"));
  stat.append(el("strong", "", duration(mean)));
  stat.append(el("small", "", "有資料的天數：" + totalDays + "；缺漏日不視為 0 分鐘"));
  container.append(stat);
  const scroll = el("div", "sleep-trend-scroll");
  const barSet = el("div", "sleep-trend-bars");
  barSet.style.minWidth = period === "month" ? "660px" : "auto";
  for (const row of records) {
    const col = el("div", "sleep-trend-column");
    const rail = el("div", "sleep-trend-rail");
    const bar = el("div", "sleep-trend-bar" + (row.average === null ? " sleep-trend-missing" : ""));
    const pct = row.average === null ? 0 : Math.min(100, Math.max(2, row.average / 720 * 100));
    bar.style.height = pct + "%";
    bar.title = row.label + "：" + duration(row.average);
    bar.setAttribute("aria-label", bar.title);
    rail.append(bar);
    col.append(rail, el("small", "", row.label));
    barSet.append(col);
  }
  scroll.append(barSet);
  container.append(scroll);
  container.append(el("p", "sleep-caption", period === "sixMonths" ? "每根柱為該月有紀錄日期的平均睡眠時數。" : "每日柱狀圖；沒有記錄的日期以空白顯示，不補造數據。"));
}
export function openSleepDetail(dialog, data, selectedDate) {
  let active = "day";
  let anchor = selectedDate;
  const paint = () => {
    dialog.replaceChildren();
    const header = el("div", "sleep-dialog-header");
    header.append(el("h2", "", "睡眠"));
    const close = el("button", "sleep-dialog-close", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "關閉睡眠詳情");
    close.onclick = () => dialog.close();
    header.append(close);
    dialog.append(header);
    const tabs = el("div", "sleep-tabs");
    tabs.setAttribute("role", "group");
    for (const [key, title] of [["day", "天"], ["week", "週"], ["month", "月"], ["sixMonths", "6 個月"]]) {
      const button = el("button", active === key ? "sleep-tab is-active" : "sleep-tab", title);
      button.type = "button";
      button.setAttribute("aria-pressed", String(active === key));
      button.onclick = () => { active = key; paint(); };
      tabs.append(button);
    }
    dialog.append(tabs);
    const selectRow = el("div", "sleep-date-select");
    selectRow.append(el("label", "", "參考日期"));
    const input = el("input");
    input.type = "date";
    input.value = anchor;
    input.setAttribute("aria-label", "睡眠統計參考日期");
    input.onchange = () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.value) && !Number.isNaN(Date.parse(input.value + "T12:00:00Z"))) {
        anchor = input.value; paint();
      }
    };
    selectRow.append(input);
    dialog.append(selectRow);
    if (active === "day") {
      const day = sleepDay(data, anchor);
      const overview = el("section", "sleep-overview");
      overview.append(el("span", "", "總睡眠時間"));
      overview.append(el("strong", "", duration(day.minutes)));
      overview.append(el("small", "", anchor + " · 睡眠分數 " + (day.score === null ? "未記錄" : day.score)));
      dialog.append(overview);
      if (!day.count) {
        dialog.append(el("p", "sleep-empty", "這一天沒有睡眠紀錄。可返回首頁新增睡眠資料。"));
      } else {
        if (day.segments.length) exactTimeline(dialog, day.segments);
        else dialog.append(el("p", "sleep-caption", "目前只有各階段總分鐘數，沒有真實起迄時間，因此不會顯示虛構的逐時曲線。"));
        dayDistribution(dialog, day);
      }
    } else {
      trends(dialog, data, anchor, active);
    }
  };
  paint();
  dialog.showModal();
}
