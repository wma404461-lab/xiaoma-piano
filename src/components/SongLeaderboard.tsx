import "../data/componentMessages";
import { useI18n, translate, getLocale } from "../lib/i18n";
import { useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import type { PracticeRecord, Song } from "../types";
import {
  getSongPracticeHistory,
  type PracticeHistoryEntry,
  type PracticeHistoryOptions,
  type ScoredPracticeMode,
  type SongPracticeHistory,
} from "../lib/practiceHistory";
import { Modal } from "./Modal";
import { songTitle } from "../lib/songLocale";

const signed = (value: number, unit: string) =>
  `${value > 0 ? "+" : ""}${value}${unit}`;
const dateText = (date: string) =>
  new Date(date).toLocaleString(getLocale() === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function conditionsText(entry: PracticeHistoryEntry) {
  const difficulty =
    entry.gameIntensity !== undefined
      ? translate("Intensity {value}", undefined, {
          value: entry.gameIntensity,
        }) + " · "
      : entry.gameDifficulty
        ? translate(
            entry.gameDifficulty === "easy"
              ? "Easy"
              : entry.gameDifficulty === "challenge"
                ? "Challenge"
                : "Standard",
          ) + " · "
        : "";
  return (
    difficulty +
    translate(
      "{hand} · {tempo} BPM · Measures {first}–{last}{rounds}",
      undefined,
      {
        hand: translate(
          entry.hands === "both"
            ? "Both hands"
            : entry.hands === "left"
              ? "Left hand"
              : "Right hand",
        ),
        tempo: entry.tempo,
        first: entry.fromMeasure + 1,
        last: entry.toMeasure + 1,
        rounds:
          entry.rounds > 1
            ? translate(" · {count} rounds", undefined, { count: entry.rounds })
            : "",
      },
    )
  );
}
export function PracticeProgressNote({
  history,
}: {
  history: SongPracticeHistory;
}) {
  const { t, locale } = useI18n();
  const progress = history.progress;
  if (!progress) return null;
  return (
    <div className="practice-progress-note" aria-label={t("Progress in this practice")}>
      <strong>
        {!progress.previous
          ? t("First practice recorded")
          : history.newBest.points && (progress.current.points ?? 0) > 0
            ? t("New score record for these settings")
            : t("Practice recorded")}
      </strong>
      <span>
        {t("Accuracy {accuracy}% · Best combo {combo}", {
          accuracy: progress.current.accuracy,
          combo: progress.current.bestCombo ?? "—",
        })}
      </span>
      {progress.comparable && progress.previous ? (
        <span>
          {t("Since last time: ")}
          {[
            progress.pointsDelta !== null
              ? signed(progress.pointsDelta, t(" points"))
              : null,
            progress.accuracyDelta !== null
              ? signed(progress.accuracyDelta, t(" percentage points"))
              : null,
            progress.comboDelta !== null
              ? signed(progress.comboDelta, t(" combo"))
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : (
        <span>
          {progress.previous
            ? t("Settings or completion differ. See your history to compare these attempts.")
            : t("This is your first record with these practice settings.")}
        </span>
      )}
    </div>
  );
}
export function SongLeaderboard({
  song,
  records,
  initialMode = "wait",
  conditions,
  onClose,
}: {
  song: Pick<Song, "id" | "title">;
  records: PracticeRecord[];
  initialMode?: ScoredPracticeMode;
  conditions?: PracticeHistoryOptions["conditions"];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState(initialMode);
  const [sameOnly, setSameOnly] = useState(true);
  const [includeIncomplete, setIncludeIncomplete] = useState(false);
  const scoredRecords = useMemo(
    () =>
      includeIncomplete
        ? records
        : records.filter((record) => record.completed),
    [records, includeIncomplete],
  );
  const all = useMemo(
    () => getSongPracticeHistory(scoredRecords, song.id, mode),
    [scoredRecords, song.id, mode],
  );
  const baseline = conditions ?? all.recent[0];
  const matching = useMemo(
    () =>
      getSongPracticeHistory(scoredRecords, song.id, mode, {
        conditions: baseline
          ? { ...baseline, completed: undefined }
          : undefined,
        recentLimit: 50,
      }),
    [scoredRecords, song.id, mode, baseline],
  );
  const recentHistory = useMemo(
    () =>
      getSongPracticeHistory(records, song.id, mode, {
        conditions:
          sameOnly && baseline
            ? { ...baseline, completed: undefined }
            : undefined,
      }),
    [records, song.id, mode, sameOnly, baseline],
  );
  const history = sameOnly ? matching : all;
  const trend = matching.recent.slice(0, 7).reverse();
  return (
    <Modal
      title={t("{song} · Scores", { song: songTitle(song, locale) })}
      onClose={onClose}
      wide
    >
      <div className="leaderboard-tools">
        <div className="segmented" aria-label={t("Scoring practice mode")}>
          {(
            [
              ["wait", t("Wait for Notes")],
              ["rhythm", t("Play in Time")],
              ["game", t("Piano game")],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={mode === value ? "selected" : ""}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="leaderboard-filter">
          <input
            type="checkbox"
            checked={sameOnly}
            onChange={(event) => setSameOnly(event.target.checked)}
          />
          {t("Same practice settings")}
        </label>
        <label className="leaderboard-filter">
          <input
            type="checkbox"
            checked={includeIncomplete}
            onChange={(event) => setIncludeIncomplete(event.target.checked)}
          />
          {t("Include unfinished attempts")}
        </label>
      </div>
      <p className="leaderboard-caption">
        {baseline
          ? conditionsText(baseline as PracticeHistoryEntry)
          : t("Recorded automatically after you start playing")}{" "}
        {t("· Scores are saved on this device")}
      </p>
      <div className="leaderboard-stats">
        <div>
          <strong>
            {history.best.points?.toLocaleString(
              locale === "en" ? "en-US" : "zh-CN",
            ) ?? "—"}
          </strong>
          <span>{t("Best score")}</span>
        </div>
        <div>
          <strong>
            {history.best.accuracy !== null ? `${history.best.accuracy}%` : "—"}
          </strong>
          <span>{t("Best accuracy")}</span>
        </div>
        <div>
          <strong>{history.best.bestCombo ?? "—"}</strong>
          <span>{t("Best combo")}</span>
        </div>
        <div>
          <strong>{recentHistory.attempts}</strong>
          <span>{t("Attempts")}</span>
        </div>
      </div>
      <PracticeProgressNote history={matching} />
      {trend.length > 0 && (
        <section
          className="practice-trend"
          aria-label={t("Accuracy trend for your last seven attempts")}
        >
          <h3>{t("Accuracy for the last {count} attempts with these settings", { count: trend.length })}</h3>
          <div className="practice-trend-bars">
            {trend.map((entry) => (
              <div
                key={entry.id}
                title={t("{date} · {accuracy}% · {points} points", {
                  date: dateText(entry.date),
                  accuracy: entry.accuracy,
                  points: entry.points ?? "—",
                })}
              >
                <span>{entry.accuracy}%</span>
                <div className="practice-trend-track">
                  <i style={{ height: `${Math.max(2, entry.accuracy)}%` }} />
                </div>
                <small>
                  {new Date(entry.date).toLocaleDateString(
                    locale === "en" ? "en-US" : "zh-CN",
                    {
                      month: "numeric",
                      day: "numeric",
                    },
                  )}
                </small>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="leaderboard-section">
        <h3>
          <Trophy size={17} />
          {t("Personal scores")}
          <small>{t("Top 10")}</small>
        </h3>
        {history.leaderboard.length ? (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>{t("Rank")}</th>
                <th>{t("Practice")}</th>
                <th>{t("Score")}</th>
                <th>{t("Performance")}</th>
              </tr>
            </thead>
            <tbody>
              {history.leaderboard.map((entry, index) => (
                <tr key={entry.id}>
                  <td>
                    <span className={`rank-number rank-${index + 1}`}>
                      {index + 1}
                    </span>
                  </td>
                  <td>
                    {dateText(entry.date)}
                    <small>{conditionsText(entry)}</small>
                    <small>
                      {entry.completed ? t("Section completed") : t("Section unfinished")}
                    </small>
                  </td>
                  <td>
                    <strong>
                      {entry.points?.toLocaleString(
                        locale === "en" ? "en-US" : "zh-CN",
                      )}
                    </strong>
                  </td>
                  <td>
                    {entry.accuracy}%
                    <small>
                      {t("{combo} combo", { combo: entry.bestCombo ?? "—" })}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="leaderboard-empty">
            {t(
              "No scores for these settings yet. Start a playing mode; finishing, restarting, or leaving saves your attempt.",
            )}
          </p>
        )}
        <p className="leaderboard-caption">
          {t(
            "Accuracy = completed note groups ÷ (completed groups + wrong attempts + skipped groups). Scores for unfinished practice vary with progress.",
          )}
        </p>
      </section>
      <section className="leaderboard-section">
        <h3>
          {t("Practice history")}
          <small>{t("Last 20 attempts")}</small>
        </h3>
        {recentHistory.recent.length ? (
          <div className="song-history-list">
            {recentHistory.recent.slice(0, 20).map((entry) => (
              <div key={entry.id} className="song-history-entry">
                <div>
                  <strong>{dateText(entry.date)}</strong>
                  <small>
                    {conditionsText(entry)} ·{" "}
                    {entry.completed ? t("Correct") : t("Unfinished")}
                  </small>
                </div>
                <span>
                  {t("{points} points", {
                    points:
                      entry.points?.toLocaleString(
                        locale === "en" ? "en-US" : "zh-CN",
                      ) ?? "—",
                  })}
                  <small>
                    {t("{accuracy}% · {combo} combo", {
                      accuracy: entry.accuracy,
                      combo: entry.bestCombo ?? "—",
                    })}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="leaderboard-empty">{t("Your practice history will appear here.")}</p>
        )}
      </section>
    </Modal>
  );
}
