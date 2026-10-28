import { validateRecord, upsert } from "./data.js";
const numeric = (v) => (v === "" || v == null ? null : Number(v));
export function candidateRecord(values, id) {
  const type = values.type;
  const r = {
    id,
    type,
    date: values.date,
    time: values.time || "",
    note: values.note || "",
    status: values.status || "",
  };
  if (type === "sleep")
    Object.assign(r, {
      minutes: numeric(values.minutes),
      deep: null,
      rem: null,
      score: numeric(values.score),
    });
  if (type === "activity")
    Object.assign(r, {
      steps: numeric(values.steps),
      minutes: numeric(values.minutes),
    });
  if (type === "sunlight")
    Object.assign(r, {
      minutes: numeric(values.minutes),
      source: values.source || "",
    });
  if (type === "meal")
    Object.assign(r, {
      name: values.name || "",
      amount: numeric(values.amount),
      paid: !values.paid ? null : values.paid === "yes",
      paymentDate: values.paymentDate || null,
      orderDate: values.orderDate || null,
      startTime: values.startTime || "",
      endTime: values.endTime || "",
    });
  if (type === "coffee")
    Object.assign(r, {
      volume: numeric(values.volume),
      amount: numeric(values.amount),
      payment: values.payment || "",
      purchaseDate: values.purchaseDate || null,
      startTime: values.startTime || "",
      endTime: values.endTime || "",
    });
  if (type === "beverage") Object.assign(r,{name:values.name||'',volume:numeric(values.volume),amount:numeric(values.amount),paid:!values.paid?null:values.paid==='yes',paymentDate:values.paymentDate||null,startTime:values.startTime||'',endTime:values.endTime||''});
  if (type === "water") Object.assign(r, { volume: numeric(values.volume) });
  if (type === "spending") Object.assign(r, { amount: numeric(values.amount) });
  if (type === "event") Object.assign(r, { name: values.name || "" });
  if (type === "journal") Object.assign(r, {theme:values.theme||"",highlight:values.highlight||"",wellbeing:values.wellbeing||"",mood:values.mood||"",todo:values.todo||""});
  return validateRecord(r);
}
// Merge fills unknown numeric/text fields only and never changes date, status, payment or existing facts.
const fillKeys = {
  sleep: ["minutes", "deep", "rem", "score"],
  activity: ["steps", "minutes"],
  sunlight: ["minutes", "source"],
  meal: ["amount", "startTime", "endTime", "orderDate"],
  coffee: ["volume", "amount", "startTime", "endTime"],
  water: ["volume"],
  beverage: ["volume","amount","startTime","endTime"],
  spending: ["amount"],
  event: [],
};
// Compare every stored fact, never just date/type or a name/time shortcut.
export function exactRecord(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("id");
  return [...keys].every((k) => {
    const fallback = ["startTime", "endTime"].includes(k) ? "" : null;
    // Legacy coffee records imply purchaseDate=date; do not erase that fact.
    const value = (r) => k === "purchaseDate" && r.type === "coffee" && r[k] === undefined ? r.date : (r[k] ?? fallback);
    return value(a) === value(b);
  });
}
export function findExactCandidate(data, values) {
  try {
    const record = candidateRecord(values, "comparison");
    return data.records.find((r) => exactRecord(r, record));
  } catch { return undefined; }
}
export function planCandidates(data, items) {
  let next = data,
    added = 0,
    merged = 0,
    skipped = 0;
  for (const item of items) {
    const r = candidateRecord(item.values, item.id);
    const matches = next.records.filter(
      (x) => x.type === r.type && x.date === r.date,
    );
    if (matches.some((x) => exactRecord(x, r))) {
      skipped++;
      continue;
    }
    if (matches.length && item.action === "merge") {
      const old = matches.find((x) => x.id === item.target);
      if (!old) throw Error("請為合併項目選擇同類別、同日期的既有紀錄");
      const combined = { ...old };
      for (const key of fillKeys[r.type] || [])
        if (
          (combined[key] === null || combined[key] === "") &&
          r[key] !== null &&
          r[key] !== undefined &&
          r[key] !== ""
        )
          combined[key] = r[key];
      if (!combined.note && r.note) combined.note = r.note;
      if (JSON.stringify(combined) === JSON.stringify(old)) {
        skipped++;
        continue;
      }
      next = upsert(next, combined);
      merged++;
      continue;
    }
    if (matches.length && ["sleep", "activity", "sunlight"].includes(r.type) && item.action !== "add")
      throw Error("同日數據內容不同，請確認合併或另存，先保留草稿");
    if (next.records.some((existing) => existing.id === r.id))
      throw Error("候選 ID 與現有紀錄衝突，未覆寫任何資料");
    next = upsert(next, r);
    added++;
  }
  return { data: next, added, merged, skipped };
}
