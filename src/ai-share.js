import { validDate, shiftDate, localDate, isPaid, transactionDate } from './data.js';

/**
 * User-initiated, date-scoped AI snapshot sharing.
 * This module never sends data over the network or writes to localStorage.
 * A selected snapshot can be copied, downloaded, or passed to the OS share sheet.
 */
export const SHARE_TYPES = Object.freeze({
  sleep: "睡眠",
  coffee: "咖啡",
  water: "白開水",
  beverage: "其他飲品",
  meal: "餐點",
  activity: "活動",
  sunlight: "日照",
  spending: "花費",
  event: "重要事件",
  journal: "日誌／心情",
});

export const DEFAULT_SHARE_TYPES = Object.freeze([
  "sleep", "coffee", "water", "beverage", "meal",
  "activity", "sunlight", "spending",
]);

// Free-text fields and nested objects are excluded unless explicitly projected.
const recordKeys = [
  'id', 'date', 'type', 'status', 'time', 'minutes', 'deep', 'rem', 'core',
  'awake', 'score', 'volume', 'capacity', 'startTime', 'endTime', 'steps',
  'quantity', 'consumedQuantity', 'remainingQuantity', 'familyQuantity',
  'mealType', 'orderStatus', 'orderDate',
];
const paymentKeys = ['paid', 'payment', 'purchaseDate', 'paymentDate', 'transactionKind'];
const textKeys = ['name', 'note', 'provenance', 'source', 'theme', 'highlight', 'wellbeing', 'mood', 'todo'];
const safeUnits = ['個', '份', '杯', '瓶', '碗', '盤', '盒', '顆', '片', '根', 'mL', 'g'];
const moneyTypes = new Set(['spending', 'meal', 'beverage', 'coffee']);
const pick = (record, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(record, k)).map(k => [k, record[k]]));

function sourceKind(record) {
  const source = record.provenance?.trim() || record.source?.trim();
  if (!source) return null;
  if (['手動輸入', '手動新增'].includes(source)) return 'manual';
  if (source === 'Apple Watch') return 'apple-watch';
  if (source === 'OCR 手動候選' || /^\[[^\]]+\.(?:png|jpe?g|webp)\]/i.test(source)) return 'ocr';
  return 'redacted';
}

function metadata(record) {
  return {
    sourceKind: sourceKind(record),
    updatedAt: record.updatedAt ?? null,
    correctedAt: record.correctedAt ?? null,
  };
}

export function shareRange(mode, day = localDate()) {
  if (!validDate(day)) throw Error('日期無效');
  if (mode === 'week') return { from: shiftDate(day, -6), to: day };
  if (mode === 'month') return { from: day.slice(0, 7) + '-01', to: shiftDate(day.slice(0, 7) + '-01', new Date(Date.UTC(+day.slice(0,4), +day.slice(5,7), 0)).getUTCDate() - 1) };
  return { from: day, to: day };
}

