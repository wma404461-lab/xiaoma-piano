import type { UserData } from "../types";
import {syncOfflinePractice} from "./offlineScores";
const KEY = "qinban-user-v1";
export const defaultData: UserData = {
  version: 1,
  favorites: [],
  recentSongId: "twinkle",
  recentSongIds: [],
  records: [],
  notation: "hybrid",
  dailyGoal: 15,
};
export function loadData(): UserData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultData };
    const parsed = JSON.parse(raw);
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.records) ||
      !Array.isArray(parsed.favorites)
    )
      return { ...defaultData };
    return {
      ...defaultData,
      ...parsed,
      recentSongIds: Array.isArray(parsed.recentSongIds)
        ? [...new Set<string>(parsed.recentSongIds.filter((id: unknown) => typeof id === 'string'))].slice(0, 8)
        : parsed.recentSongId ? [parsed.recentSongId] : [],
      notation: ["staff", "numbered", "beginner", "hybrid", "waterfall"].includes(parsed.notation)
        ? parsed.notation
        : "hybrid",
    };
  } catch {
    return { ...defaultData };
  }
}
export function saveData(data: UserData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    syncOfflinePractice(data);
    return true;
  } catch {
    return false;
  }
}
/** Local calendar day, so nightly sessions are not shifted by UTC conversion. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
