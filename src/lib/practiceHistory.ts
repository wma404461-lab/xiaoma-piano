import type { Hands, InputSource } from "../types";

export type ScoredPracticeMode = "wait" | "rhythm" | "game";

export interface PracticeHistoryEntry {
  gameDifficulty?: "easy" | "standard" | "challenge";
  gameIntensity?: number;
  gameRulesVersion?: number;
  id: string;
  songId: string;
  title: string;
  date: string;
  mode: ScoredPracticeMode;
  source: InputSource;
  hands: Hands;
  fromMeasure: number;
  toMeasure: number;
  tempo: number;
  activeSeconds: number;
  completed: boolean;
  rounds: number;
  correct: number;
  wrong: number;
  missed: number;
  points: number | null;
  bestCombo: number | null;
  accuracy: number;
}

export interface PracticeProgress {
  current: PracticeHistoryEntry;
  previous: PracticeHistoryEntry | null;
  comparable: boolean;
  pointsDelta: number | null;
  accuracyDelta: number | null;
  comboDelta: number | null;
}

export interface PracticeHistoryBest {
  points: number | null;
  accuracy: number | null;
  bestCombo: number | null;
}

export interface SongPracticeHistory {
  songId: string;
  mode: ScoredPracticeMode;
  attempts: number;
  completedAttempts: number;
  activeSeconds: number;
  recent: PracticeHistoryEntry[];
  leaderboard: PracticeHistoryEntry[];
  best: PracticeHistoryBest;
  progress: PracticeProgress | null;
  newBest: { points: boolean; accuracy: boolean; bestCombo: boolean };
}

export interface PracticeHistoryOptions {
  recentLimit?: number;
  leaderboardLimit?: number;
  conditions?: PracticeHistoryConditions;
}

export interface PracticeHistoryConditions {
  gameDifficulty?: "easy" | "standard" | "challenge";
  gameIntensity?: number;
  gameRulesVersion?: number;
  hands: Hands;
  fromMeasure: number;
  toMeasure: number;
  tempo: number;
  rounds?: number;
  completed?: boolean;
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0;

const optionalCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? count(value)
    : null;

const decimal = (value: number) => Math.round(value * 10) / 10;

/** Scores are derived from the existing persisted UserData.records. Older
 * records retain their accuracy; missing points/combos are never invented. */
export function practiceHistoryEntry(
  value: unknown,
): PracticeHistoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.songId !== "string" ||
    !record.songId ||
    (record.mode !== "wait" &&
      record.mode !== "rhythm" &&
      record.mode !== "game") ||
    typeof record.date !== "string" ||
    !Number.isFinite(Date.parse(record.date))
  )
    return null;
  const correct = count(record.correct),
    wrong = count(record.wrong),
    missed = count(record.missed),
    judged = correct + wrong + missed;
  // Starting a timer or loading a voice is not a scored practice attempt.
  if (!judged) return null;
  const fromMeasure = count(record.fromMeasure);
  return {
    id: record.id,
    songId: record.songId,
    title: typeof record.title === "string" ? record.title : record.songId,
    date: new Date(record.date).toISOString(),
    mode: record.mode,
    gameDifficulty:
      record.mode === "game" &&
      ["easy", "standard", "challenge"].includes(String(record.gameDifficulty))
        ? (record.gameDifficulty as PracticeHistoryEntry["gameDifficulty"])
        : undefined,
    gameIntensity:
      record.mode === "game" &&
      typeof record.gameIntensity === "number" &&
      Number.isFinite(record.gameIntensity) &&
      record.gameIntensity >= 1 &&
      record.gameIntensity <= 100
        ? Math.round(record.gameIntensity)
        : undefined,
    gameRulesVersion:
      record.mode === "game" && count(record.gameRulesVersion) > 0
        ? count(record.gameRulesVersion)
        : undefined,
    source:
      record.source === "midi" || record.source === "microphone"
        ? record.source
        : "keyboard",
    hands:
      record.hands === "right" || record.hands === "left"
        ? record.hands
        : "both",
    fromMeasure,
    toMeasure: Math.max(fromMeasure, count(record.toMeasure)),
    tempo: count(record.tempo),
    activeSeconds: count(record.activeSeconds),
    completed: record.completed === true,
    rounds: Math.max(1, count(record.rounds)),
    correct,
    wrong,
    missed,
    points: optionalCount(record.points),
    bestCombo: optionalCount(record.bestCombo),
    accuracy: decimal((correct / judged) * 100),
  };
}

function sameConditions(a: PracticeHistoryEntry, b: PracticeHistoryEntry) {
  return (
    a.songId === b.songId &&
    a.mode === b.mode &&
    (a.mode !== "game" ||
      (a.gameDifficulty === b.gameDifficulty &&
        a.gameIntensity === b.gameIntensity &&
        a.gameRulesVersion === b.gameRulesVersion)) &&
    a.hands === b.hands &&
    a.fromMeasure === b.fromMeasure &&
    a.toMeasure === b.toMeasure &&
    a.tempo === b.tempo &&
    a.rounds === b.rounds &&
    a.completed === b.completed
  );
}

export function practiceProgress(
  current: unknown,
  previous?: unknown,
): PracticeProgress | null {
  const latest = practiceHistoryEntry(current);
  if (!latest) return null;
  let earlier = practiceHistoryEntry(previous);
  if (earlier?.songId !== latest.songId || earlier.mode !== latest.mode)
    earlier = null;
  const comparable = !!earlier && sameConditions(latest, earlier);
  return {
    current: latest,
    previous: earlier,
    comparable,
    pointsDelta:
      comparable &&
      latest.completed &&
      latest.points !== null &&
      earlier!.points !== null
        ? latest.points - earlier!.points
        : null,
    accuracyDelta: comparable
      ? decimal(latest.accuracy - earlier!.accuracy)
      : null,
    comboDelta:
      comparable && latest.bestCombo !== null && earlier!.bestCombo !== null
        ? latest.bestCombo - earlier!.bestCombo
        : null,
  };
}

