import { createWorker } from "tesseract.js";
import { validDate } from "./data.js";
import { layoutIsRecognized,layoutZones,zoneCandidates } from "./ocr-layout.js";
const clean = (s) => s.replace(/[\u3000\s]+/g, " ");
const matchNumber = (s) => {
  const m = s.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{4,6}\b/);
  return m ? Number(m[0].replaceAll(",", "")) : null;
};
export function extractCandidates(raw) {
  const dateText = clean(raw.date || "");
  const dateMatch = dateText.match(
    /\b(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\b/,
  );
  let date = "";
  if (dateMatch) {
    const v = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    if (validDate(v)) date = v;
  }
  const result = [];
  const push = (type, fields, source) =>
    result.push({ type, date, source, ...fields });
  const sleep = clean(raw.sleep || "");
  const duration = sleep.match(/(\d{1,2})\s*小\s*時\s*(\d{1,2})\s*分/);
  const score = clean((raw.sleepblock || "") + " " + (raw.whole || "")).match(
    /睡\s*眠\s*(?:分\s*)?數\s*(\d{1,3})/,
  );
  if (duration || score)
    push(
      "sleep",
      {
        minutes: duration
          ? Number(duration[1]) * 60 + Number(duration[2])
          : null,
        score: score ? Number(score[1]) : null,
      },
      sleep || score[0],
    );
  const steps = matchNumber(clean(raw.steps || ""));
  if (steps !== null) push("activity", { steps }, clean(raw.steps));
  const sun = clean(raw.sunlight || "").match(/(\d{1,4})\s*分\s*鐘/);
  if (sun) push("sunlight", { minutes: Number(sun[1]) }, clean(raw.sunlight));
  const regions=raw.regions && Object.keys(raw.regions).length ? raw.regions : {unknown:raw.whole||''};
  const regionalCandidates = zoneCandidates(regions,date);
  const dateMatches = [
    ...dateText.matchAll(
      /\b(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\b/g,
    ),
  ]
    .map((m) => [m[1], m[2].padStart(2, "0"), m[3].padStart(2, "0")].join("-"))
    .filter(validDate);
  const secondMatch = clean(raw.date2 || "").match(
    /\b(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\b/,
  );
  const secondDate = secondMatch
    ? [
        secondMatch[1],
        secondMatch[2].padStart(2, "0"),
        secondMatch[3].padStart(2, "0"),
      ].join("-")
    : "";
  const headerDates = [
    ...clean((raw.whole || "").slice(0, 300)).matchAll(
      /\b(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\b/g,
    ),
  ]
    .map((m) => [m[1], m[2].padStart(2, "0"), m[3].padStart(2, "0")].join("-"))
    .filter(validDate);
  const dateConflict =
    new Set([...dateMatches, ...headerDates]).size > 1 ||
    Boolean(date && secondDate && date !== secondDate);
  const compact = clean(raw.whole || "").replace(/\s/g, "");
  const confidences = raw.confidences || {};
  // A reliable duration must not silently carry a low-confidence sleep score.
  const sleepRow = result.find((item) => item.type === "sleep");
  if (
    sleepRow &&
    sleepRow.minutes !== null &&
    sleepRow.score !== null &&
    (confidences.sleepblock || 0) < 65
  ) {
    result.push({
      ...sleepRow,
      minutes: null,
      source: clean(raw.sleepblock || ""),
      reason: "睡眠分數待確認",
    });
    sleepRow.score = null;
  }
  result.push(...regionalCandidates);
  for (const c of result) {
    let evidence = false,
      ocrScore = 0;
    if (c.type === "sleep" && c.minutes !== null) {
      evidence = /睡\s*眠/.test(
        (raw.sleepblock || "") + " " + (raw.whole || ""),
      );
      ocrScore = confidences.sleep || 0;
      if (c.score !== null)
        ocrScore = Math.min(ocrScore, confidences.sleepblock || 0);
    }
    if (c.type === "activity" && c.steps !== null) {
      const n = String(c.steps);
      const digits = compact.replace(/,/g, "");
      evidence = new RegExp(
        "(?:步|數).{0,15}" + n + "|" + n + ".{0,15}(?:步|超過)",
      ).test(digits);
      ocrScore = confidences.steps || 0;
    }
    if (c.type === "sunlight" && c.minutes !== null) {
      evidence = new RegExp(
        "日照.{0,15}" + c.minutes + "|" + c.minutes + ".{0,15}日照",
      ).test(compact);
      ocrScore = confidences.sunlight || 0;
    }
    c.recommended = Boolean(
      date &&
      !dateConflict &&
      secondDate === date &&
      (confidences.date || 0) >= 50 &&
      (confidences.date2 || 0) >= 50 &&
      ocrScore >= (c.type === "activity" || c.type === "sunlight" ? 40 : 65) &&
      evidence,
    );
    c.reason =
      c.reason ||
      (dateConflict
        ? "日期有矛盾"
        : !date
          ? "日期未確認"
          : c.recommended
            ? "數值及日期有辨識依據"
            : "辨識依據不足或狀態待確認");
    if (c.recommended) c.status = c.type === "sunlight" ? "已記錄" : "已完成";
  }
  return { date, dateConflict, candidates: result };
}
function crop(bitmap, rect, scale = 3) {
  const c = document.createElement("canvas");
  const [x, y, w, h] = rect;
  c.width = Math.max(1, Math.round(bitmap.width * w * scale));
  c.height = Math.max(1, Math.round(bitmap.height * h * scale));
  c.getContext("2d").drawImage(
    bitmap,
    bitmap.width * x,
    bitmap.height * y,
    bitmap.width * w,
    bitmap.height * h,
    0,
    0,
    c.width,
    c.height,
  );
  return c;
}
export async function recognizeCard(file, progress = () => {}) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw Error("請選擇 10 MB 以下的 PNG、JPG 或 WebP");
  const bitmap = await createImageBitmap(file);
  let worker;
  try {
    if (bitmap.width * bitmap.height > 30000000)
      throw Error("圖片解析度過大，請縮小後再試");
    const root = new URL(
      `${import.meta.env.BASE_URL}ocr/`,
      location.origin,
    ).href.replace(/\/$/, "");
    worker = await createWorker("chi_tra+eng", 1, {
      workerPath: `${root}/worker.min.js`,
      corePath: root,
      langPath: root,
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (m) => progress(m.status, m.progress),
    });
    const wholeCanvas = crop(bitmap, [0, 0, 1, 1], 1);
    const first = (await worker.recognize(wholeCanvas)).data;
    let whole = first.text;
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const specs = {
      date: [0.017, 0.043, 0.258, 0.048],
      sleep: [0.032, 0.153, 0.208, 0.037],
      steps: [0.34, 0.149, 0.19, 0.041],
      sunlight: [0.54, 0.148, 0.18, 0.045],
      sleepblock: [0.01, 0.117, 0.31, 0.105],
    };
    const raw = { whole, confidences: { whole: first.confidence } };
    let index = 0;
    for (const [name, rect] of Object.entries(specs)) {
      progress("辨識區塊", index++ / 5);
      const result = (await worker.recognize(crop(bitmap, rect, 4))).data;
      raw[name] = result.text;
      raw.confidences[name] = result.confidence;
    }
    await worker.setParameters({ tessedit_pageseg_mode: "7" });
    const secondDate = (await worker.recognize(crop(bitmap, specs.date, 4)))
      .data;
    raw.date2 = secondDate.text;
    raw.confidences.date2 = secondDate.confidence;
    raw.regions = {};
    if(layoutIsRecognized(raw.whole)){
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      let done=0;
      for(const [zone,rect] of Object.entries(layoutZones)){
        progress('辨識小誌分區',done++/Object.keys(layoutZones).length);
        raw.regions[zone]=(await worker.recognize(crop(bitmap,rect,2))).data.text;
      }
    }
    return { ...extractCandidates(raw), raw };
  } finally {
    bitmap.close();
    if (worker) await worker.terminate();
  }
}
