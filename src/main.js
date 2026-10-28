import "./style.css";
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
    r.status,
    r.time,
    ...Object.keys(fields[r.type]).map((k) => `${labels[k]}：${fmt(r[k])}`),
    r.type === "coffee"
      ? r.payment === "voucher"
        ? "兌換券（不計支出）"
        : "購買（計入支出）"
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
  document.documentElement.dataset.theme = theme;
  app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">✳ SECOND BRAIN LITE v0.2</div><button id="theme" class="theme-toggle">${theme === "dark" ? "淺色" : "深色"}模式</button></header><main><div class="intro"><div><h1>生活，一筆一筆記錄。</h1><p>真實紀錄版 · 空白開始，由你確認。</p></div></div><div class="notice">資料僅存在此瀏覽器 localStorage，不會上傳或同步。清除瀏覽器資料前請匯出備份；備份含個人資料，請自行妥善保管。</div><p id="message" role="status">${esc(message)}</p><div class="toolbar"><button id="export">匯出 JSON 備份</button><label class="file-button">匯入 JSON 備份<input id="import" type="file" accept="application/json,.json" ${blocked ? "disabled" : ""}></label>${blocked ? '<button id="raw">匯出原始儲存內容</button>' : ""}</div><div class="section-heading"><h2>每日總覽</h2><div class="date-nav"><button id="prev" aria-label="前一天">‹</button><input id="date" type="date" min="1900-01-01" max="2199-12-31" value="${date}" aria-label="選擇日期"><button id="next" aria-label="後一天">›</button></div></div><div class="dashboard">${types
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
      if (type === "spending")
        summary = total(expenses(data, date), "amount", "NT$");
      return `<section class="card ${type}"><div class="card-head"><h2>${names[type]}</h2><button data-add="${type}" ${blocked ? "disabled" : ""}>新增</button></div><div class="metric">${summary}</div>${type === "spending" ? "<p>已付款支出＋購買咖啡逐筆加總。咖啡勿再新增至花費；兌換券只在購券時記一次花費。</p>" : ""}${
        type === "activity"
          ? `<p>已完成時間：${total(
              rs.filter((r) => r.status === "已完成"),
              "minutes",
              "分鐘",
            )}</p>`
          : ""
      }<ul>${rs.map((r) => `<li><p>${esc(detail(r))}</p><button data-edit="${r.id}" ${blocked ? "disabled" : ""}>編輯</button><button data-delete="${r.id}" ${blocked ? "disabled" : ""}>刪除</button></li>`).join("")}</ul>${rs.length ? "" : "<p>尚無資料</p>"}</section>`;
    })
    .join(
      "",
    )}</div><p class="footer">睡眠以起床日期記錄；活動請記錄不重疊的區段。空白數值代表未知，只有明確輸入 0 才是零。</p></main></div><dialog id="editor" aria-labelledby="dialog-title"></dialog><dialog id="confirm" aria-labelledby="confirm-title"></dialog>`;
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
        confirmAction("刪除此筆紀錄？無法復原。", () => {
          save(remove(data, b.dataset.delete));
          render();
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
  d.querySelector("#yes").onclick = () => {
    try {
      action();
      d.close();
    } catch (e) {
      d.querySelector(".error").textContent = "未儲存：" + e.message;
    }
  };
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
    ...(type === "coffee" ? { payment: "purchase" } : {}),
  };
  const d = document.querySelector("#editor");
  d.innerHTML = `<form id="edit-form"><h2 id="dialog-title">${record ? "編輯" : "新增"}${names[type]}</h2><p>${date} · 空白代表未知。${type === "coffee" ? "兌換券請勿填金額；飲用中不計入已飲用量。" : ""}</p><div id="form-fields">${Object.entries(
    fields[type],
  )
    .map(
      ([k, max]) =>
        `<label>${labels[k]}<input name="${k}" type="number" min="0" max="${max}" step="${k === "amount" ? "0.01" : "1"}" value="${r[k] ?? ""}"></label>`,
    )
    .join(
      "",
    )}<label>時間<input type="time" name="time" value="${r.time}"></label><label>狀態<select name="status">${statuses[type].map((s) => `<option ${r.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${type === "coffee" ? `<label>付款方式<select name="payment"><option value="purchase" ${r.payment === "purchase" ? "selected" : ""}>購買</option><option value="voucher" ${r.payment === "voucher" ? "selected" : ""}>兌換券（不重複記帳）</option></select></label>` : ""}<label>說明<input name="note" maxlength="500" value="${esc(r.note)}"></label></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" id="cancel">取消</button><button class="save">儲存</button></div></form>`;
  d.querySelector("#cancel").onclick = () => d.close();
  d.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(e.target));
      for (const k of Object.keys(fields[type]))
        values[k] = values[k].trim() === "" ? null : Number(values[k]);
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
