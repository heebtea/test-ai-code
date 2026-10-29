import { guardedWrite } from "./storage-guard.js";
export const sectionNames = {
  overview: "日期與主題",
  health: "睡眠、活動、日照",
  timeline: "當日時間軸",
  food: "餐點、飲品、花費",
  highlight: "今日亮點",
  body: "身體與心情",
  todo: "待辦事項",
};
export const sectionKeys = Object.keys(sectionNames);
export const baseTemplate = () => ({
  id: "default",
  name: "簡約小誌",
  background: "#f6f3eb",
  accent: "#386a58",
  font: "sans",
  columns: 3,
  illustration: "✳",
  mapping: [...sectionKeys],
  image: null,
});
const dbName = "second-brain-private-templates";
async function db() {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(dbName, 1);
    q.onupgradeneeded = () =>
      q.result.createObjectStore("templates", { keyPath: "id" });
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
async function transact(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("templates", mode),
      q = fn(tx.objectStore("templates"));
    let value;
    q.onsuccess = () => {
      value = q.result;
    };
    tx.oncomplete = () => {
      d.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      d.close();
      reject(tx.error || Error("模板儲存失敗"));
    };
  });
}
export const listTemplates = () => transact("readonly", (s) => s.getAll());
export const putTemplate = (t) => guardedWrite(() => transact("readwrite", (s) => s.put(t)));
export const deleteTemplate = (id) =>
  guardedWrite(() => transact("readwrite", (s) => s.delete(id)));
export async function palette(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 48, 48);
    const pixels = ctx.getImageData(0, 0, 48, 48).data,
      bins = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]]
        .map((n) => Math.round(n / 32) * 32)
        .map((n) => Math.min(255, n));
      const key = rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    return [...bins.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([v]) => "#" + v);
  } finally {
    bitmap.close();
  }
}
export function validateTemplate(t) {
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 80)
    throw Error("請輸入模板名稱（最多 80 字）");
  if (
    !/^#[0-9a-f]{6}$/i.test(t.background) ||
    !/^#[0-9a-f]{6}$/i.test(t.accent)
  )
    throw Error("顏色格式無效");
  if (
    !["sans", "serif"].includes(t.font) ||
    ![1, 2, 3].includes(t.columns) ||
    !["✳", "☀", "✦", "○", ""].includes(t.illustration)
  )
    throw Error("模板樣式無效");
  if (
    !Array.isArray(t.mapping) ||
    t.mapping.length !== sectionKeys.length ||
    new Set(t.mapping).size !== sectionKeys.length ||
    t.mapping.some((k) => !sectionKeys.includes(k))
  )
    throw Error("每個區塊必須各出現一次，請檢查對應順序");
  if (
    t.image &&
    (!(t.image instanceof Blob) ||
      t.image.size > 10 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(t.image.type))
  )
    throw Error("圖片格式或大小無效");
  return t;
}
