import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { useEffect, useMemo, useRef } from "react";
import type { Hands, Song } from "../types";
import { HAND_COLORS } from "../lib/handColors";
import { getEvents, noteName } from "../lib/music";
import type { PerformancePlan } from "../lib/performance";
import { waterfallNotes } from "../lib/waterfall";
import { WaterfallNoteIndex } from "../lib/waterfallIndex";
import {
  WaterfallFrameClock,
  sameWaterfallBars,
  waterfallBar,
  waterfallPixelRatio,
  type WaterfallBar,
} from "../lib/waterfallFrame";
import { countWork, timeWork } from "../lib/diagnostics";
import { useTheme } from "../lib/theme";
import { songTitle } from "../lib/songLocale";
import { waterfallKeyboardKeys } from "../lib/waterfallKeyboard";
import { useScoreSwipe } from "../lib/scoreSwipe";
import { createScoreNoteNavigator } from "../lib/scoreNoteNavigation";
import { rangeTempoMap, TempoTimeline } from "../lib/tempo";
import { pitchStatus } from "../lib/practiceJudgement";

export type PlaybackPosition = {
  seconds?: number;
  plan?: PerformancePlan;
  beat?: number;
  moving?: boolean;
  clock?: TempoTimeline;
};
export function WaterfallScore({
  song,
  hands,
  from,
  to,
  currentMeasure,
  onSelect,
  onPlayFrom,
  playbackPosition,
  statuses = {},
}: {
  song: Song;
  hands: Hands;
  from: number;
  to: number;
  currentMeasure: number;
  onSelect: (measure: number, beat?: number) => void;
  onPlayFrom?: (measure: number, beat?: number) => void;
  playbackPosition?: () => PlaybackPosition;
  statuses?: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  const dark = useTheme() === "dark";
  const canvas = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(() => void) | null>(null);
  const props = useRef({
    playbackPosition,
    currentMeasure,
    onSelect,
    onPlayFrom,
    statuses,
  });
  props.current = {
    playbackPosition,
    currentMeasure,
    onSelect,
    onPlayFrom,
    statuses,
  };
  const navigation = useMemo(
    () =>
      createScoreNoteNavigator(
        (measure, beat) => props.current.onSelect(measure, beat),
        (measure, beat) =>
          (props.current.onPlayFrom ?? props.current.onSelect)(measure, beat),
      ),
    [],
  );
  const lastTap = useRef<{
    x: number;
    y: number;
    time: number;
    measure: number;
    beat: number;
    pitch: number;
  } | null>(null);
  const swipe = useScoreSwipe((direction) => {
    navigation.reset();
    lastTap.current = null;
    const measure = Math.max(
      from,
      Math.min(to, props.current.currentMeasure + direction),
    );
    if (measure !== props.current.currentMeasure)
      props.current.onSelect(measure);
  });
  useEffect(() => {
    wake.current?.();
  });
  const events = useMemo(
    () => getEvents(song, hands, from, to),
    [song, hands, from, to],
  );
  const fallbackClock = useMemo(
    () => new TempoTimeline(rangeTempoMap(song, from, to), song.tempo),
    [song, from, to],
  );
  const visibleHits = useRef<
    {
      x: number;
      y: number;
      width: number;
      height: number;
      measure: number;
      beat: number;
      pitch: number;
    }[]
  >([]);
  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d", { alpha: false })!;
    const background = document.createElement("canvas");
    const backgroundContext = background.getContext("2d", { alpha: false })!;
    let backgroundDirty = true;
    let plan: PerformancePlan | undefined;
    let timing = fallbackClock;
    let notes = waterfallNotes(song, events, undefined, timing);
    let index = new WaterfallNoteIndex(notes);
    const clock = new WaterfallFrameClock();
    const eventsByPosition = new Map(
      events.map((event) => [
        `${event.measure}:${event.localBeat ?? 0}`,
        event,
      ]),
    );
    let lastStatuses: Record<string, string> | undefined;
    let previousBars: WaterfallBar[] = [],
      nextBars: WaterfallBar[] = [];
    const gradients = new Map<string, CanvasGradient>();
    let frame = 0,
      geometryFrame = 0,
      width = 0,
      height = 0,
      density = 1,
      keys = new Map<number, { x: number; width: number }>();
    const whites = Array.from({ length: 88 }, (_, i) => i + 21).filter((p) =>
      [0, 2, 4, 5, 7, 9, 11].includes(p % 12),
    );
    const syncKeyboard = () => {
      const keyboard = document.querySelector<HTMLElement>(".full-keyboard");
      const keyboardRect = keyboard?.getBoundingClientRect();
      keys = waterfallKeyboardKeys(
        keyboardRect?.width ?? width,
        keyboardRect
          ? keyboardRect.left - element.getBoundingClientRect().left
          : 0,
      );
      countWork("waterfallKeyboardGeometryUpdates");
      backgroundDirty = true;
      requestDraw();
    };
    const measure = () => {
      const rect = element.getBoundingClientRect(),
        dpr = waterfallPixelRatio(rect.width, rect.height, devicePixelRatio);
      if (width === rect.width && height === rect.height && density === dpr)
        return;
      width = rect.width;
      height = rect.height;
      density = dpr;
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      background.width = element.width;
      background.height = element.height;
      backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      backgroundDirty = true;
      gradients.clear();
      countWork("waterfallResizes");
      syncKeyboard();
    };
    const keyboardMoved = (event: Event) => {
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.matches(".full-keyboard-strip .keyboard-viewport") ||
        geometryFrame ||
        document.hidden
      )
        return;
      geometryFrame = requestAnimationFrame(() => {
        geometryFrame = 0;
        syncKeyboard();
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", keyboardMoved, {
      capture: true,
      passive: true,
    });
    let lastSeconds = NaN;
    const requestDraw = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (!width || !height) {
        return;
      }
      const position = props.current.playbackPosition?.() ?? {
        beat:
          events.find((e) => e.measure === props.current.currentMeasure)
            ?.beat ?? 0,
      };
      const seconds =
        position.seconds ??
        (position.clock ?? fallbackClock).secondsAt(position.beat ?? 0);
      const nextTiming = position.clock ?? fallbackClock;
      if (!clock.due(now, backgroundDirty)) {
        requestDraw();
        return;
      }
      if (
        !backgroundDirty &&
        seconds === lastSeconds &&
        lastStatuses === props.current.statuses &&
        position.plan === plan &&
        nextTiming === timing
      ) {
        // The transport clock can stay at zero during pre-roll. Keep polling
        // while running: a long held note may not cause another React render.
        if (position.moving) requestDraw();
        return;
      }
      const endDraw = timeWork("waterfallDraw");
      lastSeconds = seconds;
      lastStatuses = props.current.statuses;
      if (position.plan !== plan || nextTiming !== timing) {
        plan = position.plan;
        timing = nextTiming;
        notes = waterfallNotes(song, events, plan, timing);
        index = new WaterfallNoteIndex(notes);
      }
      const horizon = 5,
        target = height - 28,
        scale = (target - 24) / horizon;
      let barCount = 0;
      for (const note of index.visible(seconds, horizon, 6 / scale)) {
        const key = keys.get(note.pitch);
        if (!key || key.x + key.width < 0 || key.x > width) continue;
        const bar = waterfallBar(
          note,
          key,
          seconds,
          target,
          scale,
          density,
          nextBars[barCount],
        );
        if (bar) {
          const judged =
            eventsByPosition
              .get(`${note.measure}:${note.beat}`)
              ?.noteIds.map((id) =>
                pitchStatus(props.current.statuses, id, note.pitch),
              ) ?? [];
          bar.judgement = judged.includes("wrong")
            ? "wrong"
            : judged.includes("correct")
              ? "correct"
              : undefined;
          nextBars[barCount++] = bar;
        }
      }
      nextBars.length = barCount;
      countWork("waterfallVisibilityQueries");
      countWork("waterfallIndexVisits", index.visitedNodes);
      if (!backgroundDirty && sameWaterfallBars(previousBars, nextBars)) {
        countWork("waterfallUnchangedFrames");
        endDraw();
        if (position.moving) requestDraw();
        return;
      }
      if (backgroundDirty) {
        const context = backgroundContext;
        countWork("waterfallBackgroundDraws");
        context.fillStyle = dark ? "#17231e" : "#fbfcf6";
        context.fillRect(0, 0, width, height);
        for (const pitch of whites) {
          const key = keys.get(pitch);
          if (!key) continue;
          context.strokeStyle = dark ? "#2d3c34" : "#e6eadf";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(key.x, 0);
          context.lineTo(key.x, height);
          context.stroke();
          if (pitch % 12 === 0 || pitch === 21) {
            context.fillStyle = dark ? "#aabcb0" : "#8a9985";
            context.font = "10px sans-serif";
            context.fillText(noteName(pitch), key.x + 2, height - 8);
          }
        }
        context.strokeStyle = "#b4894d";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(0, target);
        context.lineTo(width, target);
        context.stroke();
        context.fillStyle = dark ? "#aabcb0" : "#758b70";
        context.font = "12px sans-serif";
        context.fillStyle = HAND_COLORS.left;
        context.textAlign = "left";
        context.fillText(t("Left · orange"), 12, 18);
        context.fillStyle = dark ? "#aabcb0" : "#758b70";
        context.textAlign = "center";
        context.fillText(t("↓ Play at the line"), width / 2, 18);
        context.fillStyle = HAND_COLORS.right;
        context.textAlign = "right";
        context.fillText(t("Right · green"), width - 12, 18);
        context.textAlign = "left";
        backgroundDirty = false;
      }
      countWork("waterfallRasterFrames");
      // Opaque background covers the whole canvas, without a separate clear.
      context.drawImage(background, 0, 0, width, height);
      let hitCount = 0;
      for (const bar of nextBars) {
        const {
          note,
          x,
          y,
          width: w,
          height: h,
          bottom,
          active,
          leading,
        } = bar;
        const { pitch, hand } = note;
        context.fillStyle =
          hand === "left"
            ? active
              ? HAND_COLORS.left
              : "#edcea4"
            : active
              ? HAND_COLORS.right
              : "#a7cfb8";
        if (bar.judgement)
          context.fillStyle =
            bar.judgement === "wrong"
              ? dark
                ? "#ed9183"
                : "#c46a5e"
              : dark
                ? "#74b594"
                : "#507563";
        if (hand === "both" && !bar.judgement) {
          const key = `${pitch}:${active}`;
          let gradient = gradients.get(key);
          if (!gradient) {
            gradient = context.createLinearGradient(x, 0, x + w, 0);
            gradient.addColorStop(0, active ? HAND_COLORS.left : "#edcea4");
            gradient.addColorStop(0.499, active ? HAND_COLORS.left : "#edcea4");
            gradient.addColorStop(0.5, active ? HAND_COLORS.right : "#a7cfb8");
            gradient.addColorStop(1, active ? HAND_COLORS.right : "#a7cfb8");
            gradients.set(key, gradient);
          }
          context.fillStyle = gradient;
        }
        context.beginPath();
        if (typeof context.roundRect === "function")
          context.roundRect(x, y, w, h, Math.min(6, w / 2, h / 2));
        else context.rect(x, y, w, h);
        context.fill();
        // The leading edge marks a fresh key press, including short repeated notes.
        if (leading) {
          context.fillStyle =
            bar.judgement === "wrong"
              ? "#c46a5e"
              : hand === "left"
                ? HAND_COLORS.left
                : HAND_COLORS.right;
          const mark = Math.min(2, h / 2);
          context.fillRect(x + 1, bottom - mark, Math.max(1, w - 2), mark);
          context.fillStyle = "#fffef5";
          context.beginPath();
          context.arc(
            x + w / 2,
            bottom - Math.min(3, h / 2),
            Math.min(2, w / 4, h / 4),
            0,
            Math.PI * 2,
          );
          context.fill();
        } else if (active) {
          context.fillStyle = "#fffef5";
          context.beginPath();
          context.arc(
            x + w / 2,
            target - Math.min(3, h / 2),
            Math.min(2, w / 4, h / 4),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        const hit = visibleHits.current[hitCount] ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          measure: 0,
          beat: 0,
          pitch: 0,
        };
        hit.x = x;
        hit.y = y;
        hit.width = w;
        hit.height = h;
        hit.measure = note.measure;
        hit.beat = note.beat;
        hit.pitch = note.pitch;
        visibleHits.current[hitCount++] = hit;
      }
      visibleHits.current.length = hitCount;
      [previousBars, nextBars] = [nextBars, previousBars];
      endDraw();
      if (position.moving) requestDraw();
    };
    wake.current = requestDraw;
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        syncKeyboard();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    measure();
    return () => {
      wake.current = null;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(geometryFrame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", keyboardMoved, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [events, song, dark, locale, fallbackClock]);
  return (
    <div className="waterfall-score score-content" {...swipe}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t("{song}, 88-key waterfall; orange for the left hand and green for the right hand", {
          song: songTitle(song, locale),
        })}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect(),
            x = event.clientX - rect.left,
            y = event.clientY - rect.top;
          const time = performance.now(),
            previous = lastTap.current;
          const repeat =
            previous &&
            time - previous.time <= 350 &&
            Math.hypot(x - previous.x, y - previous.y) <= 24;
          let hit: { measure: number; beat: number; pitch: number } | null =
            repeat ? previous : null;
          if (!hit)
            for (let i = visibleHits.current.length - 1; i >= 0; i--) {
              const candidate = visibleHits.current[i];
              if (
                x >= candidate.x &&
                x <= candidate.x + candidate.width &&
                y >= candidate.y &&
                y <= candidate.y + candidate.height
              ) {
                hit = candidate;
                break;
              }
            }
          if (hit) {
            // Selection moves the falling bars. Preserve the first tapped
            // target for a second tap at the same screen position.
            navigation.click(
              hit.measure,
              hit.beat,
              `${hit.measure}:${hit.beat}:${hit.pitch}`,
              event,
            );
            lastTap.current = repeat
              ? null
              : {
                  x,
                  y,
                  time,
                  measure: hit.measure,
                  beat: hit.beat,
                  pitch: hit.pitch,
                };
          } else lastTap.current = null;
        }}
      />
      <div className="waterfall-caption">
        {t(
          "Measure {measure} / {total} · Dots mark attacks; long bars mark held notes · Click to select; double-click to play · Swipe to change measures",
          { measure: currentMeasure + 1, total: song.measures.length },
        )}
      </div>
    </div>
  );
}
