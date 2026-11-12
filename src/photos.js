import { guardedWrite } from "./storage-guard.js";
const DB = "second-brain-private-photos";
function open() {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore("photos");
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
async function access(mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", mode);
    const q = run(tx.objectStore("photos"));
    let result;
    q.onsuccess = () => {
      result = q.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error("照片儲存中斷"));
    };
  });
}
export const getPhoto = (id) => access("readonly", (s) => s.get(id));
export const putPhoto = (id, blob) =>
  guardedWrite(() => access("readwrite", (s) => s.put(blob, id)));
export const deletePhoto = (id) => guardedWrite(() => access("readwrite", (s) => s.delete(id)));
