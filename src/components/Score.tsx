import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Hands, Notation, Song } from "../types";
import { XmlScore } from "./XmlScore";
import { NumberedScore } from "./NumberedScore";
import { WaterfallScore, type PlaybackPosition } from "./WaterfallScore";
import { useScoreSwipe } from "../lib/scoreSwipe";

const StaffRow = lazy(() => import("./StaffRow"));

function ScoreView({
  song,
  notation,
  hands,
  currentMeasure,
  activeIds,
  statuses,
  from,
  to,
  onSelect,
  onPlayFrom,
  autoTurn,
  onManualTurn,
  running,
  playbackPosition,
}: {
  song: Song;
  notation: Notation;
  hands: Hands;
  currentMeasure: number;
  activeIds: string[];
  statuses: Record<string, string>;
  from: number;
  to: number;
  onSelect: (measure: number, beat?: number) => void;
  onPlayFrom?: (measure: number, beat?: number) => void;
  autoTurn: boolean;
  onManualTurn?: () => void;
  running: boolean;
  playbackPosition?: () => PlaybackPosition;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 300 });
  const [page, setPage] = useState(0);
  const perRow = Math.max(1, Math.min(4, Math.floor(size.width / 185)));
  const naturalHeight =
    hands === "both" ? 296 : notation === "hybrid" ? 216 : 190;
  const available = Math.max(45, size.height - 65);
  const perPage = Math.max(1, Math.floor(available / naturalHeight));
  const measuresPerPage = perRow * perPage;
  const pages = Math.ceil(song.measures.length / measuresPerPage);
  const safePage = Math.min(page, pages - 1);
  const turnPage = (direction: number) => {
    onManualTurn?.();
    setPage(Math.max(0, Math.min(pages - 1, safePage + direction)));
  };
  const swipe = useScoreSwipe(turnPage);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setSize({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [notation, song.xml]);
  useEffect(() => {
    if (autoTurn) setPage(Math.floor(currentMeasure / measuresPerPage));
  }, [currentMeasure, measuresPerPage, autoTurn, running]);
  const rows = Math.ceil(song.measures.length / perRow);
  const firstRow = safePage * perPage;
  const visibleRows = Math.min(perPage, rows - firstRow);
  if (notation === "waterfall")
    return (
      <WaterfallScore
        {...{
          song,
          hands,
          from,
          to,
          currentMeasure,
          onSelect,
          onPlayFrom,
          playbackPosition,
          statuses,
        }}
      />
    );
  if (notation === "numbered" || notation === "beginner")
    return (
      <NumberedScore
        beginner={notation === "beginner"}
        {...{
          song,
          hands,
          currentMeasure,
          activeIds,
          statuses,
          from,
          to,
          onSelect,
          onPlayFrom,
          autoTurn,
          onManualTurn,
          running,
        }}
      />
    );
  if (song.xml)
    return (
      <XmlScore
        song={song}
        notation={notation}
        hands={hands}
        currentMeasure={currentMeasure}
        activeIds={activeIds}
        statuses={statuses}
        from={from}
        to={to}
        onSelect={onSelect}
        onPlayFrom={onPlayFrom}
        autoTurn={autoTurn}
        onManualTurn={onManualTurn}
        running={running}
      />
    );
  return (
    <div className="score-content" ref={root} {...swipe}>
      <div className="score-page-body swipe-pages" data-page={safePage + 1}>
        {Array.from({ length: visibleRows }, (_, offset) => {
          const row = firstRow + offset;
          const first = row * perRow,
            count = Math.min(perRow, song.measures.length - first);
          return (
            <div className="score-row" data-score-row={row} key={first}>
              <div className="measure-labels">
                {Array.from({ length: count }, (_, i) => (
                  <button
                    type="button"
                    key={i}
                    className={`${currentMeasure === first + i ? "current" : ""} ${first + i < from || first + i > to ? "outside" : ""}`}
                    onClick={() => onSelect(first + i)}
                  >
                    <span>{String(first + i + 1).padStart(2, "0")}</span>
                    {currentMeasure === first + i && <i />}
                  </button>
                ))}
              </div>
              <Suspense
                fallback={
                  <div
                    className="staff-render score-render-loading"
                    role="status"
                    style={{
                      minHeight: Math.max(24, available / visibleRows - 32),
                    }}
                  >
                    {t("Loading staff notation…")}
                  </div>
                }
              >
                <StaffRow
                  song={song}
                  first={first}
                  count={count}
                  hands={hands}
                  hybrid={notation === "hybrid"}
                  maxHeight={available / visibleRows - 32}
                  activeIds={activeIds}
                  statuses={statuses}
                  onSelect={onSelect}
                  onPlayFrom={onPlayFrom}
                />
              </Suspense>
            </div>
          );
        })}
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
        <span aria-live="polite">
          {t("Page {page} / {pages} · Measures {first}–{last}", {
            page: safePage + 1,
            pages,
            first: safePage * measuresPerPage + 1,
            last: Math.min(
              song.measures.length,
              (safePage + 1) * measuresPerPage,
            ),
          })}
        </span>
        <button
          type="button"
          aria-label={t("Next score page")}
          disabled={safePage >= pages - 1}
          onClick={() => turnPage(1)}
        >
          <span>{t("Next")}</span>
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}

export const Score = memo(ScoreView);
