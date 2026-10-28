import { rows, sum, expenses } from "./data.js";
import { sectionNames } from "./templates.js";
export const names = {
  sleep: "睡眠",
  coffee: "咖啡",
  water: "飲水",
  activity: "活動",
  sunlight: "日照",
  meal: "餐點",
  spending: "花費",
  event: "重要事件",
  journal: "小誌文字",
};
export function timeline(data, date) {
  const entries = [];
  for (const r of data.records.filter((r) => r.date === date)) {
    const add = (time, label) => {
      if (time) entries.push({ time, label, record: r });
    };
    if (r.type === "meal") {
      add(r.startTime, "開始用餐");
      add(r.endTime, r.status === "吃完" ? "完食" : "結束用餐");
    } else if (r.type === "coffee") {
      if (r.startTime || r.endTime) {
        add(r.startTime, "開始喝咖啡");
        add(r.endTime, r.status === "已飲用" ? "喝完咖啡" : "結束飲用");
      }
      if (r.time && r.time !== r.startTime && r.time !== r.endTime)
        add(r.time, "咖啡紀錄");
    } else add(r.time, names[r.type]);
  }
  return entries.sort(
    (a, b) => a.time.localeCompare(b.time) || a.label.localeCompare(b.label),
  );
}
export function journalSections(data, date) {
  const result = [];
  const add = (title, rs, key, unit) => {
    let s = sum(rs, key);
    if (s.value !== null)
      result.push({
        title,
        value: `${s.value.toLocaleString("zh-TW")} ${unit}${s.unknown ? `（${s.unknown} 筆未知）` : ""}`,
      });
  };
  add("睡眠", rows(data, date, "sleep"), "minutes", "分鐘");
  const act = rows(data, date, "activity").filter((r) => r.status === "已完成");
  add("活動", act, "steps", "步");
  add("活動時間", act, "minutes", "分鐘");
  add("日照", rows(data, date, "sunlight"), "minutes", "分鐘");
  add(
    "咖啡已飲用",
    rows(data, date, "coffee").filter((r) => r.status === "已飲用"),
    "volume",
    "mL",
  );
  add("飲水", rows(data, date, "water"), "volume", "mL");
  const meals = rows(data, date, "meal");
  if (meals.length)
    result.push({
      title: "餐點",
      value: meals.map((r) => `${r.name}（${r.status}）`).join("、"),
    });
  add("已付款花費", expenses(data, date), "amount", "NT$");
  for (const r of rows(data, date, "journal"))
    for (const [key, label] of [
      ["theme", "每日主題"],
      ["highlight", "今日亮點"],
      ["wellbeing", "身體狀況"],
      ["mood", "心情"],
      ["todo", "待辦事項"],
    ])
      if (r[key]) result.push({ title: label, value: r[key] });
  return result;
}
export function drawJournal(canvas, data, date, template = null) {
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = template?.background || "#f6f3eb";
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = template?.accent || "#264039";
  ctx.font = "bold 38px sans-serif";
  ctx.fillText("PROJECT SECOND BRAIN", 80, 115);
  ctx.fillStyle = "#718478";
  ctx.font = "28px sans-serif";
  ctx.fillText("A LITTLE JOURNAL OF MY DAY", 80, 163);
  ctx.fillStyle = template?.accent || "#264039";
  ctx.font = "bold 72px sans-serif";
  ctx.fillText(date, 80, 280);
  ctx.strokeStyle = "#bbcabd";
  ctx.beginPath();
  ctx.moveTo(80, 310);
  ctx.lineTo(1000, 310);
  ctx.stroke();
  const sections = journalSections(data, date);
  let y = 375;
  function fit(str, width) {
    while (str.length > 1 && ctx.measureText(str).width > width)
      str = str.slice(0, -1);
    return str;
  }
  if (!sections.length) {
    ctx.font = "36px sans-serif";
    ctx.fillStyle = "#718478";
    ctx.fillText("今天尚無可整理的數據", 80, y + 40);
    y += 100;
  }
  for (let i = 0; i < sections.length; i++) {
    const x = 80 + (i % 2) * 465,
      top = 350 + Math.floor(i / 2) * 160;
    ctx.fillStyle = "#fffefa";
    ctx.fillRect(x, top, 445, 140);
    ctx.fillStyle = "#718478";
    ctx.font = "26px sans-serif";
    ctx.fillText(sections[i].title, x + 22, top + 39);
    ctx.fillStyle = template?.accent || "#264039";
    ctx.font = "bold 29px sans-serif";
    let val = sections[i].value;
    let short = fit(val, 400);
    ctx.fillText(short + (short !== val ? "…" : ""), x + 22, top + 92);
  }
  if (sections.length) y = 350 + Math.ceil(sections.length / 2) * 160 + 35;
  const events = timeline(data, date);
  if (events.length) {
    ctx.fillStyle = template?.accent || "#264039";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("今日時間軸", 80, y);
    y += 55;
    const available = Math.max(0, Math.floor((1800 - y) / 65));
    for (const e of events.slice(0, available)) {
      ctx.font = "27px sans-serif";
      ctx.fillStyle = "#667c70";
      ctx.fillText(e.time, 80, y);
      ctx.fillStyle = template?.accent || "#264039";
      let value = `${e.label} ${e.record.name || ""}`;
      let short = fit(value, 760);
      ctx.fillText(short + (short !== value ? "…" : ""), 210, y);
      y += 65;
    }
    if (events.length > available) {
      ctx.fillStyle = "#667c70";
      ctx.fillText(
        `另有 ${events.length - available} 個事件，請查看原始紀錄`,
        80,
        1835,
      );
    }
  }
  ctx.fillStyle = "#718478";
  ctx.font = "24px sans-serif";
  ctx.fillText("記錄生活，留一點空白。", 80, 1870);
}
export function drawTemplateJournal(canvas, data, date, template) {
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  const family =
    template.font === "serif"
      ? 'Georgia, "Microsoft JhengHei", serif'
      : '"Microsoft JhengHei", sans-serif';
  ctx.fillStyle = template.background;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = "#245f72";
  ctx.fillRect(54, 48, 972, 220);
  ctx.fillStyle = "#fff";
  ctx.font = `bold 40px ${family}`;
  ctx.fillText("PROJECT SECOND BRAIN", 85, 110);
  ctx.font = `bold 58px ${family}`;
  ctx.fillText(date, 85, 186);
  ctx.font = `28px ${family}`;
  ctx.fillText("DAILY JOURNAL", 85, 235);
  const all = journalSections(data, date),
    events = timeline(data, date);
  const groups = {
    overview: ["每日主題"],
    health: ["睡眠", "活動", "活動時間", "日照"],
    food: ["餐點", "咖啡已飲用", "飲水", "已付款花費"],
    highlight: ["今日亮點"],
    body: ["身體狀況", "心情"],
    todo: ["待辦事項"],
  };
  let y = 295,
    col = 0;
  const height = 220,
    gap = 20,
    width = template.columns === 1 ? 972 : 476;
  const fit = (v, n) => {
    while (v.length > 1 && ctx.measureText(v).width > n) v = v.slice(0, -1);
    return v;
  };
  for (const key of template.mapping) {
    const entries =
      key === "timeline"
        ? events.map((e) => `${e.time} ${e.label} ${e.record.name || ""}`)
        : all
            .filter((x) => (groups[key] || []).includes(x.title))
            .map((x) => `${x.title}：${x.value}`);
    if (!entries.length) continue;
    const x = 54 + col * (width + gap);
    if (y + height > 1805) {
      ctx.fillStyle = "#33483d";
      ctx.font = `24px ${family}`;
      ctx.fillText("更多內容請查看原始紀錄", 54, 1835);
      break;
    }
    ctx.fillStyle = "#fffefa";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = template.accent;
    ctx.fillRect(x, y, width, 54);
    ctx.font = `bold 29px ${family}`;
    const rgb = template.accent
      .match(/[0-9a-f]{2}/gi)
      .map((x) => parseInt(x, 16));
    ctx.fillStyle =
      (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150
        ? "#152a24"
        : "#ffffff";
    ctx.fillText(sectionNames[key], x + 16, y + 37);
    ctx.fillStyle = "#263d37";
    ctx.font = `28px ${family}`;
    for (let i = 0; i < Math.min(3, entries.length); i++) {
      const value = entries[i],
        v = fit(value, width - 36);
      ctx.fillText(v + (v !== value ? "…" : ""), x + 16, y + 97 + i * 39);
    }
    if (entries.length > 3) {
      ctx.fillStyle = "#5b6c64";
      ctx.font = `22px ${family}`;
      ctx.fillText(
        `另有 ${entries.length - 3} 筆，請查看原始紀錄`,
        x + 16,
        y + 204,
      );
    }
    col++;
    if (col >= template.columns) {
      col = 0;
      y += height + gap;
    }
  }
  ctx.fillStyle = "#33483d";
  ctx.font = `24px ${family}`;
  ctx.fillText("生活小誌 · 以已記錄的資料整理", 54, 1870);
}
