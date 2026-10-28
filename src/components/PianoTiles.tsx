import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  Trophy,
} from "lucide-react";
import type { Hands, PracticeMode, PracticeRecord, Song } from "../types";
import { AnimatedSegmented } from "./AnimatedSegmented";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { SongLeaderboard } from "./SongLeaderboard";
import { AnimatedToast } from "./AnimatedToast";
import {
  PianoTileEngine,
  PIANO_TILE_LANES,
  type PianoTile,
} from "../lib/pianoTiles";
import { PianoTileLayout } from "../lib/pianoTileLayout";
import { PianoTileTransport, type TileAttack } from "../lib/pianoTileTransport";
import { noteName } from "../lib/music";
import { useI18n } from "../lib/i18n";
import { songTitle } from "../lib/songLocale";
import {
  getPianoVoice,
  playPianoAt,
  pianoNotesReady,
  preparePianoNotes,
  readyAudio,
  setPianoVoice,
  stopPlayback,
} from "../lib/audio";
import { PIANO_VOICES, type PianoVoice } from "../lib/pianoVoices";
import "../data/practiceMessages";

type Phase = "ready" | "loading" | "playing" | "paused" | "finished";
const LANE_KEYS = ["d", "f", "g", "j", "k"];
const tileLead = (tile: PianoTile) =>
  Math.max(
    ...tile.notes
      .filter((note) => note.time === tile.time)
      .map((note) => note.pitch),
  );
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
  const [hands, setHands] = useState<Hands>(initialHands);
  const [tempo, setTempo] = useState(initialTempo);
  const [voice, setVoice] = useState(getPianoVoice);
  const [intensity, setIntensity] = useState(100);
  const game = useRef<PianoTileEngine | null>(null);
  game.current ??= new PianoTileEngine(song, hands, tempo, intensity);
  const transport = useRef<PianoTileTransport | null>(null);
  transport.current ??= new PianoTileTransport(game.current);
  const audio = useRef<AudioContext | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const elapsed = useRef(transport.current.position);
  const [demo, setDemo] = useState(false);
  const demoRef = useRef(false);
  const [hud, setHud] = useState({
    points: 0,
    combo: 0,
    best: 0,
    progress: 0,
    feedback: game.current.feedback,
    waiting: false,
    speed: 100,
  });
  const [preview, setPreview] = useState(() => game.current!.preview());
  const [activeLane, setActiveLane] = useState(-1);
  const [wrongLane, setWrongLane] = useState(-1);
  const [leaderboard, setLeaderboard] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const tileButtons = useRef(new Map<number, HTMLButtonElement>());
  const visibleTiles = useRef(new Set<number>());
  const [, refreshVisibleTiles] = useState(0);
  const pendingTaps = useRef(new Set<number>());
  const draw = useRef<(() => void) | null>(null);
  const flash = useRef({ lane: -1, until: 0 });
  const mounted = useRef(true);
  const generation = useRef(0);
  const saved = useRef(false);
  const callbacks = useRef({
    onSave,
    notify,
    hands,
    tempo,
    intensity,
    baseTempo: song.tempo,
  });
  callbacks.current = {
    onSave,
    notify,
    hands,
    tempo,
    intensity,
    baseTempo: song.tempo,
  };
  const phaseChange = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const publish = useCallback(() => {
    const engine = game.current!;
    setHud({
      points: engine.score.points,
      combo: engine.score.combo,
      best: engine.score.bestCombo,
      progress: engine.progress,
      feedback: engine.feedback,
      waiting: !demoRef.current && transport.current!.waiting,
      speed: Math.round(
        ((transport.current!.rate * callbacks.current.tempo) /
          callbacks.current.baseTempo) *
          100,
      ),
    });
    setPreview(engine.preview());
    setActiveLane(
      performance.now() < flash.current.until ? flash.current.lane : -1,
    );
  }, []);
  const save = useCallback(() => {
    const e = game.current!,
      opts = callbacks.current;
    if (demoRef.current || saved.current || !(e.correct + e.wrong + e.missed))
      return;
    saved.current = true;
    opts.onSave({
      id: crypto.randomUUID(),
      songId: song.id,
      title: song.title,
      date: new Date().toISOString(),
      mode: "game",
      gameIntensity: opts.intensity,
      gameRulesVersion: 3,
      source: "keyboard",
      hands: opts.hands,
      tempo: opts.tempo,
      activeSeconds: Math.round(transport.current!.activeSeconds),
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
  const pause = useCallback(() => {
    generation.current++;
    if (phaseRef.current === "playing" || phaseRef.current === "loading") {
      phaseRef.current = "paused";
      setPhase("paused");
    }
    flash.current = { lane: -1, until: 0 };
    setActiveLane(-1);
    transport.current?.pause(audio.current?.currentTime ?? 0);
    stopPlayback();
  }, []);
  const restart = (
    nextHands = hands,
    nextTempo = tempo,
    showDemo = demoRef.current,
    nextIntensity = intensity,
  ) => {
    pause();
    save();
    game.current = new PianoTileEngine(
      song,
      nextHands,
      nextTempo,
      nextIntensity,
    );
    transport.current = new PianoTileTransport(game.current);
    demoRef.current = showDemo;
    setDemo(showDemo);
    elapsed.current = transport.current.position;
    pendingTaps.current = new Set();
    saved.current = false;
    setWrongLane(-1);
    phaseChange("ready");
    publish();
  };
  const start = async () => {
    if (phaseRef.current === "playing") {
      pause();
      return;
    }
    if (phaseRef.current === "loading") return;
    if (phaseRef.current === "finished") restart();
    if (!game.current!.total) {
      notify("This part has no playable notes. Choose the right hand or both hands.");
      return;
    }
    const token = ++generation.current;
    phaseChange("loading");
    try {
      await preparePianoNotes(
        [
          ...game.current!.source.index.visible(
            Math.max(0, elapsed.current),
            2,
          ),
          ...game.current!.preview(12).flatMap((tile) => tile.notes),
        ].map((note) => ({ ...note, velocity: 0.7 })),
      );
      audio.current = await readyAudio();
      if (mounted.current && generation.current === token) {
        transport.current!.start(audio.current.currentTime);
        phaseChange("playing");
      }
    } catch (error) {
      if (mounted.current && generation.current === token) {
        phaseChange("paused");
        notify((error as Error).message || "Piano sounds could not load. Please try again.");
      }
    }
  };
  const sound = useCallback((attacks: TileAttack[]) => {
    for (const attack of attacks) {
      playPianoAt(attack.note.pitch, attack.duration, 0.17, attack.at, 0.7);
      flash.current = { lane: attack.lane, until: performance.now() + 180 };
    }
  }, []);
  const tap = useCallback(
    (lane: number, tileId?: number) => {
      if (phaseRef.current !== "playing" || demoRef.current) return;
      const e = game.current!;
      const candidate =
        tileId === undefined
          ? (e
              .preview()
              .find(
                (tile) =>
                  tile.lane === lane && visibleTiles.current.has(tile.id),
              ) ?? e.next)
          : e.tiles[tileId];
      if (!candidate || !e.ready(elapsed.current, candidate)) return;
      const hit = () => {
        const before = e.wrong;
        const result = transport.current!.press(
          lane,
          candidate.id,
          audio.current!.currentTime,
        );
        elapsed.current = transport.current!.position;
        sound(result.attacks);
        if (e.wrong !== before) setWrongLane(lane);
        else setWrongLane(-1);
        publish();
        draw.current?.();
      };
      const notes = candidate.notes.map((note) => ({ ...note, velocity: 0.7 }));
      if (
        candidate !== e.next ||
        lane !== candidate.lane ||
        pianoNotesReady(notes)
      ) {
        hit();
        return;
      }
      if (pendingTaps.current.has(candidate.id)) return;
      const loadingTaps = pendingTaps.current;
      loadingTaps.add(candidate.id);
      const token = generation.current;
      // A rare cache miss must load the original sample before crediting a hit.
      void preparePianoNotes(notes)
        .then(() => {
          if (
            mounted.current &&
            generation.current === token &&
            phaseRef.current === "playing"
          )
            hit();
        })
        .catch(() => {
          if (mounted.current && generation.current === token) {
            pause();
            callbacks.current.notify("Piano sounds could not load. Please try again.");
          }
        })
        .finally(() => loadingTaps.delete(candidate.id));
    },
    [sound, publish, pause],
  );
  useEffect(() => {
    if (wrongLane < 0) return;
    const timeout = setTimeout(() => setWrongLane(-1), 450);
    return () => clearTimeout(timeout);
  }, [wrongLane]);
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
      const lane = LANE_KEYS.indexOf(event.key.toLowerCase());
      if (lane >= 0) {
        event.preventDefault();
        tap(lane);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", pause);
    window.addEventListener("keydown", down);
    return () => {
      mounted.current = false;
      generation.current++;
      save();
      stopPlayback();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", pause);
      window.removeEventListener("keydown", down);
    };
  }, [pause, save, tap]);
  useEffect(() => {
    const surface = stage.current!;
    let width = 0,
      height = 0;
    let chart: PianoTileEngine | null = null,
      layout: PianoTileLayout | null = null,
      layoutHeight = -1,
      scroll = 0;
    draw.current = () => {
      const laneWidth = width / PIANO_TILE_LANES;
      const e = game.current!;
      const beat = e.timeline.beatAt(elapsed.current);
      if (chart !== e || layoutHeight !== height) {
        chart = e;
        layoutHeight = height;
        layout = new PianoTileLayout(e.tiles, height, e.intensity);
        scroll = layout.scrollAt(beat);
      }
      const { line, blockHeight } = layout!;
      // Demo stall recovery can rewind the audio clock; never rewind the screen.
      scroll = Math.max(scroll, layout!.scrollAt(beat));
      const previouslyVisible = visibleTiles.current;
      visibleTiles.current = new Set<number>();
      for (const [id, button] of tileButtons.current)
        if (id < e.cursor) button.style.display = "none";
      for (const tile of game.current!.preview()) {
        const button = tileButtons.current.get(tile.id);
        if (!button) continue;
        const top = layout!.top(tile.id, scroll);
        const bottom = top + blockHeight;
        button.style.display =
          width && bottom > 0 && top < line ? "flex" : "none";
        if (width && bottom > 0 && top < line)
          visibleTiles.current.add(tile.id);
        button.style.left = `${tile.lane * laneWidth + 4}px`;
        button.style.width = `${Math.max(0, laneWidth - 8)}px`;
        button.style.height = `${blockHeight}px`;
        button.style.transform = `translate3d(0, ${top}px, 0)`;
      }
      if (
        previouslyVisible.size !== visibleTiles.current.size ||
        [...previouslyVisible].some((id) => !visibleTiles.current.has(id))
      )
        refreshVisibleTiles((revision) => revision + 1);
    };
    const measure = () => {
      const rect = surface.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      draw.current?.();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    measure();
    return () => {
      observer.disconnect();
      draw.current = null;
    };
  }, []);
  useLayoutEffect(() => draw.current?.(), [preview]);
  useEffect(() => {
    if (phase !== "playing") {
      draw.current?.();
      return;
    }
    let frame = 0,
      lastHud = 0,
      lastCursor = -1,
      lastLoad = -Infinity,
      preparing = false;
    const tick = (now: number) => {
      if (phaseRef.current !== "playing") return;
      const e = game.current!;
      const audioNow = audio.current!.currentTime;
      const missed = e.missed;
      sound(transport.current!.advance(audioNow, demoRef.current));
      if (e.missed > missed) setWrongLane(e.lastMissed!.lane);
      elapsed.current = transport.current!.position;
      if (transport.current!.finished(audioNow)) {
        phaseChange("finished");
        save();
        publish();
        draw.current?.();
        return;
      }
      if (now - lastHud >= 100 || e.cursor !== lastCursor) {
        publish();
        lastHud = now;
        lastCursor = e.cursor;
      }
      if (!preparing && elapsed.current - lastLoad >= 0.6) {
        preparing = true;
        lastLoad = elapsed.current;
        const token = generation.current;
        void preparePianoNotes(
          [
            ...e.source.index.visible(Math.max(0, elapsed.current), 4.2),
            ...e.preview(24).flatMap((tile) => tile.notes),
          ].map((note) => ({ ...note, velocity: 0.7 })),
        )
          .catch(() => {
            if (mounted.current && token === generation.current) {
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
  }, [phase, publish, pause, save, sound]);
  return (
    <div className="practice-shell piano-game-shell piano-tiles-shell">
      <header className="practice-header">
        <button type="button" className="back-button" onClick={onExit}>
          <ArrowLeft size={20} />
          <span>{t("Back")}</span>
        </button>
        <div className="practice-title">
          <h1>{songTitle(song, locale)}</h1>
          <span>
            {t("Piano game")} · {t("Five-key rhythm")}
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
              key={id}
              type="button"
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
        {t(hud.waiting ? "Tap the first tile, then keep following the beat" : hud.feedback)}
        <small>
          {t(
            demo
              ? "Demo performance · Not saved to scores"
              : "Shared starting tempo · Smooth acceleration · Now {percent}%",
            { percent: hud.speed },
          )}
        </small>
      </div>
      <main
        className="piano-game-stage piano-tile-stage"
        ref={stage}
        aria-label={t("Five-key piano tile game")}
      >
        <div className="piano-tile-lanes">
          {[0, 1, 2, 3, 4].map((lane) => {
            const tile = preview.find(
                (tile) =>
                  tile.lane === lane && visibleTiles.current.has(tile.id),
              ),
              lead = tile ? tileLead(tile) : undefined;
            return (
              <button
                key={lane}
                type="button"
                data-midi={lead}
                aria-label={t("Piano tile lane {lane}", { lane: lane + 1 })}
                className={`piano-tile-lane ${activeLane === lane ? "pressed" : ""} ${wrongLane === lane ? "wrong" : ""}`}
                onPointerDown={(event) => {
                  if (event.button === 0) {
                    event.preventDefault();
                    tap(lane);
                  }
                }}
                onClick={(event) => {
                  if (event.detail === 0) tap(lane);
                }}
              >
                <span className="piano-tile-key">
                  <strong>{lead === undefined ? "·" : noteName(lead)}</strong>
                  <small>{LANE_KEYS[lane].toUpperCase()}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="piano-tile-blocks">
          {preview.map((tile) => (
            <button
              key={tile.id}
              ref={(button) => {
                if (button) tileButtons.current.set(tile.id, button);
                else tileButtons.current.delete(tile.id);
              }}
              type="button"
              className="piano-tile-block"
              data-tile-id={tile.id}
              data-midi={tileLead(tile)}
              aria-label={t("Piano tile {note} · Group {number}", {
                note: noteName(tileLead(tile)),
                number: tile.id + 1,
              })}
              onPointerDown={(event) => {
                if (event.button === 0) {
                  event.preventDefault();
                  tap(tile.lane, tile.id);
                }
              }}
              onClick={(event) => {
                if (event.detail === 0) tap(tile.lane, tile.id);
              }}
            >
              <strong>{noteName(tileLead(tile))}</strong>
              {tile.notes.length > 1 && <small>{t("One-tap harmony")}</small>}
            </button>
          ))}
        </div>
        {phase !== "playing" && (
          <div className="piano-game-overlay">
            <Gamepad2 size={28} />
            <h2>
              {t(
                phase === "finished"
                  ? "Piece completed"
                  : phase === "paused"
                    ? "Game paused"
                    : "Five keys. A challenge that grows with you.",
              )}
            </h2>
            <p>
              {t(
                phase === "finished"
                  ? "Best combo {count}"
                  : "Both hands by default. Taps strike piano notes immediately; tempo rises smoothly as you play. Misses break combos, and you can finish the whole piece.",
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
          className={`game-demo-button ${demo ? "selected" : ""}`}
          aria-pressed={demo}
          onClick={() => {
            const next = !demoRef.current;
            restart(hands, tempo, next);
            if (next) void start();
          }}
        >
          <Play size={16} />
          {t(demo ? "Play yourself" : "Watch a performance")}
        </button>
        <label>
          {t("Intensity {value}", { value: intensity })}
          <input
            aria-label={t("Challenge intensity")}
            type="range"
            min="1"
            max="100"
            step="1"
            value={intensity}
            onChange={(event) => {
              const next = Number(event.target.value);
              restart(hands, tempo, demoRef.current, next);
              setIntensity(next);
            }}
          />
        </label>
        <select
          aria-label={t("Practice hands")}
          value={hands}
          onChange={(event) => {
            const next = event.target.value as Hands;
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
          ).map(([id, label]) => (
            <option key={id} value={id}>
              {t(label)}
            </option>
          ))}
        </select>
        <label>
          {t("Starting tempo {percent}%", {
            percent: Math.round((tempo / song.tempo) * 100),
          })}
          <input
            aria-label={t("Game speed")}
            type="range"
            min="50"
            max="150"
            step="5"
            value={Math.round((tempo / song.tempo) * 100)}
            onChange={(event) => {
              const next = (song.tempo * Number(event.target.value)) / 100;
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
