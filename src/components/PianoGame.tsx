import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  Trophy,
} from "lucide-react";
import type { Hands, PracticeMode, PracticeRecord, Song } from "../types";
import { Keybed } from "./Keyboard";
import { AnimatedSegmented } from "./AnimatedSegmented";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { SongLeaderboard } from "./SongLeaderboard";
import { AnimatedToast } from "./AnimatedToast";
import {
  PianoGameEngine,
  gameKeySlots,
  gameKeyCapacity,
  GAME_PREVIEW_SECONDS,
} from "../lib/pianoGame";
import { PianoGameDemo } from "../lib/pianoGameDemo";
import { noteName } from "../lib/music";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { songTitle } from "../lib/songLocale";
import {
  getPianoVoice,
  playPiano,
  playPianoKey,
  preparePianoNotes,
  readyAudio,
  releasePianoKey,
  setPianoVoice,
  stopPlayback,
} from "../lib/audio";
import { PIANO_VOICES, type PianoVoice } from "../lib/pianoVoices";
import "../data/practiceMessages";

type Phase = "ready" | "loading" | "playing" | "paused" | "finished";
const COMPUTER_KEYS: Record<string, number> = {
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

export function PianoGame({
  song,
  initialHands,
  initialTempo,
  onMode,
  onExit,
  onSave,
  records,
  notify,
  toast,
}: {
  song: Song;
  initialHands: Hands;
  initialTempo: number;
  onMode: (mode: PracticeMode) => void;
  onExit: () => void;
  onSave: (record: PracticeRecord) => void;
  records: PracticeRecord[];
  notify: (text: string) => void;
  toast: string;
}) {
  const { t, locale } = useI18n();
  const dark = useTheme() === "dark";
  const [hands, setHands] = useState<Hands>(
    initialHands === "both" ? "right" : initialHands,
  );
  const [tempo, setTempo] = useState(initialTempo);
  const [voice, setVoice] = useState(getPianoVoice);
  const game = useRef<PianoGameEngine | null>(null);
  game.current ??= new PianoGameEngine(song, hands, tempo);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const phaseChange = (value: Phase) => {
    phaseRef.current = value;
    setPhaseState(value);
  };
  const [hud, setHud] = useState({
    points: 0,
    combo: 0,
    best: 0,
    progress: 0,
    feedback: "Play the piano keys as the notes reach the line",
  });
  const [held, setHeld] = useState<number[]>([]);
  const owners = useRef(new Map<number, Set<string>>());
  const [ranges, setRanges] = useState(() =>
    gameKeySlots(game.current!.visiblePitches(0)),
  );
  const rangesRef = useRef(ranges);
  const [capacity, setCapacity] = useState(() =>
    gameKeyCapacity(game.current!.notes),
  );
  const [columns, setColumns] = useState(2);
  const [demonstrating, setDemonstrating] = useState(false);
  const demo = useRef<PianoGameDemo | null>(null);
  const demoSounds = useRef(new Set<number>());
  const [leaderboard, setLeaderboard] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const elapsed = useRef(-3.2);
  const generation = useRef(0);
  const mounted = useRef(true);
  const saved = useRef(false);
  const callbacks = useRef({ onSave, notify, hands, tempo });
  callbacks.current = { onSave, notify, hands, tempo };
  const draw = useRef<(() => void) | null>(null);
  const publish = useCallback(() => {
    const e = game.current!;
    setHud({
      points: e.score.points,
      combo: e.score.combo,
      best: e.score.bestCombo,
      progress: e.progress,
      feedback: e.feedback,
    });
    if (demo.current) setHeld(demo.current.pressedPitches(elapsed.current));
    const next = gameKeySlots(
      [
        ...e.visiblePitches(Math.max(0, elapsed.current)),
        ...owners.current.keys(),
      ],
      rangesRef.current,
    );
    if (JSON.stringify(next) !== JSON.stringify(rangesRef.current)) {
      rangesRef.current = next;
      setRanges(next);
    }
  }, []);
  const save = useCallback(() => {
    const e = game.current!,
      opts = callbacks.current;
    if (demo.current || saved.current || !(e.correct + e.wrong + e.missed))
      return;
    saved.current = true;
    opts.onSave({
      id: crypto.randomUUID(),
      songId: song.id,
      title: song.title,
      date: new Date().toISOString(),
      mode: "game",
      source: "keyboard",
      hands: opts.hands,
      tempo: opts.tempo,
      activeSeconds: Math.round(Math.max(0, elapsed.current)),
      correct: e.correct,
      wrong: e.wrong,
      missed: e.missed,
      completed: e.completed,
      points: e.score.points,
      bestCombo: e.score.bestCombo,
      rounds: 1,
      fromMeasure: 0,
      toMeasure: song.measures.length - 1,
      mistakes: [],
    });
  }, [song]);
  const releaseAll = useCallback(() => {
    for (const pitch of owners.current.keys()) releasePianoKey(pitch);
    for (const pitch of demoSounds.current) releasePianoKey(pitch);
    demoSounds.current.clear();
    owners.current.clear();
    setHeld([]);
  }, []);
  const pause = useCallback(() => {
    generation.current++;
    if (phaseRef.current === "playing" || phaseRef.current === "loading") {
      demo.current?.suspend();
      game.current!.suspendHolds();
      phaseRef.current = "paused";
      setPhaseState("paused");
    }
    releaseAll();
    stopPlayback();
  }, [releaseAll]);
  const restart = (
    nextHands = hands,
    nextTempo = tempo,
    showDemo = demonstrating,
  ) => {
    pause();
    save();
    game.current = new PianoGameEngine(song, nextHands, nextTempo);
    demo.current = showDemo ? new PianoGameDemo(game.current) : null;
    setDemonstrating(showDemo);
    setCapacity(gameKeyCapacity(game.current.notes));
    elapsed.current = -3.2;
    rangesRef.current = [];
    saved.current = false;
    phaseChange("ready");
    publish();
  };
  const demonstrate = () => {
    restart(hands, tempo, !demonstrating);
    if (!demonstrating) void start();
  };
  const start = async () => {
    if (phaseRef.current === "playing") {
      pause();
      return;
    }
    if (phaseRef.current === "loading") return;
    if (game.current!.done) restart();
    if (!game.current!.total) {
      notify("This part has no playable notes. Choose the right hand or both hands.");
      return;
    }
    const token = ++generation.current;
    phaseChange("loading");
    try {
      const notes = game.current!.index.visible(
        Math.max(0, elapsed.current),
        4,
      );
      await preparePianoNotes(
        notes.map((note) => ({ ...note, velocity: 0.7 })),
      );
      await readyAudio();
      if (mounted.current && token === generation.current)
        phaseChange("playing");
    } catch (error) {
      if (mounted.current && token === generation.current) {
        phaseChange("paused");
        notify((error as Error).message || "Piano sounds could not load. Please try again.");
      }
    }
  };
  const press = useCallback(
    (pitch: number, owner = "key") => {
      if (phaseRef.current !== "playing" || demo.current) return;
      let pressed = owners.current.get(pitch);
      if (!pressed) {
        pressed = new Set();
        owners.current.set(pitch, pressed);
      }
      if (pressed.has(owner)) return;
      pressed.add(owner);
      if (pressed.size > 1) return;
      const note = game.current!.press(pitch, elapsed.current);
      if (note?.hold) playPianoKey(pitch, 0.17, 0.7);
      else if (note) playPiano(pitch, note.duration, 0.17, 0, 0.7);
      setHeld([...owners.current.keys()]);
      publish();
    },
    [publish],
  );
  const release = useCallback(
    (pitch: number, owner = "key") => {
      const pressed = owners.current.get(pitch);
      if (!pressed?.delete(owner) || pressed.size) return;
      owners.current.delete(pitch);
      if (phaseRef.current === "playing")
        game.current!.release(pitch, elapsed.current);
      releasePianoKey(pitch);
      setHeld([...owners.current.keys()]);
      publish();
    },
    [publish],
  );
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.hidden) pause();
    };
    const down = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        return;
      const key = event.key.toLowerCase(),
        pitch = COMPUTER_KEYS[key];
      if (pitch !== undefined) {
        event.preventDefault();
        press(pitch, `computer:${key}`);
      }
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase(),
        pitch = COMPUTER_KEYS[key];
      if (pitch !== undefined) release(pitch, `computer:${key}`);
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", pause);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      mounted.current = false;
      generation.current++;
      save();
      for (const pitch of demoSounds.current) releasePianoKey(pitch);
      demoSounds.current.clear();
      for (const pitch of owners.current.keys()) releasePianoKey(pitch);
      owners.current.clear();
      stopPlayback();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", pause);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [save, pause, press, release]);

  const reservedCells = Math.max(capacity, ranges.length);
  useEffect(() => {
    const root = stage.current!;
    const measure = () => {
      const width = root.getBoundingClientRect().width;
      setColumns(
        Math.min(
          reservedCells,
          width >= 840 ? 3 : width >= 520 || reservedCells > 2 ? 2 : 1,
        ),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [reservedCells]);

  // Canvas geometry is measured only after layout changes, never on animation frames.
  useEffect(() => {
    const root = stage.current!;
    const contexts: {
      context: CanvasRenderingContext2D;
      width: number;
      height: number;
      keys: Map<number, { x: number; width: number }>;
    }[] = [];
    const measure = () => {
      contexts.length = 0;
      for (const card of root.querySelectorAll<HTMLElement>(
        ".piano-game-key-zone",
      )) {
        const canvas = card.querySelector("canvas")!,
          rect = canvas?.getBoundingClientRect();
        if (!canvas || !rect) continue;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) continue;
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const keys = new Map<number, { x: number; width: number }>();
        for (const key of card.querySelectorAll<HTMLElement>(
          "button[data-midi]",
        )) {
          const keyRect = key.getBoundingClientRect();
          keys.set(Number(key.dataset.midi), {
            x: keyRect.left - rect.left,
            width: keyRect.width,
          });
        }
        contexts.push({
          context,
          width: rect.width,
          height: rect.height,
          keys,
        });
      }
      draw.current?.();
    };
    draw.current = () => {
      const notes = game.current!.index.visible(
        elapsed.current - 0.28,
        GAME_PREVIEW_SECONDS + 0.4,
        game.current!.hitWindow,
      );
      for (const { context: ctx, width, height, keys } of contexts) {
        ctx.fillStyle = dark ? "#131f21" : "#eef3ed";
        ctx.fillRect(0, 0, width, height);
        const line = height - 12,
          scale = Math.max(16, (height - 20) / 3.2);
        for (const { x, width: w } of keys.values()) {
          ctx.strokeStyle = dark ? "#284041" : "#d5dfd6";
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (const raw of notes) {
          const note = raw as import("../lib/pianoGame").GameNote;
          if (note.state === "hit" || note.state === "missed") continue;
          const key = keys.get(note.pitch);
          if (!key) continue;
          const movingBottom = line - (note.time - elapsed.current) * scale;
          const bottom =
            note.state === "pending"
              ? Math.min(line + 8, movingBottom)
              : movingBottom;
          const top = Math.max(
            0,
            bottom - Math.max(note.hold ? note.duration * scale : 18, 18),
          );
          const clippedBottom = Math.min(line + 8, bottom);
          if (clippedBottom <= top) continue;
          ctx.fillStyle =
            note.state === "holding"
              ? "#f7c974"
              : note.hand === "left"
                ? "#619ede"
                : "#37aa91";
          ctx.beginPath();
          const rectangle =
            typeof ctx.roundRect === "function"
              ? ctx.roundRect.bind(ctx)
              : ctx.rect.bind(ctx);
          rectangle(
            key.x + 2,
            top,
            Math.max(3, key.width - 4),
            clippedBottom - top,
            3,
          );
          ctx.fill();
          if (key.width >= 22 && bottom > 18) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px system-ui";
            ctx.textAlign = "center";
            ctx.fillText(
              noteName(note.pitch),
              key.x + key.width / 2,
              Math.min(line, bottom) - 5,
            );
          }
        }
        ctx.fillStyle = "#daa944";
        ctx.fillRect(0, line, width, 2);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => {
      observer.disconnect();
      draw.current = null;
    };
  }, [ranges, dark]);
  useEffect(() => {
    if (phase !== "playing") {
      draw.current?.();
      return;
    }
    let frame = 0,
      previous = performance.now(),
      lastHud = 0,
      lastLoad = -Infinity;
    let preparing = false;
    const tick = (now: number) => {
      if (phaseRef.current !== "playing") return;
      // A busy frame slows the game clock instead of skipping a whole passage.
      elapsed.current += Math.max(0, Math.min(0.1, (now - previous) / 1000));
      previous = now;
      const e = game.current!;
      if (demo.current) {
        const { attacks, releases } = demo.current.advance(elapsed.current);
        for (const pitch of releases) {
          releasePianoKey(pitch);
          demoSounds.current.delete(pitch);
        }
        for (const note of attacks) {
          if (note.hold && note.state === "holding") {
            playPianoKey(note.pitch, 0.17, 0.7);
            demoSounds.current.add(note.pitch);
          } else playPiano(note.pitch, note.duration, 0.17, 0, 0.7);
        }
      } else e.tick(elapsed.current);
      if (e.done) {
        phaseChange("finished");
        releaseAll();
        save();
        publish();
        draw.current?.();
        return;
      }
      if (now - lastHud >= 100) {
        publish();
        lastHud = now;
      }
      if (!preparing && elapsed.current - lastLoad >= 1) {
        preparing = true;
        lastLoad = elapsed.current;
        const token = generation.current;
        const notes = e.index
          .visible(Math.max(0, elapsed.current), GAME_PREVIEW_SECONDS + 1)
          .map((note) => ({ ...note, velocity: 0.7 }));
        void preparePianoNotes(notes)
          .catch(() => {
            if (mounted.current && generation.current === token) {
              pause();
              callbacks.current.notify("Piano sounds could not load. Please try again.");
            }
          })
          .finally(() => {
            preparing = false;
          });
      }
      draw.current?.();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, publish, pause, save, releaseAll]);

  return (
    <div className="practice-shell piano-game-shell">
      <header className="practice-header">
        <button type="button" className="back-button" onClick={onExit}>
          <ArrowLeft size={20} />
          <span>{t("Back")}</span>
        </button>
        <div className="practice-title">
          <h1>{songTitle(song, locale)}</h1>
          <span>
            {t("Piano game")} · {t("Smart key ranges")}
          </span>
        </div>
        <div className="piano-selectors">
          <select
            aria-label={t("Piano sound")}
            value={voice}
            onChange={(event) => {
              pause();
              const next = event.target.value as PianoVoice;
              setPianoVoice(next);
              setVoice(next);
            }}
          >
            {PIANO_VOICES.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {t(voice.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="practice-header-actions">
          <LanguageToggle />
          <ThemeToggle />
          <button
            type="button"
            className="icon-button"
            aria-label={t("Song leaderboard")}
            onClick={() => {
              pause();
              setLeaderboard(true);
            }}
          >
            <Trophy size={20} />
          </button>
        </div>
      </header>
      <div className="piano-game-topbar">
        <AnimatedSegmented
          className="segmented practice-mode-switch"
          value="game"
          aria-label={t("Practice mode")}
        >
          {(
            [
              ["wait", "Wait for Notes"],
              ["rhythm", "Play in Time"],
              ["listen", "Listen"],
              ["game", "Piano game"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              data-segment-id={id}
              aria-pressed={id === "game"}
              className={id === "game" ? "selected" : ""}
              onClick={() => {
                if (id !== "game") onMode(id);
              }}
            >
              {t(label)}
            </button>
          ))}
        </AnimatedSegmented>
        <div className="game-hud">
          <span className="game-points">
            <small>{t("Points")}</small>
            <strong>{hud.points.toLocaleString()}</strong>
          </span>
          <span className="game-combo">
            <strong>{hud.combo}</strong>
            <small>COMBO</small>
          </span>
        </div>
      </div>
      <div className="piano-game-progress">
        <div style={{ width: `${hud.progress * 100}%` }} />
      </div>
      <div className="piano-game-message" role="status">
        {phase === "playing" && elapsed.current < 0
          ? t("Ready in {count}", { count: Math.ceil(-elapsed.current) })
          : t(hud.feedback)}
        <small>
          {t(
            demonstrating
              ? "Demo performance · Not saved to scores"
              : "Tap short notes · Hold long notes · Play chords together",
          )}
        </small>
      </div>
      <main
        className="piano-game-stage"
        ref={stage}
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.ceil(reservedCells / columns)}, minmax(0, 1fr))`,
        }}
        aria-label={t("Smart piano key game area")}
      >
        {ranges.map((range, index) =>
          range ? (
            <section className="piano-game-key-zone" key={index}>
              <div className="piano-game-zone-label">
                {noteName(range.low)} — {noteName(range.high)}
              </div>
              <canvas aria-hidden="true" />
              <Keybed
                low={range.low}
                high={range.high}
                expected={game.current!.upcoming(elapsed.current)}
                held={held}
                pressed={null}
                showHints
                onNote={press}
                onRelease={release}
              />
            </section>
          ) : (
            <section
              key={index}
              className="piano-game-key-zone piano-game-empty-zone"
              aria-hidden="true"
            >
              <div className="piano-game-zone-label">&nbsp;</div>
              <canvas />
              <div className="piano-keyboard" />
            </section>
          ),
        )}
        {phase !== "playing" && (
          <div className="piano-game-overlay">
            <Gamepad2 size={28} />
            <h2>
              {t(
                phase === "finished"
                  ? "Piece completed"
                  : phase === "paused"
                    ? "Game paused"
                    : "Play your way through the melody",
              )}
            </h2>
            <p>
              {t(
                phase === "finished"
                  ? "Best combo {count}"
                  : "Keys stay in place, with the next few seconds of notes shown in advance",
                { count: hud.best },
              )}
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={phase === "loading"}
              onClick={() => void start()}
            >
              <Play size={18} />
              {t(
                phase === "loading"
                  ? "Loading sounds…"
                  : phase === "paused"
                    ? "Resume game"
                    : phase === "finished"
                      ? "Play again"
                      : "Start game",
              )}
            </button>
          </div>
        )}
      </main>
      <footer className="piano-game-controls">
        <button
          type="button"
          className={`game-demo-button ${demonstrating ? "selected" : ""}`}
          aria-pressed={demonstrating}
          onClick={demonstrate}
        >
          <Play size={16} />
          {t(demonstrating ? "Play yourself" : "Watch a performance")}
        </button>
        <select
          aria-label={t("Practice hands")}
          value={hands}
          onChange={(e) => {
            const next = e.target.value as Hands;
            restart(next, tempo);
            setHands(next);
          }}
        >
          {(
            [
              ["left", "Left hand"],
              ["right", "Right hand"],
              ["both", "Both hands"],
            ] as const
          ).map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
        <label>
          {t("Game speed {percent}%", {
            percent: Math.round((tempo / song.tempo) * 100),
          })}
          <input
            aria-label={t("Game speed")}
            type="range"
            min="50"
            max="150"
            step="5"
            value={Math.round((tempo / song.tempo) * 100)}
            onChange={(e) => {
              const next = (song.tempo * Number(e.target.value)) / 100;
              restart(hands, next);
              setTempo(next);
            }}
          />
        </label>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Restart game")}
          onClick={() => restart()}
        >
          <RotateCcw size={20} />
        </button>
        <button
          type="button"
          className="play-button"
          disabled={phase === "loading"}
          onClick={() => void start()}
        >
          {phase === "playing" ? <Pause size={18} /> : <Play size={18} />}
          <span>
            {t(
              phase === "playing"
                ? "Pause"
                : phase === "paused"
                  ? "Resume game"
                  : "Start game",
            )}
          </span>
        </button>
      </footer>
      {leaderboard && (
        <SongLeaderboard
          song={song}
          records={records}
          initialMode="game"
          onClose={() => setLeaderboard(false)}
        />
      )}
      <AnimatedToast>{toast ? t(toast) : null}</AnimatedToast>
    </div>
  );
}
