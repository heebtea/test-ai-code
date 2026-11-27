import { canonical } from "./backup.js";
import { recordImportCounts, revisionHint } from "./record-import.js";

const labels = {
  date: "紀錄日期", type: "類別", time: "紀錄時間", name: "名稱",
  startTime: "開始時間", endTime: "結束時間", orderDate: "訂購日",
  purchaseDate: "實際購買日", paymentDate: "付款／入帳日",
  volume: "記錄量（mL）", capacity: "容器容量（mL）", amount: "金額（NT$）",
  paid: "付款狀態", payment: "付款方式", status: "攝取／紀錄狀態",
  quantity: "總份量", consumedQuantity: "本人攝取", familyQuantity: "家人份量",
  remainingQuantity: "剩餘量", unit: "份量單位", transactionKind: "交易種類",
  provenance: "資料來源", source: "來源細節", updatedAt: "最後修改時間",
  correctedAt: "最後補正時間", note: "備註", minutes: "分鐘", steps: "步數",
  score: "分數", deep: "深睡", rem: "REM", core: "核心睡眠", awake: "清醒",
  segments: "睡眠分段", orderStatus: "訂購狀態", mealType: "餐別",
  theme: "小誌主題", highlight: "亮點", wellbeing: "身體狀況", mood: "心情",
  todo: "待辦", classification: "草稿類別", payload: "草稿內容",
};

function display(key, value, names) {
  if (value === undefined) return "未提供";
  if (value === null) return "未知";
  if (value === "") return "空白";
  if (key === "paid") return value ? "已付款" : "未付款";
  if (key === "type") return names[value] ?? value;
  if (key === "payment") return value === "voucher" ? "兌換券" : "購買";
  if (key === "transactionKind") return { purchase: "購買", refund: "退款", reimbursement: "回補" }[value];
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

export function showRecordImport(dialog, preview, names, esc, apply) {
  const rows = preview.rows.filter((row) => !["new", "same"].includes(row.state));
  const conflicts = rows.filter((row) => row.state === "conflict");
  dialog.innerHTML = `<h2 id="confirm-title">JSON 補正匯入預覽</h2>
    <p>同一 ID 保留為一筆紀錄。修改與補正時間供比對，請按內容決定。</p>
    ${conflicts.length ? `<label class="record-import-mode">相同 ID 的處理方式<select id="import-mode">
      <option value="local">保留現有紀錄</option><option value="incoming">採用匯入的補正紀錄</option>
      <option value="review">逐筆比較後決定</option></select></label>` : ""}
    <p id="import-counts" role="status"></p>
    ${preview.errors.length ? `<details><summary>驗證失敗明細（這些紀錄會排除）</summary><ul>${preview.errors.map(({id, reason}) => `<li>${esc(id)} · ${esc(reason)}</li>`).join("")}</ul></details>` : ""}
    <div class="record-review-rows">${rows.map((row, i) => {
      const title = `${row.record.date} · ${names[row.record.type]} · ${row.id}`;
      if (row.state === "deleted") return `<p>略過已刪除的紀錄 · ${esc(title)}。需要救回時請使用當日復原或還原備份。</p>`;
      if (row.state === "category") return `<p>異常衝突 · ${esc(row.id)} 的類別由 ${esc(names[row.before.type])} 變成 ${esc(names[row.record.type])}，已略過。</p>`;
      const keys = new Set([...Object.keys(row.before), ...Object.keys(row.after)]);
      keys.delete("id");
      const changed = (key) => canonical(row.before[key]) !== canonical(row.after[key]);
      const orderedKeys = [...keys].sort((a, b) => Number(changed(b)) - Number(changed(a)));
      return `<section class="record-review-item" data-review-row="${i}">
        <p class="record-review-title">${esc(title)}</p>
        <label class="record-row-choice" hidden>這筆紀錄<select data-import-choice="${i}">
          <option value="">請選擇</option><option value="local">保留現有紀錄</option>
          <option value="incoming">採用匯入補正</option></select></label>
        <details><summary>比較現有與匯入欄位</summary>
        <p>${revisionHint(row.before, row.record)}。匯入檔省略的選填欄位會保留現有值。</p>
        <table class="record-review-table"><thead><tr><th scope="col">欄位</th><th scope="col">現有</th><th scope="col">匯入後</th></tr></thead><tbody>
        ${orderedKeys.map((key) => {
          const before = display(key, row.before[key], names), after = display(key, row.after[key], names);
          return `<tr${changed(key) ? ' class="record-field-changed"' : ""}><th scope="row">${esc(labels[key] || key)}</th><td>${esc(before)}</td><td>${esc(after)}${Object.hasOwn(row.record, key) ? "" : "（保留）"}</td></tr>`;
        }).join("")}</tbody></table></details></section>`;
    }).join("")}</div>
    <p class="error" role="alert"></p><div class="dialog-actions"><button id="no">取消</button><button id="yes">確認匯入</button></div>`;

  const yes = dialog.querySelector("#yes"), no = dialog.querySelector("#no");
  const mode = dialog.querySelector("#import-mode");
  const selectors = [...dialog.querySelectorAll("[data-import-choice]")];
  const choices = () => new Map(selectors.map((select) => [
    rows[Number(select.dataset.importChoice)].id,
    mode.value === "review" ? select.value : mode.value,
  ]));
  const update = () => {
    const counts = recordImportCounts(preview, choices());
    const reviewing = mode?.value === "review";
    const waiting = reviewing ? selectors.filter((select) => !select.value).length : 0;
    selectors.forEach((select) => { select.parentElement.hidden = !reviewing; });
    dialog.querySelector("#import-counts").textContent =
      `新增 ${counts.added} 筆 · 更新 ${counts.updated} 筆 · 完全相同 ${counts.same} 筆 · 衝突 ${counts.conflicts} 筆 · 略過 ${counts.skipped} 筆 · 驗證失敗 ${counts.invalid} 筆${waiting ? ` · ${waiting} 筆待決定` : ""}`;
    yes.disabled = waiting > 0;
  };
  mode?.addEventListener("change", () => {
    if (mode.value === "review") selectors[0]?.closest("section").querySelector("details").setAttribute("open", "");
    update();
  });
  selectors.forEach((select) => select.addEventListener("change", update));
  no.onclick = () => dialog.close();
  yes.onclick = async () => {
    yes.disabled = no.disabled = true;
    if (mode) mode.disabled = true;
    selectors.forEach((select) => { select.disabled = true; });
    const preventCancel = (event) => event.preventDefault();
    dialog.addEventListener("cancel", preventCancel);
    try {
      await apply(choices());
      if (dialog.open) dialog.close();
    } catch (error) {
      dialog.querySelector(".error").textContent = "匯入失敗，紀錄未更新：" + error.message;
    } finally {
      dialog.removeEventListener("cancel", preventCancel);
      selectors.forEach((select) => { select.disabled = false; });
      no.disabled = false;
      if (mode) mode.disabled = false;
      update();
    }
  };
  update();
  dialog.showModal();
}
