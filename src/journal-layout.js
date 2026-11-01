import { sectionNames } from "./templates.js";

// Measured layout for the fixed-size PNG. The user's JSON is never modified.
const SIZE = { width: 1080, height: 1920, left: 54, top: 292, bottom: 1815, contentWidth: 972, gap: 18, rowGap: 14, header: 46 };
const titleGroups = {
  overview: ["每日主題"],
  health: ["睡眠", "活動", "活動時間", "日照"],
  food: ["餐點", "咖啡已飲用", "飲水", "其他飲品已飲用", "今日已飲用總量", "已付款花費", "購買明細", "退費明細", "回補明細", "已確認淨支出", "飲品明細"],
  highlight: ["今日亮點"],
  body: ["身體狀況", "心情"],
  todo: ["待辦事項"],
};
const familyOf = (t) => t.font === "serif"
  ? 'Georgia, "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", serif' : '"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';
const font = (ctx, size, family, bold = false) => {
  ctx.font = (bold ? "bold " : "") + size + "px " + family;
};

// Wrap actual text, not a fixed number of characters. Also split long URLs.
export function wrapJournalText(ctx, value, width) {
  const lines = [];
  for (const paragraph of String(value ?? "").split(/\r?\n/)) {
    let line = "";
    const words = paragraph.match(/\s+|[A-Za-z0-9_$% .:/-]+|./gu) || [];
    for (const word of words) {
      if (line && ctx.measureText(line + word).width > width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line += word;
      if (ctx.measureText(line).width > width) {
        let part = "";
        for (const ch of Array.from(line)) {
          if (part && ctx.measureText(part + ch).width > width) {
            lines.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}
function articleRows(ctx, item, width, size, family, limit) {
  font(ctx, size, family);
  const all = item.values.flatMap((entry) =>
    wrapJournalText(ctx, entry.title + "：" + entry.value, width - 34));
  const count = Number.isFinite(limit) ? Math.max(1, limit) : all.length;
  const clipped = all.length > count;
  const lines = all.slice(0, count);
  if (clipped) lines[lines.length - 1] = "…其餘文字請查看原始紀錄";
  return { lines, total: all.length, clipped };
}
function eventRows(ctx, item, width, size, family, count, columns) {
  font(ctx, size - 1, family);
  const colWidth = (width - 32 - ((columns - 1) * 16)) / columns;
  const visible = item.events.slice(0, count);
  const rows = [];
  for (let i = 0; i < visible.length; i += columns) {
    const cells = visible.slice(i, i + columns).map((event) => ({
      time: event.time,
      lines: wrapJournalText(ctx,
        event.label + (event.record.name ? " · " + event.record.name : ""),
        colWidth - 78),
    }));
    rows.push({ cells, height: Math.max(34, ...cells.map((c) => c.lines.length * (size + 6))) + 7 });
  }
  return { rows, hidden: item.events.length - visible.length };
}
function measure(ctx, items, columns, size, family, shown, limits) {
  const rows = [];
  let queue = [];
  const flush = () => {
    if (queue.length) rows.push({ items: queue, wide: columns === 1 });
    queue = [];
  };
  for (const item of items) {
    if (item.key === "timeline") {
      flush();
      rows.push({ items: [item], wide: true });
    } else if (columns === 1) rows.push({ items: [item], wide: true });
    else {
      queue.push(item);
      if (queue.length === columns) flush();
    }
  }
  flush();
  let height = Math.max(0, rows.length - 1) * SIZE.rowGap;
  for (const row of rows) {
    const width = row.wide ? SIZE.contentWidth : (SIZE.contentWidth - SIZE.gap * (row.items.length - 1)) / row.items.length;
    row.cards = row.items.map((item) => {
      if (item.key === "timeline") {
        const content = eventRows(ctx, item, width, size, family, shown, columns);
        const h = SIZE.header + 28 + content.rows.reduce((n, r) => n + r.height, 0) + (content.hidden ? 32 : 0);
        return { item, content, height: Math.max(115, h) };
      }
      const content = articleRows(ctx, item, width, size, family, limits[item.key]);
      return { item, content, height: Math.max(115, SIZE.header + 29 + content.lines.length * (size + 8)) };
    });
    row.height = Math.max(...row.cards.map((card) => card.height));
    height += row.height;
  }
  return { rows, height, size, columns, shown, limits };
}
export function planJournalLayout(ctx, sections, events, template) {
  const foodGroups = [
    ['food-meals', '飲食時間線', ['餐點']],
    ['food-drinks', '飲品與攝取', ['咖啡已飲用','飲水','其他飲品已飲用','今日已飲用總量','飲品明細']],
    ['food-money', '花費明細', ['已付款花費','購買明細','退費明細','回補明細','已確認淨支出']],
  ];
  const items = template.mapping.flatMap((key) => {
    if (key === 'food') return foodGroups.map(([key,title,titles]) => ({key,title,values:sections.filter(v=>titles.includes(v.title))})).filter(item=>item.values.length);
    if (key === "timeline") return events.length ? { key, events } : null;
    const values = sections.filter((v) => (titleGroups[key] || []).includes(v.title));
    return values.length ? { key, values } : null;
  }).filter(Boolean);
  const columns = [1,2,3].includes(template.columns) ? template.columns : 3;
  const family = familyOf(template);
  if (!items.length) return { rows: [], height: 0, missing: true, shown: 0, clipped: 0 };
  let shown = events.length;
  const limits = {};
  let result;
  for (const size of [27, 25, 23, 21, 19]) {
    result = measure(ctx, items, columns, size, family, shown, limits);
    if (result.height <= SIZE.bottom - SIZE.top) break;
  }
  // Prioritize real narrative content; progressively shorten the timeline
  // only when the page is too full, with an explicit remaining-event count.
  while (result.height > SIZE.bottom - SIZE.top && shown > 0) {
    shown--;
    result = measure(ctx, items, columns, 19, family, shown, limits);
  }
  // Extremely long personal notes may still exceed one page. Never draw out
  // of bounds: abbreviate the longest card and label it as incomplete.
  let attempts = 0;
  while (result.height > SIZE.bottom - SIZE.top && attempts++ < 3000) {
    let choice = null;
    let longest = 2;
    for (const row of result.rows) for (const card of row.cards) {
      if (card.item.key === "timeline") continue;
      const cap = limits[card.item.key] ?? card.content.total;
      if (cap > longest) { longest = cap; choice = card.item.key; }
    }
    if (!choice) break;
    limits[choice] = longest - 1;
    result = measure(ctx, items, columns, 19, family, shown, limits);
  }
  return {
    ...result, missing: false,
    clipped: result.rows.filter((row) =>
      row.cards.some((card) => card.content.clipped)).length,
  };
}
function readableAccent(hex) {
  const rgb = hex.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
  return (299 * rgb[0] + 587 * rgb[1] + 114 * rgb[2]) / 1000 > 150
    ? "#152a24" : "#ffffff";
}
function paintCard(ctx, card, x, y, width, height, size, family, template, columns) {
  ctx.fillStyle = "#fffefa";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = template.accent;
  ctx.fillRect(x, y, width, SIZE.header);
  ctx.fillStyle = readableAccent(template.accent);
  font(ctx, 27, family, true);
  ctx.fillText(card.item.title || sectionNames[card.item.key], x + 15, y + 32, width - 30);
  if (card.item.key !== "timeline") {
    font(ctx, size, family);
    ctx.fillStyle = "#263d37";
    let baseline = y + SIZE.header + 15 + size;
    for (const line of card.content.lines) {
      ctx.fillText(line, x + 16, baseline, width - 32);
      baseline += size + 8;
    }
    return;
  }
  const gutter = 16;
  const cw = (width - 32 - gutter * (columns - 1)) / columns;
  let top = y + SIZE.header + 15;
  for (const row of card.content.rows) {
    row.cells.forEach((cell, i) => {
      const left = x + 16 + i * (cw + gutter);
      ctx.fillStyle = template.accent;
      font(ctx, size - 1, family, true);
      ctx.fillText(cell.time, left, top + size, 75);
      ctx.fillStyle = "#263d37";
      font(ctx, size - 1, family);
      cell.lines.forEach((line, index) =>
        ctx.fillText(line, left + 78, top + size + index * (size + 6), cw - 78));
    });
    top += row.height;
  }
  if (card.content.hidden) {
    font(ctx, 20, family);
    ctx.fillStyle = "#526d61";
    ctx.fillText("另有 " + card.content.hidden + " 筆事件，請查看原始紀錄", x + 16, top + 20, width - 32);
  }
}
export function renderJournalTemplate(canvas, sections, events, date, template) {
  canvas.width = SIZE.width;
  canvas.height = SIZE.height;
  const ctx = canvas.getContext("2d");
  const family = familyOf(template);
  ctx.fillStyle = template.background;
  ctx.fillRect(0, 0, SIZE.width, SIZE.height);
  ctx.fillStyle = "#245f72";
  ctx.fillRect(54, 48, 972, 220);
  ctx.fillStyle = "#fff";
  font(ctx, 40, family, true);
  ctx.fillText("PROJECT SECOND BRAIN", 85, 111);
  font(ctx, 58, family, true);
  ctx.fillText(date, 85, 187);
  font(ctx, 28, family);
  ctx.fillText("DAILY JOURNAL", 85, 235);
  const plan = planJournalLayout(ctx, sections, events, template);
  if (plan.missing) {
    font(ctx, 31, family);
    ctx.fillStyle = "#526d61";
    ctx.fillText("今天尚無可整理的數據", 75, 360);
  } else {
    let top = SIZE.top;
    for (const row of plan.rows) {
      const width = row.wide ? SIZE.contentWidth : (SIZE.contentWidth - SIZE.gap * (row.cards.length - 1)) / row.cards.length;
      row.cards.forEach((card, index) =>
        paintCard(ctx, card, SIZE.left + index * (width + SIZE.gap),
          top, width, row.height, plan.size, family, template, plan.columns));
      top += row.height + SIZE.rowGap;
    }
    if (plan.clipped) {
      font(ctx, 19, family);
      ctx.fillStyle = "#526d61";
      ctx.fillText("長文字超過單頁篇幅，完整內容請查看原始紀錄", 75, 1840);
    }
  }
  font(ctx, 23, family);
  ctx.fillStyle = "#33483d";
  ctx.fillText("生活小誌 · 以已記錄的資料整理", 54, 1871);
  return plan;
}
