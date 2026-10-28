import "./style.css";
import { recognizeCard } from "./ocr.js";
import { planCandidates, candidateRecord } from "./ocr-records.js";
import { timeline, drawTemplateJournal, journalSections } from "./journal.js";
import {
  baseTemplate,
  sectionNames,
  sectionKeys,
  palette,
  validateTemplate,
  listTemplates,
  putTemplate,
  deleteTemplate,
} from "./templates.js";
import { getPhoto, putPhoto, deletePhoto } from "./photos.js";
import {
  STORAGE_KEY,
  THEME_KEY,
  types,
  fields,
  statuses,
  empty,
  localDate,
  validDate,
  shiftDate,
  loadRecords,
  persist,
  upsert,
  remove,
  rows,
  sum,
  expenses,
  parseBackup,
  merge,
} from "./data.js";
const app = document.querySelector("#app");
const names = {
  sleep: "睡眠",
  coffee: "咖啡",
  water: "飲水",
  activity: "活動",
  spending: "花費",
  meal: "餐點",
  sunlight: "日照",
  event: "重要事件",
  journal: "小誌文字",
};
const labels = {
  minutes: "時間（分鐘）",
  deep: "深睡（分鐘）",
  rem: "REM（分鐘）",
  score: "分數",
  volume: "容量（mL）",
  amount: "金額（NT$）",
  steps: "步數",
};
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let date = localDate(),
  data = empty(),
  blocked = false,
  message = "",
  theme = "light",
  storage;
let photoUrls = [];
let templates = [];
let selectedTemplate = baseTemplate();
function clearPhotoUrls() {
  photoUrls.forEach((url) => URL.revokeObjectURL(url));
  photoUrls = [];
}
try {
  storage = window.localStorage;
  data = loadRecords(storage);
  theme = storage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  if (storage.getItem("second-brain-lite-v1"))
    message = "偵測到舊展示版資料：為避免混入假值，未自動轉入，舊資料仍保留。";
} catch {
  blocked = true;
  message =
    "無法讀取本機資料或資料毀損。已停止寫入，原內容未覆寫。請先匯出原始儲存內容或檢查瀏覽器設定。";
}
const fmt = (v, unit = "") =>
  v === null ? "尚無資料" : `${v.toLocaleString("zh-TW")} ${unit}`;
