import "../data/componentMessages";
import { useI18n } from "../lib/i18n";
import { noteName } from "../lib/music";
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  LocateFixed,
} from "lucide-react";
import { countWork } from "../lib/diagnostics";
import { sameArray } from "../lib/arrays";
import { PianoGesture } from "../lib/pianoGesture";
const WHITE = [0, 2, 4, 5, 7, 9, 11];
const KEY_MAP: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
  o: 73,
  l: 74,
  p: 75,
  ";": 76,
};
const PianoKey = memo(function PianoKey({
  pitch,
  full,
  white,
  label,
  hint,
  attack,
  pressed,
  style,
  onNote,
  onRelease,
}: {
  pitch: number;
  full: boolean;
  white: boolean;
  label: string;
  hint: string;
  attack?: string;
  pressed: boolean;
  style?: React.CSSProperties;
  onNote: (pitch: number, owner?: string) => void;
  onRelease: (pitch: number, owner?: string) => void;
}) {
  const { t } = useI18n();
  countWork("keyButtonWork");
  const owner = useId();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!attack || !hint || hint === "hint-wrong") return;
    const flash = button.current?.animate?.(
      [{filter:"brightness(1.8)",boxShadow:"inset 0 0 0 2px rgba(255,255,255,.9)"}, {filter:"brightness(1)"}],
      {duration:95,easing:"ease-out"},
    );
    return () => flash?.cancel();
  }, [attack, hint]);
  const activation = useRef<number | undefined>(undefined);
  const releaseHandler = useRef(onRelease);
  releaseHandler.current = onRelease;
  useEffect(
    () => () => {
      clearTimeout(activation.current);
      if (activation.current) releaseHandler.current(pitch, owner);
    },
    [pitch, owner],
  );
  return (
    <button
      ref={button}
      type="button"
      data-midi={pitch}
      title={noteName(pitch)}
      aria-label={`${full ? t("Play") : t("Play enlarged key")} ${noteName(pitch)}`}
      className={`${white ? "white-key" : "black-key"} ${hint} ${pressed ? "pressed" : ""} ${hint ? "expected" : ""}`}
      style={style}
      onClick={(event) => {
        if (event.detail === 0) {
          onNote(pitch, owner);
          clearTimeout(activation.current);
          activation.current = window.setTimeout(() => {
            onRelease(pitch, owner);
            activation.current = undefined;
          }, 100);
        }
      }}
    >
      <span>{label}</span>
      {white && hint && <i />}
    </button>
  );
});
export function Keybed({
  low,
  high,
  expected,
  hintEvent,
  rightHints = [],
  leftHints = [],
  pressed,
  wrongPitches = [],
  held = [],
  showHints,
  onNote,
  onRelease,
  full = false,
}: {
  low: number;
  high: number;
  expected: number[];
  hintEvent?: string;
  rightHints?: number[];
  leftHints?: number[];
  pressed: number | null;
  wrongPitches?: readonly number[];
  held?: readonly number[];
  showHints: boolean;
  onNote: (pitch: number, owner?: string) => void;
  onRelease: (pitch: number, owner?: string) => void;
  full?: boolean;
}) {
  const { t } = useI18n();
  countWork("keybedRenders");
  const keybed = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onNote, onRelease });
  handlers.current = { onNote, onRelease };
  const owner = useId();
  const gesture = useRef<PianoGesture | null>(null);
  gesture.current ??= new PianoGesture(
    owner,
    (x, y) => {
      const button = document
        .elementFromPoint(x, y)
        ?.closest<HTMLButtonElement>("button[data-midi]");
      return button && keybed.current?.contains(button)
        ? Number(button.dataset.midi)
        : null;
    },
    (pitch, owner) => handlers.current.onNote(pitch, owner),
    (pitch, owner) => handlers.current.onRelease(pitch, owner),
  );
  // Keep the enlarged keybed stationary beneath a finger during a slide.
  const range = useRef({ low, high });
  if (!gesture.current.active) range.current = { low, high };
  const displayLow = range.current.low,
    displayHigh = range.current.high;
  useEffect(() => {
    const clear = () => gesture.current?.clear();
    const hidden = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clear();
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const geometry = useMemo(() => {
    const pitches = Array.from(
      { length: displayHigh - displayLow + 1 },
      (_, i) => displayLow + i,
    );
    const whites = pitches.filter((n) => WHITE.includes(n % 12));
    const blacks = pitches
      .filter((n) => !WHITE.includes(n % 12))
      .map((pitch) => ({
        pitch,
        style: {
          left: `${(whites.filter((n) => n < pitch).length / whites.length) * 100}%`,
          width: `${(100 / whites.length) * 0.62}%`,
        },
      }));
    return { whites, blacks };
  }, [displayLow, displayHigh]);
  const expectedSet = useMemo(() => new Set(expected), [expected]);
  const rightSet = useMemo(() => new Set(rightHints), [rightHints]);
  const leftSet = useMemo(() => new Set(leftHints), [leftHints]);
  const heldSet = useMemo(() => new Set(held), [held]);
  const wrongSet = useMemo(() => new Set(wrongPitches), [wrongPitches]);
  const label = (pitch: number) =>
    full
      ? pitch % 12 === 0 || pitch === displayLow
        ? noteName(pitch)
        : ""
      : noteName(pitch);
  const hintClass = (pitch: number) =>
    wrongSet.has(pitch)
      ? "hint-wrong"
      : !showHints || !expectedSet.has(pitch)
        ? ""
        : rightSet.has(pitch) && leftSet.has(pitch)
          ? "hint-both"
          : leftSet.has(pitch)
            ? "hint-left"
            : "hint-right";
  return (
    <div
      ref={keybed}
      className={`piano-keyboard ${full ? "full-keyboard" : "focus-keyboard"}`}
      aria-label={full ? t("Full 88-key piano, A0 to C8") : t("Enlarged practice keyboard")}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current?.start(event.pointerId, event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        gesture.current?.move(event.pointerId, event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        gesture.current?.move(event.pointerId, event.clientX, event.clientY);
        gesture.current?.end(event.pointerId);
      }}
      onPointerCancel={(event) => gesture.current?.end(event.pointerId)}
      onLostPointerCapture={(event) => gesture.current?.end(event.pointerId)}
    >
      <div className="white-keys">
        {geometry.whites.map((pitch) => (
          <PianoKey
            key={pitch}
            pitch={pitch}
            full={full}
            white
            label={label(pitch)}
            hint={hintClass(pitch)}
            attack={expectedSet.has(pitch) ? hintEvent : undefined}
            pressed={pressed === pitch || heldSet.has(pitch)}
            onNote={onNote}
            onRelease={onRelease}
          />
        ))}
      </div>
      <div className="black-keys">
        {geometry.blacks.map(({ pitch, style }) => (
          <PianoKey
            key={pitch}
            pitch={pitch}
            full={full}
            white={false}
            label={full ? "" : noteName(pitch)}
            hint={hintClass(pitch)}
            attack={expectedSet.has(pitch) ? hintEvent : undefined}
            pressed={pressed === pitch || heldSet.has(pitch)}
            style={style}
            onNote={onNote}
            onRelease={onRelease}
          />
        ))}
      </div>
    </div>
  );
}
function ScrollableKeybed({
  children,
  anchor,
  held,
  full = false,
}: {
  children: ReactNode;
  anchor: number;
  held: readonly number[];
  full?: boolean;
}) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const viewportId = useId();
  const initialPosition = useRef(false);
  const currentAnchor = useRef(anchor);
  currentAnchor.current = anchor;
  const pointers = useRef(new Set<number>());
  const [scroll, setScroll] = useState({ left: 0, max: 0 });
  const measure = () => {
    const element = viewport.current;
    if (!element) return;
    const next = {
      left: Math.round(element.scrollLeft),
      max: Math.max(0, Math.round(element.scrollWidth - element.clientWidth)),
    };
    setScroll((previous) =>
      previous.left === next.left && previous.max === next.max
        ? previous
        : next,
    );
  };
  const center = (pitch: number) => {
    const element = viewport.current;
    const key = element?.querySelector<HTMLButtonElement>(
      `button[data-midi="${pitch}"]`,
    );
    if (!element || !key || pointers.current.size) return;
    const bounds = key.getBoundingClientRect();
    element.scrollLeft +=
      bounds.left -
      element.getBoundingClientRect().left +
      bounds.width / 2 -
      element.clientWidth / 2;
    measure();
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      // Position once; advancing a note must never move keys beneath a finger.
      if (!initialPosition.current && element.clientWidth > 0) {
        initialPosition.current = true;
        center(currentAnchor.current);
      }
      measure();
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    const clearPointers = () => pointers.current.clear();
    const hidden = () => {
      if (document.hidden) clearPointers();
    };
    window.addEventListener("blur", clearPointers);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      observer.disconnect();
      clearPointers();
      window.removeEventListener("blur", clearPointers);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const move = (left: number) => {
    if (!viewport.current || pointers.current.size) return;
    viewport.current.scrollLeft = left;
    measure();
  };
  const busy = held.length > 0;
  return (
    <div
      className={`keyboard-strip ${full ? "full-keyboard-strip" : "focus-keyboard-strip"}`}
    >
      <div
        id={viewportId}
        ref={viewport}
        className="keyboard-viewport"
        onScroll={measure}
        onPointerDownCapture={(event) => {
          if ((event.target as HTMLElement).closest("button[data-midi]"))
            pointers.current.add(event.pointerId);
        }}
        onPointerUpCapture={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancelCapture={(event) =>
          pointers.current.delete(event.pointerId)
        }
        onLostPointerCapture={(event) =>
          pointers.current.delete(event.pointerId)
        }
      >
        {children}
      </div>
      {scroll.max > 1 && (
        <div
          className="keyboard-navigation"
          aria-label={full ? t("Full keyboard range") : t("Enlarged keyboard range")}
        >
          {scroll.max > 1 && (
            <>
              <button
                type="button"
                aria-label={t("Move to lower notes")}
                aria-controls={viewportId}
                disabled={busy || scroll.left <= 0}
                onClick={() =>
                  move(
                    scroll.left - (viewport.current?.clientWidth ?? 0) * 0.65,
                  )
                }
              >
                <ChevronLeft size={17} />
              </button>
              <input
                type="range"
                min="0"
                max={scroll.max}
                step="1"
                value={Math.min(scroll.left, scroll.max)}
                aria-label={
                  full ? t("Move the full keyboard range") : t("Move the enlarged keyboard range")
                }
                aria-controls={viewportId}
                aria-valuetext={t("Low to high, position {percent}%", {
                  percent: Math.round((scroll.left / scroll.max) * 100),
                })}
                disabled={busy}
                onChange={(event) => move(Number(event.target.value))}
              />
              <button
                type="button"
                aria-label={t("Move to higher notes")}
                aria-controls={viewportId}
                disabled={busy || scroll.left >= scroll.max}
                onClick={() =>
                  move(
                    scroll.left + (viewport.current?.clientWidth ?? 0) * 0.65,
                  )
                }
              >
                <ChevronRight size={17} />
              </button>
              <button
                type="button"
                className="keyboard-locate"
                aria-label={t("Center on the current note")}
                title={t("Center on the current note")}
                aria-controls={viewportId}
                disabled={busy}
                onClick={() => center(currentAnchor.current)}
              >
                <LocateFixed size={15} />
                <span>{t("Current note")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function KeyboardView({
  expected,
  hintEvent,
  rightHints = [],
  leftHints = [],
  pressed,
  wrongPitches = [],
  held = [],
  showHints,
  onNote,
  onRelease,
  expanded = false,
}: {
  expected: number[];
  hintEvent?: string;
  rightHints?: number[];
  leftHints?: number[];
  pressed: number | null;
  wrongPitches?: readonly number[];
  held?: readonly number[];
  showHints: boolean;
  onNote: (pitch: number, owner?: string) => void;
  onRelease: (pitch: number, owner?: string) => void;
  expanded?: boolean;
}) {
  const handler = useRef({ onNote, onRelease });
  handler.current = { onNote, onRelease };
  useEffect(() => {
    const downKeys = new Set<string>();
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const tag = (event.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      const pitch = KEY_MAP[event.key.toLowerCase()];
      if (pitch !== undefined) {
        event.preventDefault();
        downKeys.add(event.key.toLowerCase());
        handler.current.onNote(pitch, `computer:${event.key.toLowerCase()}`);
      }
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (downKeys.delete(key))
        handler.current.onRelease(KEY_MAP[key], `computer:${key}`);
    };
    const releaseAll = () => {
      downKeys.forEach((key) =>
        handler.current.onRelease(KEY_MAP[key], `computer:${key}`),
      );
      downKeys.clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, []);
  const anchor = pressed ?? (expected.length ? Math.max(...expected) : 60);
  const low = Math.max(21, Math.min(84, Math.floor((anchor - 5) / 12) * 12));
  const high = Math.min(108, low + 24);
  const props = {
    expected,
    hintEvent,
    rightHints,
    leftHints,
    pressed,
    wrongPitches,
    held,
    showHints,
    onNote,
    onRelease,
  };
  return (
    <div className={`keyboard-panel ${expanded ? "expanded" : ""}`}>
      <ScrollableKeybed anchor={anchor} held={held} full>
        <Keybed low={21} high={108} full {...props} />
      </ScrollableKeybed>
      {expanded && (
        <ScrollableKeybed anchor={anchor} held={held}>
          <Keybed low={low} high={high} {...props} />
        </ScrollableKeybed>
      )}
    </div>
  );
}

export const Keyboard = memo(
  KeyboardView,
  (a, b) =>
    a.hintEvent === b.hintEvent &&
    a.pressed === b.pressed &&
    a.expanded === b.expanded &&
    a.showHints === b.showHints &&
    a.onNote === b.onNote &&
    a.onRelease === b.onRelease &&
    sameArray(a.held, b.held) &&
    sameArray(a.wrongPitches, b.wrongPitches) &&
    sameArray(a.expected, b.expected) &&
    sameArray(a.rightHints, b.rightHints) &&
    sameArray(a.leftHints, b.leftHints),
);
