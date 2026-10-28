import "../data/componentMessages";
import { pitchStatus } from "../lib/practiceJudgement";
import { useI18n } from "../lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Hands, ScoreNote, Song } from "../types";
import { HAND_COLORS, HAND_TINTS } from "../lib/handColors";
import { numberedPitch, noteName } from "../lib/music";
import { countWork } from "../lib/diagnostics";
import { useScoreSwipe } from "../lib/scoreSwipe";
import { songTitle } from "../lib/songLocale";
import { scoreKeyLabel, scoreBlackKeyGuide } from "../lib/scoreUI";
import { createScoreNoteNavigator } from "../lib/scoreNoteNavigation";

export function NumberedScore({
  song,
  hands,
  currentMeasure,
  activeIds,
  statuses,
  from,
  to,
  autoTurn,
  onManualTurn,
  running,
  onSelect,
  onPlayFrom,
  beginner = false,
}: {
  song: Song;
  hands: Hands;
  currentMeasure: number;
  activeIds: string[];
  statuses: Record<string, string>;
  from: number;
  to: number;
  autoTurn: boolean;
  onManualTurn?: () => void;
  running: boolean;
  onSelect: (measure: number, beat?: number) => void;
  onPlayFrom?: (measure: number, beat?: number) => void;
  beginner?: boolean;
}) {
  const { t, locale } = useI18n();
  const callbacks = useRef({ onSelect, onPlayFrom });
  callbacks.current = { onSelect, onPlayFrom };
  const navigation = useMemo(
    () =>
      createScoreNoteNavigator(
        (measure, beat) => callbacks.current.onSelect(measure, beat),
        (measure, beat) =>
          (callbacks.current.onPlayFrom ?? callbacks.current.onSelect)(
            measure,
            beat,
          ),
      ),
    [],
  );
  const [page, setPage] = useState(currentMeasure);
  useEffect(() => {
    if (autoTurn) setPage(currentMeasure);
  }, [currentMeasure, autoTurn, running]);
  const safePage = Math.max(0, Math.min(page, song.measures.length - 1)),
    bar = song.measures[safePage];
  const { selected, onsets, groups, heights, width, height } = useMemo(() => {
    countWork("numberedLayoutBuilds");
    const selected = hands === "both" ? (["right", "left"] as const) : [hands];
    const onsets = [
      ...new Set(
        selected.flatMap((h) =>
          bar[h].filter(n => !beginner || n.pitches.length || n.beats >= 0.25)
            .map((n) => Math.round(n.beat * 1e6) / 1e6),
        ),
      ),
    ].sort((a, b) => a - b);
    const groups = selected.map((hand) =>
      onsets.map((beat) =>
        bar[hand].filter((n) => Math.abs(n.beat - beat) < 1e-5 &&
          (!beginner || n.pitches.length || n.beats >= 0.25)),
      ),
    );
    const displayPitches = (notes: ScoreNote[]) => {
      const entries = new Map<
        string,
        { pitch: number; numbered: { digit: string; octave: number } }
      >();
      for (const note of notes)
        for (const pitch of note.pitches) {
          const numbered = numberedPitch(
            pitch,
            beginner ? "C" : note.key ?? bar.key ?? song.key,
            note.spellings?.[pitch],
          );
          entries.set(`${pitch}:${numbered.digit}:${numbered.octave}`, {
            pitch,
            numbered,
          });
        }
      return [...entries.values()].sort((a, b) => b.pitch - a.pitch);
    };
    const pitches = (notes: ScoreNote[]) =>
      displayPitches(notes).map((entry) => entry.pitch);
    const heights = groups.map(
      (columns) =>
        Math.max(1, ...columns.map((notes) => pitches(notes).length)) * 42 + 74,
    );
    const width = Math.max(500, onsets.length * 60 + 80),
      height = heights.reduce((s, n) => s + n, 0) + 32;
    const columns = groups.map((hand) =>
      hand.map((notes) => {
        const displayed = displayPitches(notes),
          ps = displayed.map((entry) => entry.pitch);
        const duration = Math.min(
          ...notes
            .filter((n) => !ps.length || n.pitches.length)
            .map((n) => n.beats),
        );
        return {
          notes,
          ps,
          duration,
          numbered: displayed.length
            ? displayed.map((entry) => entry.numbered)
            : [{ digit: "0", octave: 0 }],
        };
      }),
    );
    return { selected, onsets, groups: columns, heights, width, height };
  }, [bar, hands, song.key, beginner]);
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const turnPage = (direction: number) => {
    onManualTurn?.();
    navigation.reset();
    setPage(
      Math.max(0, Math.min(song.measures.length - 1, safePage + direction)),
    );
  };
  const swipe = useScoreSwipe(turnPage);
  return (
    <div className={`score-content complex-numbered${beginner ? " beginner-numbered" : ""}`} {...swipe}>
      <div className="score-page-body swipe-pages" data-page={safePage + 1}>
        <div className="xml-measure-links">
          <button
            type="button"
            className="current"
            onClick={() => onSelect(safePage)}
          >
            {t("Measure {measure} · {signature}", {
              measure: safePage + 1,
              signature: bar.signature ?? song.signature ?? `${song.meter}/4`,
            })}
          </button>
          <span>
            {!beginner && <>{scoreKeyLabel(bar.key ?? song.key)} {t("· Stacked chord tones")}</>}
          </span>
        </div>
        {!beginner && <div className="numbered-key-guide">{scoreBlackKeyGuide(bar.key ?? song.key)}</div>}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t(beginner ? "{song}, measure {measure}, easy piano-key numbers" : "{song}, complete numbered notation for measure {measure}", {
            song: songTitle(song, locale),
            measure: safePage + 1,
          })}
          style={{ opacity: safePage < from || safePage > to ? 0.4 : 1 }}
        >
          {selected.map((hand, hi) => {
            const top = heights.slice(0, hi).reduce((s, n) => s + n, 0) + 12;
            return (
              <g key={hand}>
                <text x="8" y={top + 30} fontSize="15" fill="#88957b">
                  {locale === "en"
                    ? hand === "right"
                      ? "RH"
                      : "LH"
                    : hand === "right"
                      ? t("Right hand")
                      : t("Left hand")}
                </text>
                <line
                  x1="60"
                  x2={width - 12}
                  y1={top + heights[hi] - 15}
                  y2={top + heights[hi] - 15}
                  stroke="#e0e5d8"
                />
                {groups[hi].map(({ notes, ps, duration, numbered }, ci) => {
                  if (!notes.length) return null;
                  const x =
                    78 + (ci * (width - 100)) / Math.max(1, onsets.length);
                  const active = notes.some((n) => activeSet.has(n.id));
                  const wrong = notes.some((n) => statuses[n.id] === "wrong"),
                    correct = notes.some((n) => statuses[n.id] === "correct");
                  const color = wrong
                    ? "#b65f53"
                    : active
                      ? HAND_COLORS[hand]
                      : correct
                        ? "#507563"
                        : "#293c34";
                  return (
                    <g
                      key={ci}
                      className={`number-note ${active ? "active" : ""}`}
                      data-note-hand={hand}
                      role="button"
                      tabIndex={0}
                      aria-keyshortcuts={onPlayFrom ? "Shift+Enter" : undefined}
                      aria-label={t("Measure {measure}, beat {beat}, {hand}", {
                        measure: safePage + 1,
                        beat: onsets[ci] + 1,
                        hand: t(hand === "right" ? "Right hand" : "Left hand"),
                      })}
                      onClick={(event) =>
                        navigation.click(
                          safePage,
                          onsets[ci],
                          `${safePage}:${hand}:${ci}`,
                          event,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (e.key === "Enter" && e.shiftKey && onPlayFrom)
                            onPlayFrom(safePage, onsets[ci]);
                          else onSelect(safePage, onsets[ci]);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {notes.map((n) => (
                        <g data-note-id={n.id} key={n.id} />
                      ))}
                      {active && (
                        <rect
                          x={x - 21}
                          y={top}
                          width="44"
                          height={heights[hi] - 32}
                          rx="6"
                          fill={HAND_TINTS[hand]}
                        />
                      )}
                      {(ps.length ? ps : [null]).map((p, idx) => {
                        const pitch = numbered[idx],
                          y = top + 28 + idx * 42;
                        const tied =
                          p !== null &&
                          notes
                            .filter((n) => n.pitches.includes(p))
                            .every(
                              (n) =>
                                n.attackPitches && !n.attackPitches.includes(p),
                            );
                        const results =
                          p === null
                            ? []
                            : notes
                                .filter((note) => note.pitches.includes(p))
                                .map((note) =>
                                  pitchStatus(statuses, note.id, p),
                                );
                        const pitchColor = results.includes("wrong")
                          ? "#b65f53"
                          : results.includes("correct")
                            ? "#507563"
                            : color;
                        return (
                          <g
                            key={`${p ?? "rest"}-${idx}`}
                            data-midi={p ?? undefined}
                            data-numbered={pitch.digit}
                            data-octave={pitch.octave}
                            fill={pitchColor}
                            textAnchor="middle"
                          >
                            {p !== null && (
                              <title>
                                {t("{digit} · {note} (actual piano key)", {
                                  digit: pitch.digit,
                                  note: noteName(p),
                                })}
                              </title>
                            )}
                            {Array.from(
                              { length: Math.max(0, pitch.octave) },
                              (_, dot) => (
                                <circle
                                  key={`above-${dot}`}
                                  cx={x}
                                  cy={y - 17 - dot * 5}
                                  r="1.3"
                                />
                              ),
                            )}
                            <text
                              x={x}
                              y={y + 5}
                              className="numbered-digit"
                              fontSize={beginner ? 20 : 25}
                              fontFamily="Georgia,serif"
                            >
                              {beginner ? <><tspan fontSize="0.72em">{pitch.digit.slice(0, -1)}</tspan>{pitch.digit.slice(-1)}</> : pitch.digit}
                            </text>
                            {Array.from(
                              { length: Math.max(0, -pitch.octave) },
                              (_, dot) => (
                                <circle
                                  key={`below-${dot}`}
                                  cx={x}
                                  cy={y + 15 + dot * 5}
                                  r="1.3"
                                />
                              ),
                            )}
                            {tied && (
                              <path
                                d={`M${x - 12} ${y - 23} Q${x} ${y - 32} ${x + 12} ${y - 23}`}
                                stroke={pitchColor}
                                fill="none"
                              />
                            )}
                          </g>
                        );
                      })}
                      {duration < 1 &&
                        [
                          ...Array(
                            Math.min(
                              4,
                              Math.max(1, Math.ceil(-Math.log2(duration))),
                            ),
                          ),
                        ].map((_, i) => (
                          <line
                            key={i}
                            x1={x - 10}
                            x2={x + 10}
                            y1={top + heights[hi] - 49 + i * 3}
                            y2={top + heights[hi] - 49 + i * 3}
                            stroke={color}
                          />
                        ))}
                      <text
                        x={x}
                        y={top + heights[hi] - 25}
                        fontSize="9"
                        textAnchor="middle"
                        fill="#849078"
                      >
                        <>
                        {notes.some((n) => n.tuplet)
                          ? t("{count}-tuplet · ", {
                              count: notes.find((n) => n.tuplet)!.tuplet!,
                            })
                          : ""}
                        {t("{beats} beats", {
                          beats: Number(duration.toFixed(3)),
                        })}
                        </>
                      </text>
                    </g>
                  );
                })}
                <line
                  x1={width - 12}
                  x2={width - 12}
                  y1={top}
                  y2={top + heights[hi] - 16}
                  stroke="#96a28b"
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="score-pagination">
        <button
          type="button"
          aria-label={t("Previous score page")}
          disabled={safePage === 0}
          onClick={() => turnPage(-1)}
        >
          <ChevronLeft size={17} />
          <span>{t("Previous")}</span>
        </button>
        <span>
          {t("Page {page} / {pages} · Measure {measure}", {
            page: safePage + 1,
            pages: song.measures.length,
            measure: safePage + 1,
          })}
        </span>
        <button
          type="button"
          aria-label={t("Next score page")}
          disabled={safePage === song.measures.length - 1}
          onClick={() => turnPage(1)}
        >
          <span>{t("Next")}</span>
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