function total(rs, k, u) {
  const s = sum(rs, k);
  return fmt(s.value, u) + (s.unknown ? `（${s.unknown} 筆未提供）` : "");
}
function detail(r) {
  return [
    r.name,
    r.type === "journal"
      ? `主題：${r.theme || "尚無資料"} · 亮點：${r.highlight || "尚無資料"} · 身體：${r.wellbeing || "尚無資料"} · 心情：${r.mood || "尚無資料"} · 待辦：${r.todo || "尚無資料"}`
      : "",
    r.source,
    r.type === "meal"
      ? `訂購日：${r.orderDate ?? "尚無資料"} · 付款：${r.paid === null ? "未確認" : r.paid ? "已付款" : "未付款"} · 付款日：${r.paymentDate ?? "尚無資料"} · 用餐：${r.startTime || "尚無資料"}–${r.endTime || "尚無資料"}`
      : "",
    r.status,
    r.type === "coffee"
      ? `開始：${r.startTime || "尚無資料"} · 結束：${r.endTime || "尚無資料"}`
      : "",
    r.time,
    ...Object.keys(fields[r.type]).map((k) => `${labels[k]}：${fmt(r[k])}`),
    r.type === "coffee"
      ? r.payment === "voucher"
        ? "兌換券（不計支出）"
        : "購買（計入支出）"
      : "",
    r.type === "coffee"
      ? `購買日：${r.purchaseDate === undefined ? r.date : (r.purchaseDate ?? "尚無資料")}`
      : "",
    r.note,
  ]
    .filter(Boolean)
    .join(" · ");
}
function save(next) {
  if (blocked) throw Error("儲存已停用，原始資料未覆寫");
  const current = loadRecords(storage);
  if (JSON.stringify(current) !== JSON.stringify(data))
    throw Error("另一分頁已更新資料，請重新整理後再操作");
  persist(storage, next);
  data = next;
}
function render() {
  clearPhotoUrls();
  document.documentElement.dataset.theme = theme;
  app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">✳ SECOND BRAIN LITE v0.4</div><button id="theme" class="theme-toggle">${theme === "dark" ? "淺色" : "深色"}模式</button></header><main><div class="intro"><div><h1>Project Second Brain</h1><p>生活小誌 · 留下今天的一點線索。</p></div></div><div class="notice">紀錄與照片只存於此瀏覽器，不上傳或同步。JSON 不含照片與模板參考圖，請另外保留原檔。</div><p id="message" role="status">${esc(message)}</p><div class="toolbar"><button id="export">匯出 JSON 備份</button><label class="file-button">匯入 JSON 備份<input id="import" type="file" accept="application/json,.json" ${blocked ? "disabled" : ""}></label>${blocked ? '<button id="raw">匯出原始儲存內容</button>' : ""}</div><div class="section-heading"><h2>每日總覽</h2><div class="date-nav"><button id="prev" aria-label="前一天">‹</button><input id="date" type="date" min="1900-01-01" max="2199-12-31" value="${date}" aria-label="選擇日期"><button id="next" aria-label="後一天">›</button></div></div><div class="dashboard">${types
    .filter((type) => type !== "event" && type !== "journal")
    .map((type) => {
      const rs = rows(data, date, type);
      let summary = "尚無資料";
      if (type === "sleep") summary = total(rs, "minutes", "分鐘");
      if (type === "water") summary = total(rs, "volume", "mL");
      if (type === "coffee")
        summary = total(
          rs.filter((r) => r.status === "已飲用"),
          "volume",
          "mL 已飲用",
        );
      if (type === "activity")
        summary = total(
          rs.filter((r) => r.status === "已完成"),
          "steps",
          "步已完成",
        );
      if (type === "sunlight") summary = total(rs, "minutes", "分鐘");
      if (type === "meal" && rs.length)
        summary = `${rs.some((r) => r.status === "吃完") ? rs.filter((r) => r.status === "吃完").length + " 筆吃完" : "完整食用尚無資料"} · ${rs.filter((r) => r.status === "部分").length} 筆部分 · ${rs.filter((r) => r.status === "未確認").length} 筆未確認`;
      if (type === "spending")
        summary = total(expenses(data, date), "amount", "NT$");
      return `<section class="card ${type}"><div class="card-head"><h2>${names[type]}</h2><button data-add="${type}" ${blocked ? "disabled" : ""}>新增</button></div><button class="card-toggle" aria-expanded="false" aria-label="展開${names[type]}明細"><span class="metric">${summary}</span><span class="card-cue">查看紀錄 ↗</span></button><details class="record-details"><summary>紀錄明細（${rs.length}）</summary>${type === "spending" ? "<p>依付款日計算餐點、購買日計算咖啡，加上已付款花費。餐點與咖啡請勿再記一筆花費；券只在購券時記帳。付款日期未知的餐點不推定為今日支出。</p>" : ""}${
        type === "activity"
          ? `<p>已完成時間：${total(
              rs.filter((r) => r.status === "已完成"),
              "minutes",
              "分鐘",
            )}</p>`
          : ""
      }<ul>${rs.map((r) => `<li><p>${esc(detail(r))}</p><button data-edit="${r.id}" ${blocked ? "disabled" : ""}>編輯</button><button data-delete="${r.id}" ${blocked ? "disabled" : ""}>刪除</button></li>`).join("")}</ul>${rs.length ? "" : "<p>尚無資料</p>"}</details></section>`;
    })
    .join(
      "",
    )}</div><details class="timeline"><summary>當日時間軸</summary><ul>${
    timeline(data, date)
      .map(
        (entry) =>
          `<li><button class="timeline-event" data-event="${entry.record.id}"><time>${esc(entry.time)}</time><span><b>${esc(entry.label)}</b><small>${esc(entry.record.name || entry.record.status)}</small></span><img data-photo="${entry.record.id}" alt="事件照片" hidden></button></li>`,
      )
      .join("") || "<li>尚無有時間的紀錄</li>"
  }</ul><button data-add="event" ${blocked ? "disabled" : ""}>＋ 新增重要事件</button></details>${templateView()}<section class="journal-banner"><div><small>THE DAILY EDIT</small><h2>把今天，收進小誌裡。</h2><p>用已記錄的片段，留下一張屬於今天的直式小誌。</p></div><button id="journal">產生今日小誌</button></section><p class="footer">睡眠以起床日期記錄；活動請記錄不重疊的區段。空白數值代表未知，只有明確輸入 0 才是零。</p></main></div><dialog id="editor" aria-labelledby="dialog-title"></dialog><dialog id="confirm" aria-labelledby="confirm-title"></dialog><dialog id="event-detail"></dialog><dialog id="journal-dialog"></dialog><dialog id="template-editor"></dialog><dialog id="ocr-dialog" aria-labelledby="ocr-title"></dialog>`;
  applyTemplateStyles(
    document.querySelector(".template-sheet"),
    selectedTemplate,
  );
  document.querySelectorAll(".card").forEach((card) =>
    card.addEventListener("click", (e) => {
      if (!e.target.closest("button, summary, details, input, select"))
        card.querySelector(".card-toggle").click();
    }),
  );
  document.querySelectorAll(".card-toggle").forEach(
    (button) =>
      (button.onclick = () => {
        const d = button.parentElement.querySelector("details");
        d.open = !d.open;
        button.setAttribute("aria-expanded", String(d.open));
      }),
  );
  document.querySelectorAll(".record-details").forEach(
    (d) =>
      (d.ontoggle = () => {
        const b = d.parentElement.querySelector(".card-toggle");
        b.setAttribute("aria-expanded", String(d.open));
      }),
  );
  document
    .querySelectorAll("[data-event]")
    .forEach((b) => (b.onclick = () => showEvent(b.dataset.event)));
  if (typeof indexedDB !== "undefined")
    document.querySelectorAll("[data-photo]").forEach(async (img) => {
      try {
        const blob = await getPhoto(img.dataset.photo);
        if (blob && img.isConnected) {
          const url = URL.createObjectURL(blob);
          photoUrls.push(url);
          img.src = url;
          img.hidden = false;
        }
      } catch {
        /* unavailable photos do not block records */
      }
    });
  document
    .querySelectorAll("[data-template-add]")
    .forEach((b) => (b.onclick = () => edit(b.dataset.templateAdd)));
  document.querySelectorAll("[data-template-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const r = data.records.find((r) => r.id === b.dataset.templateEdit);
        if (r) edit(r.type, r);
      }),
  );
  document
    .querySelectorAll("[data-template-event]")
    .forEach((b) => (b.onclick = () => showEvent(b.dataset.templateEvent)));
  document.querySelector("#ocr-open").onclick = () => openOcr();
  document.querySelector("#template-new").onclick = () => templateEditor(null);
  document.querySelector("#template-edit").onclick = () =>
    templateEditor(selectedTemplate.id === "default" ? null : selectedTemplate);
  document.querySelector("#template-select").onchange = (e) => {
    selectedTemplate =
      templates.find((t) => t.id === e.target.value) || baseTemplate();
    try {
      storage.setItem("second-brain-template", selectedTemplate.id);
    } catch {}
    render();
    document.querySelector("#template-view").open = true;
  };
  document.querySelector("#journal").onclick = () => showJournal();
  document.querySelector("#theme").onclick = () => {
    theme = theme === "dark" ? "light" : "dark";
    try {
      storage.setItem(THEME_KEY, theme);
    } catch {
      message = "主題已切換，但無法儲存偏好。";
    }
    render();
  };
  for (const [id, n] of [
    ["prev", -1],
    ["next", 1],
  ])
    document.querySelector("#" + id).onclick = () => {
      const next = shiftDate(date, n);
      if (validDate(next)) {
        date = next;
        render();
      }
    };
  document.querySelector("#date").onchange = (e) => {
    if (validDate(e.target.value)) {
      date = e.target.value;
      render();
    }
  };
  document
    .querySelectorAll("[data-add]")
    .forEach((b) => (b.onclick = () => edit(b.dataset.add)));
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const r = data.records.find((r) => r.id === b.dataset.edit);
        edit(r.type, r);
      }),
  );
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmAction("刪除此筆紀錄及照片？無法復原。", () => {
          save(remove(data, b.dataset.delete));
          render();
          if (typeof indexedDB !== "undefined")
            deletePhoto(b.dataset.delete).catch(() => {
              message = "紀錄已刪除，照片無法移除，請檢查瀏覽器儲存設定。";
              render();
            });
        })),
  );
  document.querySelector("#export").onclick = () =>
    download(JSON.stringify(data, null, 2), "second-brain-backup.json");
  document.querySelector("#raw")?.addEventListener("click", () => {
    try {
      download(storage.getItem(STORAGE_KEY) ?? "", "second-brain-raw.txt");
    } catch {
      message = "無法讀取原始儲存內容。";
      render();
    }
  });
  document.querySelector("#import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 10000000) throw Error("檔案過大");
      const incoming = parseBackup(await file.text());
      const preview = merge(data, incoming);
      confirmAction(
        `匯入 ${incoming.records.length} 筆：新增 ${preview.added} 筆、衝突 ${preview.conflicts} 筆（保留本機版本）。相同 ID 不重複加入；不刪除或覆寫任何現有紀錄。建議先匯出備份。`,
        () => {
          const result = merge(data, incoming);
          save(result.data);
          message = `已新增 ${result.added} 筆，保留 ${result.conflicts} 筆本機衝突版本。`;
          render();
        },
      );
    } catch (err) {
      message = "匯入失敗：" + err.message;
      render();
    } finally {
      e.target.value = "";
    }
  };
}
function download(text, name) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function confirmAction(text, action) {
  const d = document.querySelector("#confirm");
  d.innerHTML = `<h2 id="confirm-title">請確認</h2><p>${esc(text)}</p><p role="alert" class="error"></p><div class="dialog-actions"><button id="no">取消</button><button id="yes">確認</button></div>`;
  d.querySelector("#no").onclick = () => d.close();
  d.querySelector("#yes").onclick = async () => {
    try {
      await action();
      if (d.isConnected && d.open) d.close();
    } catch (e) {
      d.querySelector(".error").textContent = "未儲存：" + e.message;
    }
  };
  d.showModal();
}
function templateView() {
  const journalRows = rows(data, date, "journal");
  const cards = journalSections(data, date);
  const groups = {
    overview: { types: ["journal"], titles: ["每日主題"] },
    health: {
      types: ["sleep", "activity", "sunlight"],
      titles: ["睡眠", "活動", "活動時間", "日照"],
    },
    food: {
      types: ["meal", "coffee", "water", "spending"],
      titles: ["餐點", "咖啡已飲用", "飲水", "已付款花費"],
    },
    highlight: { types: ["journal"], titles: ["今日亮點"] },
    body: { types: ["journal"], titles: ["身體狀況", "心情"] },
    todo: { types: ["journal"], titles: ["待辦事項"] },
  };
  const sections = selectedTemplate.mapping
    .map((key) => {
      if (key === "timeline") {
        const events = timeline(data, date);
        return `<details class="template-block template-wide"><summary><span class="template-label">◷ ${sectionNames[key]}</span><span class="template-snapshot">${
          events.length
            ? esc(
                events
                  .slice(0, 2)
                  .map((e) => `${e.time} ${e.label}`)
                  .join(" · "),
              )
            : "尚無資料"
        }</span></summary><div class="template-items">${events.map((e) => `<button class="template-item" data-template-event="${e.record.id}"><b>${esc(e.time)}</b> ${esc(e.label)} · ${esc(e.record.name || e.record.status)}</button>`).join("") || "<p>尚無資料</p>"}</div><button data-template-add="event" ${blocked ? "disabled" : ""}>＋ 事件</button></details>`;
      }
      const group = groups[key];
      const vals = cards.filter((c) => group.titles.includes(c.title));
      const records =
        key === "overview" ||
        key === "highlight" ||
        key === "body" ||
        key === "todo"
          ? journalRows
          : data.records.filter(
              (r) => r.date === date && group.types.includes(r.type),
            );
      const addTypes = group.types;
      return `<details class="template-block ${key === "overview" ? "template-wide" : ""}"><summary><span class="template-label">${esc(selectedTemplate.illustration)} ${sectionNames[key]}</span><span class="template-snapshot">${vals.length ? vals.map((v) => `${esc(v.title)} ${esc(v.value)}`).join(" · ") : "尚無資料"}</span></summary><p>${vals.map((v) => `<span class="template-value"><b>${esc(v.title)}</b> ${esc(v.value)}</span>`).join("") || "尚無資料"}</p><div>${records.map((r) => `<button data-template-edit="${r.id}" ${blocked ? "disabled" : ""}>編輯${esc(names[r.type])}</button>`).join(" ")} ${addTypes.map((t) => `<button data-template-add="${t}" ${blocked ? "disabled" : ""}>＋ ${esc(names[t])}</button>`).join(" ")}</div></details>`;
    })
    .join("");
  return `<section class="template-panel"><div class="template-controls"><div><small>YOUR JOURNAL</small><h2>我的小誌模板</h2></div><label>選擇模板<select id="template-select"><option value="default">生活小誌</option>${templates.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedTemplate.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label><button id="template-new">匯入小誌圖卡</button><button id="ocr-open">辨識圖卡紀錄</button><button id="template-edit">修改模板</button></div><p class="template-hint">模板使用選取日期的紀錄；圖卡辨識結果須逐筆確認後才匯入。</p><details id="template-view"><summary>展開互動小誌</summary><div class="template-sheet"><header class="template-cover"><small>PROJECT SECOND BRAIN</small><h2>${esc(date)} · 生活小誌</h2><p>${esc(
    journalRows
      .map((r) => r.theme)
      .filter(Boolean)
      .join(" / ") || "每日主題尚無資料",
  )}</p></header><div class="template-grid">${sections}</div></div></details></section>`;
}
function applyTemplateStyles(root, t) {
  root.style.setProperty("--template-bg", t.background);
  root.style.setProperty("--template-accent", t.accent);
  const rgb = t.accent.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
  root.style.setProperty(
    "--template-ink",
    (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150
      ? "#152a24"
      : "#fff",
  );
  root.style.setProperty("--template-columns", String(t.columns));
  root.style.setProperty(
    "--template-font",
    t.font === "serif" ? "Georgia, serif" : "system-ui, sans-serif",
  );
}
function templateEditor(current) {
  let working = current
    ? { ...current, mapping: [...current.mapping] }
    : { ...baseTemplate(), id: crypto.randomUUID(), name: "我的小誌模板" };
  let previewURL = null;
  const d = document.querySelector("#template-editor");
  function show() {
    d.innerHTML = `<h2>${current ? "修改模板" : "匯入小誌圖卡"}</h2><p>圖片在本機擷取色票，版面、字體與插畫請手動選擇。可以另行辨識紀錄，逐筆確認後才匯入；JSON 不含模板及原圖，請另存原檔。</p><label class="template-input">參考圖（PNG、JPG、WebP，最多 10 MB）<input id="template-image" type="file" accept="image/png,image/jpeg,image/webp"></label><img id="reference-preview" class="reference-preview" alt="原圖預覽" hidden><p id="image-info"></p><div class="palette" aria-label="偵測到的主要顏色"></div><button type="button" id="template-ocr">辨識圖卡紀錄</button><form id="template-form"><div class="template-fields"><label>模板名稱<input name="name" maxlength="80" required value="${esc(working.name)}"></label><label>底色<input type="color" name="background" value="${esc(working.background)}"></label><label>標題色<input type="color" name="accent" value="${esc(working.accent)}"></label><label>字體風格<select name="font"><option value="sans" ${working.font === "sans" ? "selected" : ""}>清晰無襯線</option><option value="serif" ${working.font === "serif" ? "selected" : ""}>雜誌襯線</option></select></label><label>卡片欄數<select name="columns"><option value="1" ${working.columns === 1 ? "selected" : ""}>單欄</option><option value="2" ${working.columns === 2 ? "selected" : ""}>雙欄</option></select></label><label>裝飾<select name="illustration">${["✳", "☀", "✦", "○", ""].map((x) => `<option value="${x}" ${working.illustration === x ? "selected" : ""}>${x || "無"}</option>`).join("")}</select></label></div><h3>確認區塊順序與對應</h3><p>依原圖的閱讀順序選擇，每個區塊各選一次。</p><div class="mapping">${working.mapping.map((k, i) => `<label>區塊 ${i + 1}<select name="slot${i}">${sectionKeys.map((x) => `<option value="${x}" ${x === k ? "selected" : ""}>${sectionNames[x]}</option>`).join("")}</select></label>`).join("")}</div><div id="draft-preview" class="draft-preview"></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" id="template-restore">還原</button>${current ? '<button type="button" id="template-delete">刪除模板</button>' : ""}<button type="button" id="template-close">取消</button><button type="submit">儲存模板</button></div></form>`;
    if (working.image) {
      previewURL = URL.createObjectURL(working.image);
      const img = d.querySelector("#reference-preview");
      img.src = previewURL;
      img.hidden = false;
    }
    const form = d.querySelector("form");
    const values = () => {
      const f = new FormData(form);
      return {
        ...working,
        name: f.get("name"),
        background: f.get("background"),
        accent: f.get("accent"),
        font: f.get("font"),
        columns: Number(f.get("columns")),
        illustration: f.get("illustration"),
        mapping: sectionKeys.map((_, i) => f.get("slot" + i)),
      };
    };
    function refresh() {
      const t = values();
      const p = d.querySelector("#draft-preview");
      p.innerHTML = `<b>${esc(t.name)}</b> · ${esc(date)}<div class="draft-grid">${t.mapping.map((k) => `<span>${esc(sectionNames[k])}</span>`).join("")}</div>`;
      applyTemplateStyles(p, t);
    }
    form.oninput = refresh;
    form.onchange = refresh;
    refresh();
    d.querySelector("#template-ocr").onclick = () => openOcr(working.image);
    d.querySelector("#template-image").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        )
          throw Error("請選擇 10 MB 以下的 PNG、JPG 或 WebP");
        const colors = await palette(file);
        working = values();
        working.image = file;
        if (previewURL) URL.revokeObjectURL(previewURL);
        previewURL = URL.createObjectURL(file);
        const img = d.querySelector("#reference-preview");
        img.src = previewURL;
        img.hidden = false;
        d.querySelector("#image-info").textContent =
          "原圖已載入。請確認色彩與區塊；儲存後才會寫入本機。";
        const pal = d.querySelector(".palette");
        pal.replaceChildren();
        colors.forEach((color) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "swatch";
          b.title = "設為底色 " + color;
          b.setAttribute("aria-label", "設底色 " + color);
          b.style.backgroundColor = color;
          b.onclick = () => {
            form.elements.background.value = color;
            refresh();
          };
          pal.append(b);
        });
      } catch (err) {
        d.querySelector(".error").textContent = "讀取圖片失敗：" + err.message;
      }
      e.target.value = "";
    };
    d.querySelector("#template-restore").onclick = () => {
      if (previewURL) URL.revokeObjectURL(previewURL);
      working = current
        ? { ...current, mapping: [...current.mapping] }
        : { ...baseTemplate(), id: working.id, name: "我的小誌模板" };
      show();
    };
    d.querySelector("#template-close").onclick = () => d.close();
    d.querySelector("#template-delete")?.addEventListener("click", () =>
      confirmAction(
        "刪除此本機模板及其參考圖片？不會刪除生活紀錄。",
        async () => {
          await deleteTemplate(current.id);
          templates = await listTemplates();
          selectedTemplate = baseTemplate();
          try {
            storage.setItem("second-brain-template", "default");
          } catch {}
          d.close();
          render();
        },
      ),
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const t = validateTemplate(values());
        await putTemplate(t);
        templates = await listTemplates();
        selectedTemplate = t;
        try {
          storage.setItem("second-brain-template", t.id);
        } catch {}
        d.close();
        render();
        document.querySelector("#template-view").open = true;
      } catch (err) {
        d.querySelector(".error").textContent = "未儲存：" + err.message;
      }
    };
  }
  d.onclose = () => {
    if (previewURL) {
      URL.revokeObjectURL(previewURL);
      previewURL = null;
    }
  };
  show();
  d.showModal();
}

