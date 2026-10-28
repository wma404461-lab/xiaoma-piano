import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Hands, Notation, Song } from "../types";
import { prepareSongXmlPages } from "../lib/xmlPages";
import { numberedPitch } from "../lib/music";
import { timeWork } from "../lib/diagnostics";
import { useNoteHighlight } from "../lib/noteHighlight";
import { createXmlRenderer } from "../lib/xmlRenderer";
import { useScoreSwipe } from "../lib/scoreSwipe";
import { songTitle } from "../lib/songLocale";
import { scoreKeyLabel } from "../lib/scoreUI";
import { useStaffAppearance } from "../lib/staffAppearance";

type Props = {
  song: Song;
  notation: Notation;
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
};
export function XmlScore({
  song,
  notation,
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
}: Props) {
  const { t, locale } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const playCallback = useRef(onPlayFrom);
  playCallback.current = onPlayFrom;
  // Wait for the actual viewport instead of engraving an 800px throwaway page.
  const [size, setSize] = useState({ width: 0, height: 300 });
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const getPageXml = useMemo(() => prepareSongXmlPages(song), [song]);
  const count = Math.max(1, Math.min(4, Math.floor(size.width / 240)));
  const pages = Math.ceil(song.measures.length / count);
  const safePage = Math.min(page, pages - 1),
    first = safePage * count;
  const visible = Math.min(count, song.measures.length - first);
  const renderer = useMemo(
    () =>
      createXmlRenderer(
        song,
        getPageXml,
        size.width,
        (measure, beat) => callback.current(measure, beat),
        onPlayFrom
          ? (measure, beat) => playCallback.current?.(measure, beat)
          : undefined,
      ),
    [song, getPageXml, size.width, Boolean(onPlayFrom)],
  );
  useEffect(() => () => renderer.dispose(), [renderer]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize((previous) => {
        const width = Math.floor(entry.contentRect.width),
          height = entry.contentRect.height;
        return previous.width === width && previous.height === height
          ? previous
          : { width, height };
      }),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (autoTurn) setPage(Math.floor(currentMeasure / count));
  }, [autoTurn, currentMeasure, count, running]);
  useEffect(() => {
    if (!host.current || !song.xml || !size.width) return;
    let cancelled = false;
    let idle = 0,
      timeout: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError("");
    void renderer
      .get(first, visible)
      .then((container) => {
        if (cancelled) return;
        const endSwap = timeWork("xmlPageSwap");
        host.current?.replaceChildren(container);
        endSwap();
        setVersion((v) => v + 1);
        setLoading(false);
        const next = first + count;
        if (next < song.measures.length) {
          const prepare = () => {
            if (!cancelled)
              void renderer
                .get(next, Math.min(count, song.measures.length - next))
                .catch(() => {});
          };
          if ("requestIdleCallback" in window)
            idle = window.requestIdleCallback(prepare);
          else timeout = setTimeout(prepare, 250);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError((reason as Error).message || "Unable to lay out the score. Please try again.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(idle);
      clearTimeout(timeout);
    };
  }, [song, renderer, first, visible, count, size.width]);
  useNoteHighlight(host, activeIds, statuses, version);
  useStaffAppearance(host, activeIds, statuses, version);
  useEffect(() => {
    host.current?.querySelector("svg")?.setAttribute(
      "aria-label",
      t("{song}, complete staff notation for measures {first}–{last}", {
        song: songTitle(song, locale),
        first: first + 1,
        last: first + visible,
      }),
    );
  }, [version, locale, song, first, visible]);
  const turnPage = (direction: number) => {
    onManualTurn?.();
    setPage(Math.max(0, Math.min(pages - 1, safePage + direction)));
  };
  const swipe = useScoreSwipe(turnPage);
  return (
    <div className="xml-score score-content" ref={root}>
      <div
        className="score-page-body swipe-pages"
        data-page={safePage + 1}
        {...swipe}
      >
        <div className="xml-measure-links">
          {Array.from({ length: visible }, (_, i) => (
            <button
              type="button"
              key={i}
              className={`${currentMeasure === first + i ? "current" : ""} ${first + i < from || first + i > to ? "outside" : ""}`}
              onClick={() => onSelect(first + i)}
            >
              {t("Measure {measure}", { measure: first + i + 1 })}
            </button>
          ))}
        </div>
        <div className="xml-staff" ref={host} />
        {loading && (
          <span className="xml-loading" role="status">
            {t("Laying out the complete score…")}
          </span>
        )}
        {error && (
          <span className="xml-error" role="alert">
            {t(error)}
          </span>
        )}
        {notation === "hybrid" && (
          <div className="xml-number-guide">
            <span>
              {t("Current notes ·")}{" "}
              {scoreKeyLabel(song.measures[currentMeasure]?.key ?? song.key)}
            </span>
            <strong>
              {song.measures[currentMeasure]?.right
                .concat(song.measures[currentMeasure]?.left ?? [])
                .filter((n) => activeIds.includes(n.id))
                .flatMap((note) =>
                  note.pitches.map((p) => {
                    const n = numberedPitch(
                      p,
                      note.key ??
                        song.measures[currentMeasure]?.key ??
                        song.key,
                      note.spellings?.[p],
                    );
                    return `${n.digit}${n.octave > 0 ? "⁺".repeat(n.octave) : n.octave < 0 ? "₋".repeat(-n.octave) : ""}`;
                  }),
                )
                .join(" · ") || "—"}
            </strong>
          </div>
        )}
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
          {t("Page {page} / {pages} · Measures {first}–{last}", {
            page: safePage + 1,
            pages,
            first: first + 1,
            last: first + visible,
          })}
        </span>
        <button
          type="button"
          aria-label={t("Next score page")}
          disabled={safePage === pages - 1}
          onClick={() => turnPage(1)}
        >
          <span>{t("Next")}</span>
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