function bestOf(entries: readonly PracticeHistoryEntry[]): PracticeHistoryBest {
  const best: PracticeHistoryBest = {
    points: null,
    accuracy: null,
    bestCombo: null,
  };
  for (const entry of entries) {
    best.accuracy = Math.max(best.accuracy ?? 0, entry.accuracy);
    if (entry.points !== null)
      best.points = Math.max(best.points ?? 0, entry.points);
    if (entry.bestCombo !== null)
      best.bestCombo = Math.max(best.bestCombo ?? 0, entry.bestCombo);
  }
  return best;
}

function boundedLimit(value: unknown, fallback: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function matchesConditions(
  entry: PracticeHistoryEntry,
  conditions: PracticeHistoryConditions,
) {
  return (
    (entry.mode !== "game" ||
      (entry.gameDifficulty === conditions.gameDifficulty &&
        entry.gameIntensity === conditions.gameIntensity &&
        entry.gameRulesVersion === conditions.gameRulesVersion)) &&
    entry.hands === conditions.hands &&
    entry.fromMeasure === conditions.fromMeasure &&
    entry.toMeasure === conditions.toMeasure &&
    entry.tempo === conditions.tempo &&
    entry.rounds === (conditions.rounds ?? 1) &&
    (conditions.completed === undefined ||
      entry.completed === conditions.completed)
  );
}

function rankEntries(a: PracticeHistoryEntry, b: PracticeHistoryEntry) {
  return (
    (b.points ?? 0) - (a.points ?? 0) ||
    b.accuracy - a.accuracy ||
    (b.bestCombo ?? 0) - (a.bestCombo ?? 0) ||
    b.date.localeCompare(a.date)
  );
}

/** Pure view over the existing records, so app persistence, backup/export and
 * migration keep one source of truth. Lists are bounded; bests use all records. */
export function getSongPracticeHistory(
  records: unknown,
  songId: string,
  mode: ScoredPracticeMode,
  options: PracticeHistoryOptions = {},
): SongPracticeHistory {
  const seen = new Set<string>();
  const entries = (Array.isArray(records) ? records : [])
    .map(practiceHistoryEntry)
    .filter(
      (entry): entry is PracticeHistoryEntry =>
        !!entry &&
        entry.songId === songId &&
        entry.mode === mode &&
        (!options.conditions || matchesConditions(entry, options.conditions)),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  const latest = entries[0],
    previousBest = bestOf(entries.slice(1));
  return {
    songId,
    mode,
    attempts: entries.length,
    completedAttempts: entries.filter((entry) => entry.completed).length,
    activeSeconds: entries.reduce((sum, entry) => sum + entry.activeSeconds, 0),
    recent: entries.slice(0, boundedLimit(options.recentLimit, 20, 50)),
    leaderboard: entries
      .filter((entry) => entry.points !== null)
      .sort(rankEntries)
      .slice(0, boundedLimit(options.leaderboardLimit, 10, 20)),
    best: bestOf(entries),
    progress: latest ? practiceProgress(latest, entries[1]) : null,
    newBest: {
      points:
        !!latest &&
        latest.points !== null &&
        (previousBest.points === null || latest.points > previousBest.points),
      accuracy:
        !!latest &&
        (previousBest.accuracy === null ||
          latest.accuracy > previousBest.accuracy),
      bestCombo:
        !!latest &&
        latest.bestCombo !== null &&
        (previousBest.bestCombo === null ||
          latest.bestCombo > previousBest.bestCombo),
    },
  };
}

/** Keep recent activity and each song/mode's top ten scores in the existing
 * records array. Accuracy/combo personal bests are protected as well. Keeping
 * original objects preserves mistakes, legacy fields and backup/export data. */
export function retainPracticeRecords<T>(records: readonly T[]): T[] {
  const rows = records.map((record, index) => {
    const raw =
      record && typeof record === "object"
        ? (record as Record<string, unknown>)
        : null;
    const time = typeof raw?.date === "string" ? Date.parse(raw.date) : NaN;
    return {
      record,
      index,
      id: typeof raw?.id === "string" && raw.id ? raw.id : null,
      time: Number.isFinite(time) ? time : -Infinity,
      entry: practiceHistoryEntry(record),
    };
  });
  rows.sort((a, b) => b.time - a.time || a.index - b.index);
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (!row.id) return true;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const kept = new Set(unique.slice(0, 1000));
  const groups = new Map<string, typeof unique>();
  for (const row of unique) {
    if (!row.entry) continue;
    const key = JSON.stringify([row.entry.songId, row.entry.mode]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  // Protect both the full history and the default completed-only leaderboard.
  for (const group of [...groups.values()].flatMap((group) => [
    group,
    group.filter((row) => row.entry!.completed),
  ])) {
    if (!group.length) continue;
    const ranked = group
      .filter((row) => row.entry!.points !== null)
      .sort((a, b) => rankEntries(a.entry!, b.entry!));
    ranked.slice(0, 10).forEach((row) => kept.add(row));
    const accuracy = group.reduce((best, row) =>
      row.entry!.accuracy > best.entry!.accuracy ? row : best,
    );
    kept.add(accuracy);
    const combos = group.filter((row) => row.entry!.bestCombo !== null);
    if (combos.length)
      kept.add(
        combos.reduce((best, row) =>
          row.entry!.bestCombo! > best.entry!.bestCombo! ? row : best,
        ),
      );
  }
  return unique.filter((row) => kept.has(row)).map((row) => row.record);
}
