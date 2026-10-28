import { createWorker } from "tesseract.js";
import { validDate } from "./data.js";
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
  // Lines are suggestions only: no inferred payment or consumption state.
  for (const line of (raw.whole || "").split("\n").map(clean).filter(Boolean)) {
    if (
      /(?:午餐|晚餐|早餐|餐點|飯|麵|麵包|便當)/.test(line) &&
      line.length < 180
    )
      push("meal", { name: line.slice(0, 100), amount: null }, line);
    else if (/(?:美\s*式|咖啡)/.test(line) && line.length < 180)
      push("coffee", { amount: null, volume: null }, line);
    else if (/(?:飲\s*品|飲\s*水|清\s*水)/.test(line) && line.length < 180)
      push("water", { volume: null }, line);
    const amounts = [...line.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)];
    if (amounts.length === 1 && line.length < 120)
      push("spending", { amount: Number(amounts[0][1]) }, line);
    const times = [...line.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
    if (
      times.length === 1 &&
      line.length > times[0][0].length + 2 &&
      line.length < 120
    )
      push(
        "event",
        {
          time: `${times[0][1].padStart(2, "0")}:${times[0][2]}`,
          name: line.slice(0, 100),
        },
        line,
      );
  }
  return { date, candidates: result.slice(0, 60) };
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
    let whole = (await worker.recognize(wholeCanvas)).data.text;
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    const specs = {
      date: [0.017, 0.043, 0.258, 0.048],
      sleep: [0.032, 0.153, 0.208, 0.037],
      steps: [0.34, 0.149, 0.19, 0.041],
      sunlight: [0.54, 0.148, 0.18, 0.045],
      sleepblock: [0.01, 0.117, 0.31, 0.105],
    };
    const raw = { whole };
    let index = 0;
    for (const [name, rect] of Object.entries(specs)) {
      progress("辨識區塊", index++ / 5);
      raw[name] = (await worker.recognize(crop(bitmap, rect, 4))).data.text;
    }
    return { ...extractCandidates(raw), raw };
  } finally {
    bitmap.close();
    if (worker) await worker.terminate();
  }
}
