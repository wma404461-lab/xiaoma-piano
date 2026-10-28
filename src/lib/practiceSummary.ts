import type { PracticeRecord } from "../types";
import { dayKey } from "./storage";

/** One linear pass, reused while navigating the library or opening a score. */
export function practiceSummary(records: PracticeRecord[], today: string) {
  let todaySeconds = 0,
    totalSeconds = 0;
  const practiced = new Set<string>();
  const mistakes = new Map<
    string,
    { songId: string; title: string; measure: number; count: number }
  >();
  for (const record of records) {
    totalSeconds += record.activeSeconds;
    if (dayKey(new Date(record.date)) === today)
      todaySeconds += record.activeSeconds;
    practiced.add(record.songId);
    for (const mistake of record.mistakes) {
      const key = JSON.stringify([record.songId, mistake.measure]);
      const old = mistakes.get(key);
      if (old) old.count++;
      else
        mistakes.set(key, {
          songId: record.songId,
          title: record.title,
          measure: mistake.measure,
          count: 1,
        });
    }
  }
  return {
    todaySeconds,
    totalSeconds,
    practiced: practiced.size,
    mistakes: [...mistakes.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
