export const STORAGE_KEY = "second-brain-lite-v2";
export const THEME_KEY = "second-brain-theme";
export const types = [
  "sleep",
  "coffee",
  "water",
  "beverage",
  "activity",
  "sunlight",
  "meal",
  "event",
  "journal",
  "spending",
];
export const empty = () => ({ version: 5, records: [] });
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function validDate(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    s >= "1900-01-01" &&
    s <= "2199-12-31" &&
    !Number.isNaN(Date.parse(s + "T12:00:00Z")) &&
    new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s
  );
}
export function shiftDate(s, n) {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localDate(d);
}
export const fields = {
  sleep: { minutes: 1440, deep: 1440, rem: 1440, score: 100 },
  coffee: { volume: 100000, amount: 100000000 },
  water: { volume: 100000 },
  activity: { steps: 1000000, minutes: 1440 },
  spending: { amount: 100000000 },
  meal: { amount: 100000000 },
  sunlight: { minutes: 1440 },
  event: {},
  journal: {},
  draft: {},
  beverage: {volume:100000, amount:100000000},
};
const statuses = {
  sleep: ["已完成"],
  coffee: ["已購買", "已兌換", "飲用中", "已飲用"],
  water: ["已飲用", "飲用中"],
  activity: ["未完成", "已完成"],
  spending: ["未付款", "已付款"],
  meal: ["未確認", "部分", "吃完"],
  sunlight: ["已記錄"],
  event: ["已記錄"],
  journal: ["已記錄"],
  draft: ["待確認"],
  beverage: ["未確認", "已購買", "飲用中", "已飲用"],
};
export { statuses };
export function validateRecord(r) {
  if (!r || typeof r !== "object" || Array.isArray(r))
    throw Error("紀錄格式錯誤");
  const allowed = [
    "id",
    "date",
    "type",
    "status",
    "note",
    "time",
    ...Object.keys(fields[r.type] || {}),
    ...(r.type === "coffee" ? ["payment"] : []),
    ...(r.type === "coffee" ? ["purchaseDate", "startTime", "endTime"] : []),
    ...(r.type === "event" ? ["name"] : []),
    ...(r.type === "water" ? ["capacity", "startTime", "endTime"] : []),
    ...(r.type === "draft" ? ["classification", "payload", "source"] : []),
    ...(r.type === "beverage" ? ["name", "paid", "paymentDate", "startTime", "endTime"] : []),
    ...(r.type === "journal"
      ? ["theme", "highlight", "wellbeing", "mood", "todo"]
      : []),
    ...(r.type === "meal"
      ? ["name", "paid", "paymentDate", "orderDate", "startTime", "endTime"]
      : []),
    ...(r.type === "sunlight" ? ["source"] : []),
  ];
  if (
    Object.keys(r).some((k) => !allowed.includes(k)) ||
    typeof r.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) ||
    !(validDate(r.date) || (r.type === "draft" && r.date === "")) ||
    !(types.includes(r.type) || r.type === "draft" || r.type === "beverage") ||
    !statuses[r.type].includes(r.status)
  )
    throw Error("紀錄 ID、日期、類別或狀態無效");
  if (
    typeof r.note !== "string" ||
    r.note.length > 500 ||
    typeof r.time !== "string" ||
    (r.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time))
  )
    throw Error("文字或時間格式無效");
  if (r.type === "draft") {
    if (typeof r.classification !== "string" || !["sleep","activity","sunlight","meal","coffee","water","spending","event","journal","beverage","unclassified"].includes(r.classification) || typeof r.payload !== "string" || r.payload.length > 10000 || typeof r.source !== "string" || r.source.length > 500) throw Error("草稿格式無效");
    try { const p = JSON.parse(r.payload); if (!p || typeof p !== "object" || Array.isArray(p)) throw Error(); } catch { throw Error("草稿內容無效"); }
  }
  if (
    r.type === "journal" &&
    (["theme", "highlight", "wellbeing", "mood", "todo"].some(
      (k) => typeof r[k] !== "string" || r[k].length > 500,
    ) ||
      ![r.theme, r.highlight, r.wellbeing, r.mood, r.todo, r.note].some((v) =>
        v.trim(),
      ))
  )
    throw Error("請填寫小誌內容，每個欄位最多 500 字");
  const timeValid = (v) =>
    typeof v === "string" && (v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
  if (
    r.type === "event" &&
    (typeof r.name !== "string" ||
      !r.name.trim() ||
      r.name.length > 100 ||
      !r.time)
  )
    throw Error("事件請填名稱及時間");
  if (
    r.type === "coffee" &&
    ((r.startTime !== undefined && !timeValid(r.startTime)) ||
      (r.endTime !== undefined && !timeValid(r.endTime)) ||
      (r.startTime && r.endTime && r.endTime < r.startTime))
  )
    throw Error("咖啡時間無效或結束早於開始");
  if (r.type === "water") {
    if (r.capacity !== undefined && r.capacity !== null && (!Number.isInteger(r.capacity) || r.capacity < 0 || r.capacity > 100000)) throw Error("裝水容量無效");
    if ((r.startTime !== undefined && !timeValid(r.startTime)) || (r.endTime !== undefined && !timeValid(r.endTime)) || (r.startTime && r.endTime && r.endTime < r.startTime)) throw Error("飲水時間無效");
    if (r.status === "飲用中" && r.volume !== null) throw Error("飲用中請只填裝水容量；已喝水量待喝完再填");
  }
  if (r.type === "beverage") {
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length>100 || ![true,false,null].includes(r.paid) || !(r.paymentDate===null || validDate(r.paymentDate)) || !timeValid(r.startTime) || !timeValid(r.endTime)) throw Error('飲品名稱、付款或時間格式無效');
    if(r.paid !== true && r.paymentDate !== null)throw Error('未付款或未確認付款時，付款日期請留空');
    if(r.startTime && r.endTime && r.endTime < r.startTime)throw Error('結束時間不可早於開始時間');
  }
  if (r.type === "meal") {
    if (
      typeof r.name !== "string" ||
      !r.name.trim() ||
      r.name.length > 100 ||
      ![true, false, null].includes(r.paid) ||
      !(r.paymentDate === null || validDate(r.paymentDate)) ||
      !(r.orderDate === null || validDate(r.orderDate)) ||
      !timeValid(r.startTime) ||
      !timeValid(r.endTime)
    )
      throw Error("餐點名稱、付款或用餐時間格式無效");
    if (r.paid !== true && r.paymentDate !== null)
      throw Error("未付款或未確認付款時，付款日期請留空");
    if (r.startTime && r.endTime && r.endTime < r.startTime)
      throw Error("結束時間不可早於開始時間；跨日請分筆記錄");
  }
  if (
    r.type === "sunlight" &&
    (typeof r.source !== "string" || r.source.length > 100)
  )
    throw Error("日照來源格式無效");
  if (
    r.type === "coffee" &&
    r.purchaseDate !== undefined &&
    r.purchaseDate !== null &&
    !validDate(r.purchaseDate)
  )
    throw Error("購買日期無效");
  for (const [k, max] of Object.entries(fields[r.type]))
    if (
      r[k] !== null &&
      (typeof r[k] !== "number" ||
        !Number.isFinite(r[k]) ||
        r[k] < 0 ||
        r[k] > max ||
        (k !== "amount" && !Number.isInteger(r[k])) ||
        (k === "amount" &&
          Math.abs(r[k] * 100 - Math.round(r[k] * 100)) > 0.00001))
    )
      throw Error("數值無效：" + k);
  if (r.type === "coffee" && !["purchase", "voucher"].includes(r.payment))
    throw Error("付款方式無效");
  if (r.type === "coffee" && r.payment === "voucher" && r.amount !== null)
    throw Error("兌換券不在咖啡紀錄重複記帳，金額請留空");
  if (
    r.type === "sleep" &&
    r.minutes !== null &&
    (r.deep ?? 0) + (r.rem ?? 0) > r.minutes
  )
    throw Error("深睡與 REM 合計不能超過總睡眠");
  if (
    !Object.keys(fields[r.type]).some((k) => r[k] !== null) &&
    r.type !== "meal" &&
    r.type !== "event" &&
    r.type !== "journal" &&
    r.type !== "draft" &&
    r.type !== "beverage" &&
    !(r.type === "sunlight" && r.source.trim()) &&
    !r.note.trim() &&
    !r.time
  )
    throw Error("請至少填寫一項數值、時間或說明");
  return r;
}
export function validate(data) {
  if (
    !data ||
    ![2, 3, 4, 5, 6].includes(data.version) ||
    !Array.isArray(data.records) ||
    Object.keys(data).some((k) => !["version", "records"].includes(k)) ||
    data.records.length > 10000
  )
    throw Error("僅接受 v2 / v3 / v4 / v5 / v6 備份（最多 10000 筆）");
  const ids = new Set();
  for (const r of data.records) {
    if (data.version === 2 && ["meal", "sunlight"].includes(r.type))
      throw Error("新類別請使用 v3 備份");
    if (
      data.version < 4 &&
      (r.type === "event" ||
        (r.type === "coffee" &&
          (r.startTime !== undefined || r.endTime !== undefined)))
    )
      throw Error("新事件格式請使用 v4 備份");
    if (data.version < 5 && r.type === "journal")
      throw Error("小誌內容請使用 v5 備份");
    if (data.version < 6 && ["draft", "beverage"].includes(r.type)) throw Error("草稿請使用 v6 備份");
    validateRecord(r);
    if (ids.has(r.id)) throw Error("備份含重複 ID");
    ids.add(r.id);
  }
  return data;
}
export function parseBackup(s) {
  if (typeof s !== "string" || s.length > 10000000) throw Error("備份過大");
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw Error("JSON 格式無效，請選擇完整備份檔");
  }
  return validate(data);
}
export function upsert(data, r) {
  validateRecord(r);
  const old = data.records.find((x) => x.id === r.id);
  if (old && old.type !== r.type) throw Error("不可變更既有 ID 的類別");
  return validate({
    ...data,
    version: data.version === 6 || ["draft", "beverage"].includes(r.type) ? 6 : 5,
    records: [...data.records.filter((x) => x.id !== r.id), r],
  });
}
export function remove(data, id) {
  return { ...data, records: data.records.filter((r) => r.id !== id) };
}
export function merge(data, incoming) {
  validate(incoming);
  const records = [...data.records];
  let added = 0,
    conflicts = 0;
  for (const r of incoming.records) {
    const old = records.find((x) => x.id === r.id);
    if (!old) {
      records.push(r);
      added++;
    } else if (
      Object.keys(old).length !== Object.keys(r).length ||
      Object.keys(old).some((k) => old[k] !== r[k])
    )
      conflicts++;
  }
  return { data: validate({ version: data.version === 6 || incoming.version === 6 ? 6 : 5, records }), added, conflicts };
}
export function loadRecords(storage) {
  const s = storage.getItem(STORAGE_KEY);
  return s === null ? empty() : parseBackup(s);
}
export function persist(storage, data) {
  const value = JSON.stringify(validate(data));
  storage.setItem(STORAGE_KEY, value);
}
export function rows(data, date, type) {
  return data.records.filter((r) => r.date === date && r.type === type);
}
export function sum(rs, key) {
  const known = rs.filter(
    (r) => typeof r[key] === "number" && Number.isFinite(r[key]),
  );
  return {
    value: known.length
      ? known.reduce((s, r) => s + Math.round(r[key] * 100), 0) / 100
      : null,
    unknown: rs.length - known.length,
  };
}
export function expenses(data, date) {
  return data.records.filter(
    (r) =>
      (r.type === "spending" && r.date === date && r.status === "已付款") ||
      (r.type === "coffee" &&
        r.payment === "purchase" &&
        (r.purchaseDate === undefined ? r.date : r.purchaseDate) === date) ||
      (r.type === "meal" && r.paid === true && r.paymentDate === date) ||
      (r.type === "beverage" && r.paid === true && r.paymentDate === date),
  );
}

/** Count only confirmed consumed liquids; the same record is counted once. */
export function liquidIntake(data, date) {
  const categories = ["water", "coffee", "beverage"];
  const relevant = data.records.filter(
    (r) => r.date === date && categories.includes(r.type),
  );
  const confirmed = relevant.filter((r) => r.status === "已飲用");
  const breakdown = Object.fromEntries(
    categories.map((type) => [
      type,
      sum(confirmed.filter((r) => r.type === type), "volume"),
    ]),
  );
  return {
    ...sum(confirmed, "volume"),
    breakdown,
    pending: relevant.length - confirmed.length,
  };
}
