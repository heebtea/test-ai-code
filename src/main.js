import "./style.css";
import { timeline, drawJournal } from "./journal.js";
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
  app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">✳ SECOND BRAIN LITE v0.4</div><button id="theme" class="theme-toggle">${theme === "dark" ? "淺色" : "深色"}模式</button></header><main><div class="intro"><div><h1>Project Second Brain</h1><p>生活小誌 · 留下今天的一點線索。</p></div></div><div class="notice">紀錄與照片只存於此瀏覽器，不上傳或同步。JSON 不含照片，請另外保留照片原檔。</div><p id="message" role="status">${esc(message)}</p><div class="toolbar"><button id="export">匯出 JSON 備份</button><label class="file-button">匯入 JSON 備份<input id="import" type="file" accept="application/json,.json" ${blocked ? "disabled" : ""}></label>${blocked ? '<button id="raw">匯出原始儲存內容</button>' : ""}</div><div class="section-heading"><h2>每日總覽</h2><div class="date-nav"><button id="prev" aria-label="前一天">‹</button><input id="date" type="date" min="1900-01-01" max="2199-12-31" value="${date}" aria-label="選擇日期"><button id="next" aria-label="後一天">›</button></div></div><div class="dashboard">${types
    .filter((type) => type !== "event")
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
  }</ul><button data-add="event" ${blocked ? "disabled" : ""}>＋ 新增重要事件</button></details><section class="journal-banner"><div><small>THE DAILY EDIT</small><h2>把今天，收進小誌裡。</h2><p>用已記錄的片段，留下一張屬於今天的直式小誌。</p></div><button id="journal">產生今日小誌</button></section><p class="footer">睡眠以起床日期記錄；活動請記錄不重疊的區段。空白數值代表未知，只有明確輸入 0 才是零。</p></main></div><dialog id="editor" aria-labelledby="dialog-title"></dialog><dialog id="confirm" aria-labelledby="confirm-title"></dialog><dialog id="event-detail"></dialog><dialog id="journal-dialog"></dialog>`;
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
function showJournal() {
  const d = document.querySelector("#journal-dialog");
  d.innerHTML =
    '<h2>今日小誌預覽</h2><p>以目前選取日期的紀錄產生。照片不會自動加入圖卡。</p><canvas id="journal-canvas" aria-label="每日小誌預覽"></canvas><p class="error" role="alert"></p><div class="dialog-actions"><button id="journal-close">關閉</button><button id="journal-download">匯出 PNG</button></div>';
  const canvas = d.querySelector("canvas");
  drawJournal(canvas, data, date);
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
  d.innerHTML = `<form id="edit-form"><h2 id="dialog-title">${record ? "編輯" : "新增"}${names[type]}</h2><p>${r.date} · 空白代表未知。餐點紀錄不代表已食用；只有「吃完」才算完整食用。${type === "coffee" ? "兌換券請勿填金額；飲用中不計入已飲用量。購買日與飲用紀錄日分開計算。" : ""}</p><div id="form-fields"><label>${type === "meal" ? "預定／實際用餐日期" : "紀錄日期"}<input name="date" type="date" value="${r.date}" required></label>${type === "event" ? `<label>事件名稱<input name="name" maxlength="100" required value="${esc(r.name)}"></label>` : ""}${type === "coffee" ? `<label>開始飲用<input name="startTime" type="time" value="${r.startTime ?? ""}"></label><label>結束飲用<input name="endTime" type="time" value="${r.endTime ?? ""}"></label>` : ""}${type === "meal" ? `<label>訂購日期（未知留空）<input name="orderDate" type="date" value="${r.orderDate ?? ""}"></label><label>餐點名稱<input name="name" maxlength="100" required value="${esc(r.name)}"></label><label>付款狀態<select name="paid"><option value="unknown" ${r.paid === null ? "selected" : ""}>未確認</option><option value="yes" ${r.paid === true ? "selected" : ""}>已付款</option><option value="no" ${r.paid === false ? "selected" : ""}>未付款</option></select></label><label>實際付款日期<input type="date" name="paymentDate" value="${r.paymentDate ?? ""}"></label><label>開始用餐<input type="time" name="startTime" value="${r.startTime}"></label><label>結束用餐<input type="time" name="endTime" value="${r.endTime}"></label>` : ""}${type === "sunlight" ? `<label>來源（如 Apple Watch）<input name="source" maxlength="100" value="${esc(r.source)}"></label>` : ""}${type === "coffee" ? `<label>實際購買日期（未知留空）<input name="purchaseDate" type="date" value="${r.purchaseDate === undefined ? r.date : (r.purchaseDate ?? "")}"></label>` : ""}${Object.entries(
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
