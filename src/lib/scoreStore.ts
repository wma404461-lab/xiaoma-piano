import type { Song } from "../types";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("qinban-scores", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("scores", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function listSavedScores(): Promise<Song[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction("scores").objectStore("scores").getAll();
    r.onsuccess = () => {
      db.close();
      resolve(r.result as Song[]);
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
export async function saveScore(song: Song) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("scores", "readwrite");
    tx.objectStore("scores").put(song);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