function openOcr(initialFile) {
  const d = document.querySelector("#ocr-dialog");
  let candidates = [];
  let imageUrl = null;
  let running = false;
  let imported = false;
  d.innerHTML = `<h2 id="ocr-title">辨識小誌圖卡</h2><p>繁體中文在此裝置辨識，不上傳圖片。數值、餐飲及付款可能辨識錯誤；可信數據可批次選取；餐飲、付款與不明內容須確認。首次載入辨識模型可能較久。</p><label>選擇 PNG、JPG 或 WebP<input id="ocr-image" type="file" accept="image/png,image/jpeg,image/webp"></label><details class="ocr-original"><summary>查看原圖</summary><img id="ocr-preview" alt="圖卡原圖" class="reference-preview" hidden></details><p id="ocr-progress" role="status"></p><details><summary>查看辨識原文（可能有錯字）</summary><pre id="ocr-raw"></pre></details><div class="ocr-batch-tools"><button id="ocr-select-trusted" type="button">全選可信項目</button><button id="ocr-clear" type="button">全部取消</button></div><p id="ocr-totals" role="status"></p><div id="ocr-candidates"></div><p id="ocr-result" role="status"></p><button id="ocr-add-manual" type="button">＋ 手動新增候選</button><p class="error" role="alert"></p><div class="dialog-actions"><button id="ocr-cancel" type="button">取消</button><button id="ocr-commit" type="button" ${blocked ? "disabled" : ""}>一鍵確認匯入</button></div>`;
  const list = d.querySelector("#ocr-candidates"),
    error = d.querySelector(".error");
  const labels = {
    sleep: "睡眠",
    activity: "活動／步數",
    sunlight: "日照",
    meal: "餐點",
    coffee: "咖啡",
    water: "飲水",
    spending: "花費",
    event: "時間軸事件",
  };
  const fieldLabels = {
    date: "日期",
    name: "名稱",
    minutes: "分鐘",
    score: "睡眠分數",
    steps: "步數",
    volume: "容量 mL",
    amount: "金額 NT$",
    time: "事件時間",
    startTime: "開始時間",
    endTime: "結束時間",
    source: "來源",
    note: "備註",
    paymentDate: "付款日期",
    orderDate: "訂購日期",
    purchaseDate: "購買日期",
  };
  const typeFields = {
    sleep: ["minutes", "score"],
    activity: ["steps", "minutes"],
    sunlight: ["minutes", "source"],
    meal: [
      "name",
      "amount",
      "orderDate",
      "paymentDate",
      "startTime",
      "endTime",
    ],
    coffee: ["volume", "amount", "purchaseDate", "startTime", "endTime"],
    water: ["volume"],
    spending: ["amount"],
    event: ["name", "time"],
  };
  const typeOptions = Object.keys(typeFields);
  function collect(row) {
    const o = {};
    row
      .querySelectorAll("[data-field]")
      .forEach((el) => (o[el.dataset.field] = el.value));
    return o;
  }
  function fieldsHtml(c) {
    const type = c.type;
    return (
      ["date", ...typeFields[type], "note"]
        .map((k) => {
          const numeric = [
            "minutes",
            "score",
            "steps",
            "volume",
            "amount",
          ].includes(k);
          const kind =
            k === "date" || k.endsWith("Date")
              ? "date"
              : k === "time" || k.endsWith("Time")
                ? "time"
                : numeric
                  ? "number"
                  : "text";
          return `<label>${fieldLabels[k]}<input data-field="${k}" type="${kind}" ${numeric ? 'min="0" step="' + (k === "amount" ? "0.01" : "1") + '"' : ""} value="${esc(k === "source" ? (c.originSource ?? "") : (c[k] ?? ""))}"></label>`;
        })
        .join("") +
      `<label>狀態（請確認）<select data-field="status"><option value="">請選擇</option>${statuses[type].map((v) => `<option value="${esc(v)}" ${c.status === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>${type === "meal" ? `<label>付款狀態<select data-field="paid"><option value="">未確認</option><option value="yes" ${c.paid === "yes" ? "selected" : ""}>已付款</option><option value="no" ${c.paid === "no" ? "selected" : ""}>未付款</option></select></label>` : ""}${type === "coffee" ? `<label>付款方式（請確認）<select data-field="payment"><option value="">請選擇</option><option value="purchase" ${c.payment === "purchase" ? "selected" : ""}>購買</option><option value="voucher" ${c.payment === "voucher" ? "selected" : ""}>預付券</option></select></label>` : ""}`
    );
  }
  function updateConflict(row) {
    const v = collect(row),
      matches = data.records.filter(
        (r) => r.type === v.type && r.date === v.date,
      );
    const hint = row.querySelector(".ocr-conflict"),
      target = row.querySelector("[data-target]"),
      prior = target.value;
    hint.textContent = matches.length
      ? `同日同類已有 ${matches.length} 筆，請決定跳過、僅補空白或另存。`
      : "目前沒有同日同類紀錄；若多個候選相同，仍會依序檢查。";
    target.innerHTML =
      '<option value="">選擇既有紀錄</option>' +
      matches
        .map(
          (r) =>
            `<option value="${esc(r.id)}">${esc((r.name || r.note || r.status).slice(0, 60))} · ${esc(r.id.slice(0, 8))}</option>`,
        )
        .join("");
    if (matches.some((r) => r.id === prior)) target.value = prior;
  }
  function refreshRow(row) {
    const v = collect(row);
    row.querySelector(".ocr-caption strong").textContent = labels[v.type];
    row.querySelector(".ocr-caption small").textContent = [
      v.date || "日期未確認",
      v.name || "",
      v.minutes !== undefined && v.minutes !== "" ? `${v.minutes} 分鐘` : "",
      v.steps !== undefined && v.steps !== "" ? `${v.steps} 步` : "",
      v.volume !== undefined && v.volume !== "" ? `${v.volume} mL` : "",
      v.amount !== undefined && v.amount !== ""
        ? `金額 ${v.amount} 待確認`
        : "",
      v.status ||
        (["meal", "coffee", "water", "spending"].includes(v.type)
          ? "狀態未確認"
          : ""),
      v.type === "meal"
        ? v.paid === "yes"
          ? "已付款"
          : v.paid === "no"
            ? "未付款"
            : "付款未確認"
        : "",
      v.type === "coffee"
        ? v.payment === "voucher"
          ? "預付券"
          : v.payment === "purchase"
            ? "購買"
            : "付款方式未確認"
        : "",
      v.time || "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function updateTotals() {
    const all = [...list.querySelectorAll(".ocr-row")];
    const selected = all.filter(
      (r) => r.querySelector("[data-select]").checked,
    ).length;
    const skipped = all.filter(
      (r) =>
        !r.querySelector("[data-select]").checked &&
        r.dataset.conflict === "true",
    ).length;
    const pending = all.length - selected - skipped;
    d.querySelector("#ocr-totals").textContent =
      `共 ${all.length} 筆 · 已選 ${selected} · 預設跳過 ${skipped} · 待處理 ${pending}`;
  }
  function draw() {
    const sectionFor = (c) =>
      c.duplicate ? "duplicate" : c.recommended ? "trusted" : "pending";
    const short = (c) =>
      [
        c.date || "日期未確認",
        c.name || "",
        c.minutes != null ? `${c.minutes} 分鐘` : "",
        c.steps != null ? `${c.steps} 步` : "",
        c.volume != null ? `${c.volume} mL` : "",
        c.amount != null ? `金額 ${c.amount} 待確認` : "",
        c.time || "",
        c.status ||
          (c.type === "meal" ||
          c.type === "coffee" ||
          c.type === "water" ||
          c.type === "spending"
            ? "狀態未確認"
            : ""),
        c.type === "meal"
          ? c.paid === "yes"
            ? "已付款"
            : c.paid === "no"
              ? "未付款"
              : "付款未確認"
          : "",
        c.type === "coffee"
          ? c.payment === "voucher"
            ? "預付券"
            : c.payment === "purchase"
              ? "購買"
              : "付款方式未確認"
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    list.innerHTML = ["trusted", "pending", "duplicate"]
      .map((section) => {
        const entries = candidates
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => sectionFor(c) === section);
        if (!entries.length) return "";
        const titles = {
          trusted: "可信數據",
          pending: "需要確認",
          duplicate: "可能重複或衝突（預設跳過）",
        };
        return (
          `<h3 class="ocr-group">${titles[section]} · ${entries.length}</h3>` +
          entries
            .map(
              ({ c, i }) =>
                `<section class="ocr-row" data-index="${i}" data-trusted="${!!c.recommended}" data-conflict="${!!c.duplicate}"><div class="ocr-row-head"><label><input type="checkbox" data-select ${c.checked ? "checked" : ""}> <span class="ocr-caption"><strong>${labels[c.type]}</strong><small>${esc(short(c))}</small></span></label><span class="ocr-badge">${esc(c.duplicate ? "可能重複" : c.reason || "待確認")}</span></div><details class="ocr-details"><summary>查看或修改</summary><label>紀錄類型<select data-field="type">${typeOptions.map((t) => `<option value="${t}" ${c.type === t ? "selected" : ""}>${labels[t]}</option>`).join("")}</select></label><p>原文線索：${esc(c.source || "手動新增")}</p><div class="ocr-fields">${fieldsHtml(c)}</div><p class="ocr-conflict"></p><label>衝突處理<select data-action><option value="skip">有同日同類就跳過</option><option value="merge">只補既有紀錄的空白欄位</option><option value="add">仍另存一筆（可能重複）</option></select></label><label>合併目標<select data-target><option value="">選擇既有紀錄</option></select></label><p class="ocr-row-error" role="alert"></p></details></section>`,
            )
            .join("")
        );
      })
      .join("");
    list.querySelectorAll(".ocr-row").forEach((row) => {
      updateConflict(row);
      row.querySelector("[data-field=type]").onchange = () => {
        const old = collect(row);
        const i = Number(row.dataset.index);
        candidates[i] = { ...candidates[i], ...old, recommended: false };
        row.querySelector(".ocr-fields").innerHTML = fieldsHtml(candidates[i]);
        updateConflict(row);
        refreshRow(row);
      };
      row.addEventListener("input", (e) => {
        if (
          e.target.matches("[data-field]") &&
          row.dataset.trusted === "true"
        ) {
          row.dataset.trusted = "false";
          row.querySelector("[data-select]").checked = false;
          row.querySelector(".ocr-badge").textContent = "已修改，請確認";
        }
        if (e.target.matches("[data-field]")) refreshRow(row);
        updateTotals();
      });
      row.addEventListener("change", (e) => {
        if (e.target.matches("[data-field=date], [data-field=type]")) {
          updateConflict(row);
          const v = collect(row);
          row.dataset.conflict = String(
            data.records.some((r) => r.type === v.type && r.date === v.date),
          );
        }
        if (e.target.matches("[data-field]")) refreshRow(row);
        updateTotals();
      });
    });
    updateTotals();
  }

  async function run(file) {
    if (!file || running) return;
    running = true;
    candidates = [];
    draw();
    error.textContent = "";
    d.querySelector("#ocr-progress").textContent = "準備本機辨識…";
    try {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(file);
      const image = d.querySelector("#ocr-preview");
      image.src = imageUrl;
      image.hidden = false;
      const result = await recognizeCard(file, (status, p) => {
        if (d.isConnected)
          d.querySelector("#ocr-progress").textContent =
            `${status} ${Math.round((p || 0) * 100)}%`;
      });
      if (!d.isConnected) return;
      const seen = new Set();
      candidates = result.candidates.map((c) => {
        const key = c.type + ":" + c.date;
        const exists = data.records.some(
          (r) => r.type === c.type && r.date === c.date,
        );
        const duplicate = exists || (c.recommended && seen.has(key));
        if (c.recommended) seen.add(key);
        return {
          ...c,
          duplicate,
          checked: Boolean(c.recommended && !duplicate),
        };
      });
      d.querySelector("#ocr-raw").textContent = [
        result.raw.whole,
        ...Object.entries(result.raw)
          .filter(([k]) => k !== "whole" && k !== "confidences")
          .map(([k, v]) => `[${k}] ${v}`),
      ].join("\n");
      d.querySelector("#ocr-progress").textContent =
        `辨識完成：${candidates.length} 筆候選。可信項目已預選，請確認摘要；其他項目可展開修改。`;
      draw();
    } catch (e) {
      if (d.isConnected) {
        error.textContent =
          "無法完成辨識：" + e.message + "。你仍可手動新增候選。";
        d.querySelector("#ocr-progress").textContent = "";
      }
    } finally {
      running = false;
    }
  }
  d.querySelector("#ocr-image").onchange = (e) => run(e.target.files[0]);
  d.querySelector("#ocr-add-manual").onclick = () => {
    const oldRows = [...list.querySelectorAll(".ocr-row")];
    const state = oldRows.map((row) => ({
      checked: row.querySelector("[data-select]").checked,
      action: row.querySelector("[data-action]").value,
      target: row.querySelector("[data-target]").value,
    }));
    const current = oldRows.map((row) => ({
      ...candidates[Number(row.dataset.index)],
      ...collect(row),
      checked: row.querySelector("[data-select]").checked,
    }));
    candidates = [...current, { type: "event", date: "", source: "手動新增" }];
    draw();
    list.querySelectorAll(".ocr-row").forEach((row, i) => {
      if (state[i]) {
        row.querySelector("[data-select]").checked = state[i].checked;
        row.querySelector("[data-action]").value = state[i].action;
        row.querySelector("[data-target]").value = state[i].target;
      }
    });
  };
  d.querySelector("#ocr-select-trusted").onclick = () => {
    list.querySelectorAll(".ocr-row").forEach((row) => {
      row.querySelector("[data-select]").checked =
        row.dataset.trusted === "true" && row.dataset.conflict !== "true";
    });
    updateTotals();
  };
  d.querySelector("#ocr-clear").onclick = () => {
    list
      .querySelectorAll("[data-select]")
      .forEach((box) => (box.checked = false));
    updateTotals();
  };
  d.querySelector("#ocr-cancel").onclick = () => d.close();
  d.querySelector("#ocr-commit").onclick = () => {
    try {
      if (running) throw Error("請等辨識完成");
      const rows = [...list.querySelectorAll(".ocr-row")],
        selected = rows.filter((r) => r.querySelector("[data-select]").checked);
      const items = [];
      let invalid = 0;
      for (const row of selected) {
        const item = {
          id: crypto.randomUUID(),
          values: collect(row),
          action: row.querySelector("[data-action]").value,
          target: row.querySelector("[data-target]").value,
        };
        try {
          candidateRecord(item.values, item.id);
          row.querySelector(".ocr-row-error").textContent = "";
          items.push(item);
        } catch (err) {
          invalid++;
          row.querySelector(".ocr-row-error").textContent =
            "待確認：" + err.message;
          row.querySelector(".ocr-details").open = true;
          row.querySelector("[data-select]").checked = false;
        }
      }
      updateTotals();
      const existingSkips = rows.filter((row) => {
        const v = collect(row);
        return (
          !row.querySelector("[data-select]").checked &&
          data.records.some((r) => r.type === v.type && r.date === v.date)
        );
      }).length;
      if (!items.length && (invalid || !existingSkips))
        throw Error(
          invalid ? "選取項目尚需確認，請展開修正" : "請先選取可信或已確認項目",
        );
      const preview = planCandidates(data, items);
      const unselected = rows.filter(
        (r) => !r.querySelector("[data-select]").checked,
      );
      const automaticSkipped = unselected.filter((row) => {
        const v = collect(row);
        return preview.data.records.some(
          (r) => r.type === v.type && r.date === v.date,
        );
      }).length;
      const skipped = preview.skipped + automaticSkipped;
      const pending = unselected.length - automaticSkipped;
      confirmAction(
        `匯入總覽：成功 ${preview.added + preview.merged} 筆（新增 ${preview.added}、補空白 ${preview.merged}），跳過 ${skipped} 筆，待處理 ${pending} 筆。確認後才會寫入；未處理的候選只保留在這個視窗，關閉後需重新辨識。`,
        () => {
          const next = planCandidates(data, items);
          const successful = next.added + next.merged;
          if (successful) {
            save(next.data);
            imported = true;
          }
          d.querySelector("#ocr-result").textContent =
            `已匯入 ${successful} 筆，跳過 ${next.skipped + automaticSkipped} 筆，待處理 ${pending} 筆。`;
          for (const row of selected) {
            if (!row.querySelector("[data-select]").checked) continue;
            row.remove();
          }
          list.querySelectorAll(".ocr-row").forEach((row) => {
            updateConflict(row);
            const v = collect(row);
            row.dataset.conflict = String(
              data.records.some((r) => r.type === v.type && r.date === v.date),
            );
            if (row.dataset.conflict === "true") {
              row.dataset.trusted = "false";
              row.querySelector("[data-select]").checked = false;
              row.querySelector(".ocr-badge").textContent =
                "可能重複，預設跳過";
            }
          });
          updateTotals();
        },
      );
    } catch (err) {
      error.textContent = "尚未匯入：" + err.message;
    }
  };

  d.onclose = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (imported) render();
  };
  d.showModal();
  if (initialFile) run(initialFile);
}

function showJournal() {
  const d = document.querySelector("#journal-dialog");
  d.innerHTML =
    '<h2>今日小誌預覽</h2><p>以目前選取日期的紀錄產生。照片不會自動加入圖卡。</p><canvas id="journal-canvas" aria-label="每日小誌預覽"></canvas><p class="error" role="alert"></p><div class="dialog-actions"><button id="journal-close">關閉</button><button id="journal-download">匯出 PNG</button></div>';
  const canvas = d.querySelector("canvas");
  drawTemplateJournal(canvas, data, date, selectedTemplate);
  d.querySelector("#journal-close").onclick = () => d.close();
  d.querySelector("#journal-download").onclick = () =>
    canvas.toBlob((blob) => {
      if (!blob) {
        d.querySelector(".error").textContent = "圖片產生失敗";
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `second-brain-${date}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  d.showModal();
}
function showEvent(id) {
  const r = data.records.find((r) => r.id === id);
  if (!r) return;
  const d = document.querySelector("#event-detail");
  d.innerHTML = `<h2>${esc(names[r.type])} · 事件詳情</h2><p>${esc(detail(r))}</p><img class="detail-photo" hidden alt="事件照片"><p class="photo-info">照片只存在此瀏覽器，JSON 備份不含照片；請保留原檔。</p><label class="photo-upload">加入或更換照片<input type="file" accept="image/png,image/jpeg,image/webp" id="photo-input"></label><p class="error" role="alert"></p><div class="dialog-actions"><button id="remove-photo">移除照片</button><button id="detail-edit">編輯紀錄</button><button id="detail-delete">刪除紀錄</button><button id="detail-close">關閉</button></div>`;
  const img = d.querySelector("img"),
    error = d.querySelector(".error");
  async function refresh() {
    try {
      const blob = await getPhoto(id);
      if (!d.isConnected) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        photoUrls.push(url);
        img.src = url;
        img.hidden = false;
      } else img.hidden = true;
    } catch {
      error.textContent = "無法讀取照片，紀錄不受影響。";
    }
  }
  if (typeof indexedDB === "undefined") {
    error.textContent = "此瀏覽器無法使用照片儲存。";
    d.querySelector("#photo-input").disabled = true;
    d.querySelector("#remove-photo").disabled = true;
  } else refresh();
  d.querySelector("#photo-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw Error("請選擇 10 MB 以下的 PNG、JPEG 或 WebP");
      await putPhoto(id, file);
      error.textContent = "照片已存於此瀏覽器。";
      await refresh();
      document.querySelectorAll("[data-photo]").forEach((img) => {
        if (img.dataset.photo === id) {
          const url = URL.createObjectURL(file);
          photoUrls.push(url);
          img.src = url;
          img.hidden = false;
        }
      });
    } catch (err) {
      error.textContent = "照片未儲存：" + err.message;
    }
    e.target.value = "";
  };
  d.querySelector("#remove-photo").onclick = () =>
    confirmAction("移除此事件的照片？請確認已保留原檔。", async () => {
      await deletePhoto(id);
      d.close();
      render();
    });
  d.querySelector("#detail-delete").onclick = () =>
    confirmAction("刪除此筆紀錄與其照片？無法復原。", async () => {
      save(remove(data, id));
      try {
        await deletePhoto(id);
      } catch {
        message = "紀錄已刪除，照片無法移除，請檢查瀏覽器儲存設定。";
      }
      render();
    });
  d.querySelector("#detail-edit").onclick = () => {
    d.close();
    edit(r.type, r);
  };
  d.querySelector("#detail-close").onclick = () => d.close();
  d.showModal();
}
function edit(type, record) {
  const r = record ?? {
    id: crypto.randomUUID(),
    date,
    type,
    status: statuses[type][0],
    note: "",
    time: "",
    ...Object.fromEntries(Object.keys(fields[type]).map((k) => [k, null])),
    ...(type === "coffee"
      ? { payment: "purchase", purchaseDate: null, startTime: "", endTime: "" }
      : {}),
    ...(type === "event" ? { name: "" } : {}),
    ...(type === "journal"
      ? { theme: "", highlight: "", wellbeing: "", mood: "", todo: "" }
      : {}),
    ...(type === "meal"
      ? {
          name: "",
          paid: null,
          paymentDate: null,
          orderDate: null,
          startTime: "",
          endTime: "",
        }
      : {}),
    ...(type === "sunlight" ? { source: "" } : {}),
  };
  const d = document.querySelector("#editor");
  d.innerHTML = `<form id="edit-form"><h2 id="dialog-title">${record ? "編輯" : "新增"}${names[type]}</h2><p>${r.date} · 空白代表未知。餐點紀錄不代表已食用；只有「吃完」才算完整食用。${type === "coffee" ? "兌換券請勿填金額；飲用中不計入已飲用量。購買日與飲用紀錄日分開計算。" : ""}</p><div id="form-fields"><label>${type === "meal" ? "預定／實際用餐日期" : "紀錄日期"}<input name="date" type="date" value="${r.date}" required></label>${type === "journal" ? ["theme", "highlight", "wellbeing", "mood", "todo"].map((key, i) => `<label>${["每日主題", "今日亮點", "身體狀況", "心情", "待辦事項"][i]}<textarea name="${key}" maxlength="500">${esc(r[key])}</textarea></label>`).join("") : ""}${type === "event" ? `<label>事件名稱<input name="name" maxlength="100" required value="${esc(r.name)}"></label>` : ""}${type === "coffee" ? `<label>開始飲用<input name="startTime" type="time" value="${r.startTime ?? ""}"></label><label>結束飲用<input name="endTime" type="time" value="${r.endTime ?? ""}"></label>` : ""}${type === "meal" ? `<label>訂購日期（未知留空）<input name="orderDate" type="date" value="${r.orderDate ?? ""}"></label><label>餐點名稱<input name="name" maxlength="100" required value="${esc(r.name)}"></label><label>付款狀態<select name="paid"><option value="unknown" ${r.paid === null ? "selected" : ""}>未確認</option><option value="yes" ${r.paid === true ? "selected" : ""}>已付款</option><option value="no" ${r.paid === false ? "selected" : ""}>未付款</option></select></label><label>實際付款日期<input type="date" name="paymentDate" value="${r.paymentDate ?? ""}"></label><label>開始用餐<input type="time" name="startTime" value="${r.startTime}"></label><label>結束用餐<input type="time" name="endTime" value="${r.endTime}"></label>` : ""}${type === "sunlight" ? `<label>來源（如 Apple Watch）<input name="source" maxlength="100" value="${esc(r.source)}"></label>` : ""}${type === "coffee" ? `<label>實際購買日期（未知留空）<input name="purchaseDate" type="date" value="${r.purchaseDate === undefined ? r.date : (r.purchaseDate ?? "")}"></label>` : ""}${Object.entries(
    fields[type],
  )
    .map(
      ([k, max]) =>
        `<label>${labels[k]}<input name="${k}" type="number" min="0" max="${max}" step="${k === "amount" ? "0.01" : "1"}" value="${r[k] ?? ""}"></label>`,
    )
    .join(
      "",
    )}${type === "meal" ? "" : `<label>時間<input type="time" name="time" value="${r.time}"></label>`}<label>狀態<select name="status">${statuses[type].map((s) => `<option ${r.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${type === "coffee" ? `<label>付款方式<select name="payment"><option value="purchase" ${r.payment === "purchase" ? "selected" : ""}>購買</option><option value="voucher" ${r.payment === "voucher" ? "selected" : ""}>兌換券（不重複記帳）</option></select></label>` : ""}<label>說明<input name="note" maxlength="500" value="${esc(r.note)}"></label></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" id="cancel">取消</button><button class="save">儲存</button></div></form>`;
  d.querySelector("#cancel").onclick = () => d.close();
  d.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(e.target));
      for (const k of Object.keys(fields[type]))
        values[k] = values[k].trim() === "" ? null : Number(values[k]);
      if (type === "meal") {
        values.paid =
          values.paid === "yes" ? true : values.paid === "no" ? false : null;
        values.paymentDate = values.paymentDate || null;
        values.orderDate = values.orderDate || null;
      }
      if (type === "coffee") values.purchaseDate = values.purchaseDate || null;
      save(upsert(data, { ...r, ...values }));
      d.close();
      render();
    } catch (err) {
      d.querySelector(".error").textContent = "未儲存：" + err.message;
    }
  };
  d.showModal();
}
render();
if (typeof indexedDB !== "undefined")
  listTemplates()
    .then((items) => {
      templates = items;
      let id;
      try {
        id = storage.getItem("second-brain-template");
      } catch {}
      selectedTemplate = templates.find((t) => t.id === id) || baseTemplate();
      if (templates.length && !document.querySelector("dialog[open]")) render();
    })
    .catch(() => {});
