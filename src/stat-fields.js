// Optional record metadata shared by the editor, backups, and statistics.
export const quantities = [
  "quantity",
  "consumedQuantity",
  "familyQuantity",
  "remainingQuantity",
];
export const mealTypes = {
  unknown: "餐別未標註",
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "點心",
};
export const orderStates = {
  unknown: "選購狀態未知",
  selected: "已選定",
  ordered: "已訂購",
};
export function statKeys(type) {
  return [
    ...quantities,
    "unit",
    "provenance",
    "updatedAt",
    "correctedAt",
    ...(type === "spending" ? ["transactionKind", "paymentDate"] : []),
    ...(type === "meal" ? ["mealType", "orderStatus"] : []),
    ...(type === "activity" ? ["startTime", "endTime"] : []),
  ];
}
export function statVersion(r) {
  if (
    r.correctedAt !== undefined ||
    r.mealType !== undefined ||
    r.orderStatus !== undefined ||
    (r.type === "activity" &&
      (r.startTime !== undefined || r.endTime !== undefined)) ||
    (r.type === "spending" && r.paymentDate !== undefined)
  )
    return 8;
  return [
    ...quantities,
    "unit",
    "provenance",
    "updatedAt",
    "transactionKind",
  ].some((k) => r[k] !== undefined)
    ? 7
    : 0;
}
export function validateStatFields(r, validDate) {
  for (const k of quantities)
    if (
      r[k] !== undefined &&
      r[k] !== null &&
      (!Number.isFinite(r[k]) || r[k] < 0 || r[k] > 1000000)
    )
      throw Error("數量無效：" + k);
  if (
    r.quantity != null &&
    quantities.slice(1).every((k) => r[k] != null) &&
    r.consumedQuantity + r.familyQuantity + r.remainingQuantity >
      r.quantity + 0.000001
  )
    throw Error("本人、他人及剩餘份量超過購買總量");
  for (const [k, max] of [
    ["unit", 20],
    ["provenance", 500],
  ])
    if (r[k] !== undefined && (typeof r[k] !== "string" || r[k].length > max))
      throw Error("來源或單位無效");
  for (const key of ["updatedAt", "correctedAt"])
    if (
      r[key] !== undefined &&
      (typeof r[key] !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(r[key]) ||
        !Number.isFinite(Date.parse(r[key])))
    )
      throw Error("修改或補正時間無效");
  if (
    r.transactionKind !== undefined &&
    (r.type !== "spending" ||
      !["purchase", "refund", "reimbursement"].includes(r.transactionKind))
  )
    throw Error("交易種類無效");
  if (r.mealType !== undefined && !Object.hasOwn(mealTypes, r.mealType))
    throw Error("餐別無效");
  if (r.orderStatus !== undefined && !Object.hasOwn(orderStates, r.orderStatus))
    throw Error("選購狀態無效");
  if (
    r.type === "spending" &&
    r.paymentDate !== undefined &&
    r.paymentDate !== null &&
    !validDate(r.paymentDate)
  )
    throw Error("付款日期無效");
  if (r.type === "spending" && r.status !== "已付款" && r.paymentDate != null)
    throw Error("未付款時請勿填付款日期");
  if (r.type === "activity") {
    for (const k of ["startTime", "endTime"])
      if (
        r[k] !== undefined &&
        (typeof r[k] !== "string" ||
          (r[k] !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r[k])))
      )
        throw Error("活動時間格式無效");
    if (r.startTime && r.endTime && r.endTime <= r.startTime)
      throw Error("活動結束需晚於開始；跨日請分筆");
  }
}
// These controls only populate explicit user input; opening a form does not write a record.
export function addStatFields(container, r) {
  const add = (key, title, type = "text", options) => {
    const label = document.createElement("label");
    label.textContent = title;
    const input = document.createElement(options ? "select" : "input");
    input.name = key;
    if (options)
      for (const [value, text] of Object.entries(options)) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = text;
        input.append(o);
      }
    else {
      input.type = type;
      if (type === "number") {
        input.min = "0";
        input.max = "1000000";
        input.step = "any";
      }
    }
    input.value = r[key] ?? (options ? "unknown" : "");
    label.append(input);
    container.append(label);
    return input;
  };
  if (r.type === "meal") {
    add("mealType", "餐別（不依時間猜測）", "text", mealTypes);
    add("orderStatus", "選購狀態（與付款／食用分開）", "text", orderStates);
  }
  if (["meal", "coffee", "beverage", "spending"].includes(r.type)) {
    for (const [i, k] of quantities.entries())
      add(
        k,
        ["購買總份量", "本人已食用份量", "家人／同學已食用份量", "剩餘份量"][
          i
        ] + "（未知留空）",
        "number",
      );
    add("unit", "數量單位").maxLength = 20;
  }
  if (r.type === "activity") {
    add("startTime", "活動開始（判斷重疊用）", "time");
    add("endTime", "活動結束（跨日請分筆）", "time");
  }
  if (r.type === "spending") {
    const kind = add("transactionKind", "交易種類", "text", {
      purchase: "購買支出",
      refund: "退費",
      reimbursement: "回補",
    });
    kind.value = r.transactionKind || "purchase";
    const day = add("paymentDate", "實際付款／入帳日期（未知留空）", "date");
    day.value =
      r.paymentDate === undefined && r.status === "已付款"
        ? r.date
        : r.paymentDate || "";
  }
}
export function normalizeStatFields(values) {
  for (const k of quantities)
    if (Object.hasOwn(values, k))
      values[k] = values[k].trim() === "" ? null : Number(values[k]);
  return values;
}