export function makeSnapshot(data, {
  from, to = from, selected = DEFAULT_SHARE_TYPES, includeSensitive = false,
  generatedAt = new Date().toISOString(), origin = 'local-device',
} = {}) {
  if (!data || !Array.isArray(data.records)) throw Error('找不到有效的 Lite 紀錄');
  if (!validDate(from) || !validDate(to) || from > to) throw Error('日期區間無效');
  if (!Array.isArray(selected) || selected.some(type => !Object.hasOwn(SHARE_TYPES, type))) throw Error('分享類別錯誤');
  const wanted = new Set(selected);
  const inside = date => date >= from && date <= to;
  const records = [], transactions = [], pendingTransactions = [], ids = new Set();
  let latestRecordUpdatedAt = null;

  for (const record of data.records) {
    if (ids.has(record.id)) throw Error('紀錄含重複 ID，無法建立快照');
    ids.add(record.id);
    const inRange = inside(record.date);
    const info = metadata(record);
    let included = false;
    if (inRange && wanted.has(record.type)) {
      records.push({
        ...pick(record, recordKeys),
        ...info,
        ...(wanted.has('spending') ? pick(record, paymentKeys) : {}),
        ...(safeUnits.includes(record.unit) || (includeSensitive && typeof record.unit === 'string') ? { unit: record.unit } : {}),
        ...(record.type === 'sleep' && Array.isArray(record.segments)
          ? { segments: record.segments.map(segment => pick(segment, ['start', 'end', 'stage'])) } : {}),
        ...(includeSensitive ? pick(record, textKeys) : {}),
      });
      included = true;
    }
    if (wanted.has('spending') && moneyTypes.has(record.type) && record.payment !== 'voucher') {
      const paid = isPaid(record);
      const date = transactionDate(record);
      const payment = {
        ...pick(record, ['id', 'type', 'status', 'time', ...paymentKeys]),
        ...info,
        recordDate: record.date,
        transactionKind: record.transactionKind || 'purchase',
      };
      if (paid && inside(date)) {
        transactions.push({ ...payment, transactionDate: date, amount: record.amount ?? null });
        included = true;
      } else if (inRange && (!paid || !date)) {
        pendingTransactions.push({
          ...payment,
          paymentState: paid ? 'date-unknown' : record.paid === false || record.status === '未付款' ? 'unpaid' : 'unconfirmed',
          recordedAmount: record.amount ?? null,
        });
        included = true;
      }
    }
    if (included && info.updatedAt && (!latestRecordUpdatedAt || Date.parse(info.updatedAt) > Date.parse(latestRecordUpdatedAt))) {
      latestRecordUpdatedAt = info.updatedAt;
    }
  }
  return {
    format: 'second-brain-ai-snapshot', snapshotVersion: 3, version: data.version,
    generatedAt, latestRecordUpdatedAt, timeZone: 'Asia/Taipei', origin, currency: 'TWD',
    range: { from, to }, selectedTypes: [...wanted],
    privacy: { includeSensitive, excluded: ['photos', 'templates', 'drafts', ...(!includeSensitive ? textKeys : [])] },
    interpretation: 'records 依紀錄日，transactions 依付款／購買日。只用 transactions 計算花費，同 ID 只計一次，購買、退費與回補分開。pendingTransactions 尚未入帳。null／缺欄位代表未知；飲用中／部分不視為完成；correctedAt 為已記錄的最後補正，空值代表未標記。合併多份快照時，同 ID 優先採用更新的版本與最新快照覆蓋範圍。',
    records, transactions, pendingTransactions,
  };
}
export function makeDaySnapshot(data, date, selected = DEFAULT_SHARE_TYPES) {
  return makeSnapshot(data,{from:date, selected});
}

export function makeChatText(snapshot, date) {
  return (
    "這是我主動分享的 Second Brain Lite " + date + " 只讀快照。\n" +
    "請依照下方 JSON 協助整理或分析；這不是即時同步，" +
    "未包含的類別與未回報的數值請勿自行推測。\n\n" +
    JSON.stringify(snapshot, null, 2)
  );
}

function snapshotFilename(snapshot) {
  const { from, to } = snapshot.range;
  const stamp = snapshot.generatedAt.replace(/[:.]/g, '-');
  return `second-brain-lite-ai-${from}_${to}_${stamp}.json`;
}

function downloadSnapshot(snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = snapshotFilename(snapshot);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function openAiShare(data, date) {
  const dialog = document.createElement("dialog");
  dialog.className = "ai-share-dialog";
  dialog.setAttribute("aria-labelledby", "ai-share-heading");
  dialog.innerHTML = [
    '<div class="ai-share-head"><h2 id="ai-share-heading">分享資料給 AI</h2>',
    '<button type="button" class="ai-share-close" aria-label="關閉">×</button></div>',
    '<p>日期：<strong class="ai-share-date"></strong>。只會分享你勾選的類別，',
    '不會改動 Lite 原始紀錄。</p>',
    '<label>日期範圍 <select id="ai-range"><option value="day">所選單日</option><option value="custom">自訂區間</option><option value="week">最近七天（含今天）</option><option value="month">當月</option></select></label>',
    '<div class="ai-dates"><label>開始 <input id="ai-from" type="date"></label><label>結束 <input id="ai-to" type="date"></label></div>',
    '<label><input id="ai-sensitive" type="checkbox"> 包含名稱、備註、原始來源文字及私人內容（預設關閉）</label>',
    '<div class="ai-share-types" role="group" aria-label="分享的資料類別"></div>',
    '<p class="ai-share-warning">⚠️ 這些可能是個人資料。',
    '只有你按下複製、下載或系統分享後，資料才會離開此畫面。',
    '不要貼到公開網站或公開 GitHub 儲存庫。分享出去的副本無法遠端撤回。</p>',
    '<p class="ai-share-counter" aria-live="polite"></p>',
    '<label class="ai-share-preview-label" for="ai-share-preview">傳給 ChatGPT 的預覽內容</label>',
    '<textarea id="ai-share-preview" readonly rows="8" spellcheck="false"></textarea>',
    '<p class="ai-share-status" role="status" aria-live="polite"></p>',
    '<div class="ai-share-actions">',
    '<button type="button" data-share-action="copy">複製給 ChatGPT</button>',
    '<button type="button" data-share-action="native">系統分享</button>',
    '<button type="button" data-share-action="download">下載 JSON</button>',
    '</div>',
    '<p class="ai-share-footnote">此功能是手動授權的「日期區間快照」，',
    '不是雲端同步，也不會讓 AI 自動讀取手機瀏覽器的最新資料。',
    '在 iPhone 的系統分享選 Google Drive，存到「我的雲端硬碟」的私人位置。若清單沒有 Drive，先下載 JSON，再從「檔案」App 分享或從 Drive 上傳。回到 ChatGPT 時可指定這份檔案。</p>',
  ].join("");
  document.body.append(dialog);

  dialog.querySelector(".ai-share-date").textContent = date;
  const group = dialog.querySelector(".ai-share-types");
  const preview = dialog.querySelector("#ai-share-preview");
  const counter = dialog.querySelector(".ai-share-counter");
  const status = dialog.querySelector(".ai-share-status");
  Object.entries(SHARE_TYPES).forEach(([type, label]) => {
    const box = document.createElement("label");
    box.className = "ai-share-option";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.value = type;
    check.checked = DEFAULT_SHARE_TYPES.includes(type);
    check.addEventListener("change", refresh);
    box.append(check, document.createTextNode(" " + label));
    group.append(box);
  });

  function selected() {
    return [...group.querySelectorAll('input[type="checkbox"]:checked')]
      .map((input) => input.value);
  }
  const from = dialog.querySelector('#ai-from'), to = dialog.querySelector('#ai-to');
  const sensitive = dialog.querySelector('#ai-sensitive');
  from.value = to.value = date;
  let currentSnapshot;
  function snapshot() { return currentSnapshot; }
  dialog.querySelector('#ai-range').onchange = e => {
    if(e.target.value !== 'custom') {
      const range = shareRange(e.target.value, e.target.value === 'day' ? date : localDate());
      from.value = range.from; to.value = range.to;
    }
    refresh();
  };
  [from,to,sensitive].forEach(el => el.addEventListener('change', refresh));
  function refresh() {
    const types = selected();
    let snap;
    try { snap = makeSnapshot(data,{from:from.value,to:to.value,selected:types,includeSensitive:sensitive.checked}); }
    catch(e) { currentSnapshot = null; preview.value = ''; status.textContent = e.message; dialog.querySelectorAll('[data-share-action]').forEach(b => b.disabled = true); return; }
    currentSnapshot = snap;
    dialog.querySelector('.ai-share-date').textContent = from.value === to.value ? from.value : from.value + '～' + to.value;
    const text = makeChatText(snap, from.value + '～' + to.value);
    preview.value = text;
    counter.textContent = "已勾選 " + types.length + " 類、" +
      snap.records.length + " 筆紀錄、" + snap.transactions.length + " 筆入帳、" + snap.pendingTransactions.length + " 筆待確認帳務（" + text.length.toLocaleString("zh-TW") + " 字元）";
    status.textContent = "";
    dialog.querySelectorAll("[data-share-action]").forEach((button) => {
      button.disabled = types.length === 0;
    });
  }
  dialog.querySelector(".ai-share-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector('[data-share-action="copy"]').addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(preview.value);
      status.textContent = "已複製。請切回 ChatGPT，貼上後傳送，AI 才能看到這份快照。";
    } catch {
      preview.focus();
      preview.select();
      status.textContent = "無法自動複製；已選取內容，請手動複製後貼到 ChatGPT。";
    }
  });
  dialog.querySelector('[data-share-action="download"]').addEventListener("click", () => {
    downloadSnapshot(snapshot());
    status.textContent = "已產生所選區間 JSON，原始資料沒有變動。";
  });
  dialog.querySelector('[data-share-action="native"]').addEventListener("click", async () => {
    try {
      const file = new File([JSON.stringify(snapshot(), null, 2)],
        snapshotFilename(snapshot()), { type: "application/json" });
      if (typeof navigator.share !== "function" ||
          (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] }))) {
        status.textContent = "此瀏覽器不支援檔案分享，請先「下載 JSON」，再從「檔案」App 或 Google Drive 上傳。";
        return;
      }
      await navigator.share({ files: [file], title: "Second Brain Lite " + from.value + "～" + to.value });
      status.textContent = "已交由系統分享；請確認你選擇的接收 App 與對象。";
    } catch (error) {
      if (error.name !== "AbortError")
        status.textContent = "系統分享未完成，可改用複製或下載。";
    }
  });

  refresh();
  dialog.showModal();
}
