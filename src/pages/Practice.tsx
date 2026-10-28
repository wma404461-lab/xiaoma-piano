import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bluetooth,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Footprints,
  Headphones,
  Gamepad2,
  Keyboard as KeyboardIcon,
  Leaf,
  Mic,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Settings2,
  SkipForward,
  SlidersHorizontal,
  Shuffle,
  Trophy,
  Unplug,
  Usb,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  ExpectedEvent,
  Hands,
  InputSource,
  Mistake,
  Notation,
  PracticeMode,
  PracticeRecord,
  Song,
} from "../types";
import { durationText, getEvents, noteName, rangeBeats } from "../lib/music";
import { scoreKeyLabel } from "../lib/scoreUI";
import {
  listenMicrophone,
  playClick,
  playPiano,
  playPianoKey,
  releasePianoKey,
  setPianoSustain,
  playPianoAt,
  preparePianoNotes,
  pianoNotesReady,
  getPianoVoice,
  setPianoVoice,
  getPlaybackVolume,
  prefetchPianoKeys,
  prefetchPianoNotes,
  readyAudio,
  stopPlayback,
  setPlaybackVolume,
} from "../lib/audio";
import type { MicReading } from "../lib/audio";
import { ChordEvaluator } from "../lib/evaluator";
import {
  midiSession,
  midiDevices,
  bluetoothMidiDevices,
  watchMidiDevices,
  cancelBluetoothMidiSearch,
} from "../lib/midi";
import type { MidiDevice } from "../lib/midi";
import { microphoneError, openInputSettings } from "../lib/microphone";
import { Keyboard } from "../components/Keyboard";
import {OfflineSongControl} from "../components/OfflineSongControl";
import { Score } from "../components/Score";
import { Modal } from "../components/Modal";
import { ThemeToggle } from "../components/ThemeToggle";
import { AnimatedSegmented } from "../components/AnimatedSegmented";
import { AnimatedToast } from "../components/AnimatedToast";
import { LanguageToggle } from "../components/LanguageToggle";
import { useI18n } from "../lib/i18n";
import { songTitle, songSubtitle, songComposer } from "../lib/songLocale";
import { displayArtist } from "../lib/libraryArtists";
import { practiceText } from "../data/practiceMessages";
import {
  SongLeaderboard,
  PracticeProgressNote,
} from "../components/SongLeaderboard";
import { getSongPracticeHistory } from "../lib/practiceHistory";

const PianoWake = registerPlugin<{
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
}>("PianoWake");

import { PIANO_VOICES, type PianoVoice } from "../lib/pianoVoices";
import {
  AudioTransport,
  makePerformance,
  type PlaybackStyle,
  type PerformancePlan,
} from "../lib/performance";
import { countWork, timeWork } from "../lib/diagnostics";
import { practiceBeatAt, rangeTempoMap, TempoTimeline } from "../lib/tempo";
import type { DemoSettings } from "../lib/demoShuffle";
import { PianoGame } from "../components/PianoTiles";
import { eventHitStatuses } from "../lib/practiceJudgement";
import {
  awardHit,
  comboMultiplier,
  emptyGameScore,
  type GameScore,
} from "../lib/gameScore";

interface Session {
  game: GameScore;
  listenSeconds?: number;
  index: number;
  startedIndex: number;
  running: boolean;
  correct: number;
  wrong: number;
  missed: number;
  activeSeconds: number;
  lastTick: number;
  lastActivity: number;
  startTime: number;
  startBeat: number;
  lastClick: number;
  listenIndex: number;
  loops: number;
  saved: boolean;
  completed: boolean;
  statuses: Record<string, string>;
  mistakes: Mistake[];
}
interface Feedback {
  text: string;
  kind: string;
  values?: Record<string, string | number>;
}
const NO_HINTS: string[] = [];
const freshSession = (): Session => ({
  game: emptyGameScore(),
  index: 0,
  startedIndex: 0,
  running: false,
  correct: 0,
  wrong: 0,
  missed: 0,
  activeSeconds: 0,
  lastTick: 0,
  lastActivity: 0,
  startTime: 0,
  startBeat: 0,
  lastClick: -999,
  listenIndex: 0,
  loops: 0,
  saved: false,
  completed: false,
  statuses: {},
  mistakes: [],
});

export function Practice({
  song,
  initialMeasure,
  initialMode = "listen",
  initialHands = "both",
  notation,
  onNotation,
  onExit,
  onSave,
  notify,
  toast,
  records,
  demoLaunch,
  shuffleDemo = false,
  onShuffleDemo,
  onNextDemo,
}: {
  song: Song;
  initialMeasure?: number;
  initialMode?: PracticeMode;
  initialHands?: Hands;
  notation: Notation;
  onNotation: (notation: Notation) => void;
  onExit: () => void;
  onSave: (record: PracticeRecord) => void;
  notify: (text: string) => void;
  toast: string;
  records: PracticeRecord[];
  demoLaunch?: DemoSettings;
  shuffleDemo?: boolean;
  onShuffleDemo?: (enabled: boolean) => void;
  onNextDemo?: (
    settings: DemoSettings,
    signal: AbortSignal,
  ) => Promise<boolean>;
}) {
  countWork("practiceRenders");
  const { locale, t } = useI18n();
  const [hands, setHands] = useState<Hands>(initialHands);
  const [mode, setMode] = useState<PracticeMode>(initialMode);
  const [source, setSource] = useState<InputSource>(() =>
    midiSession.state.device ? "midi" : "keyboard",
  );
  const [tempo, setTempo] = useState(
    song.tempo * (demoLaunch?.speedRatio ?? ((song.defaultPracticeTempo ?? song.tempo) / song.tempo)),
  );
  const [from, setFrom] = useState(initialMeasure ?? 0);
  const [to, setTo] = useState(
    initialMeasure === undefined
      ? song.measures.length - 1
      : Math.min(song.measures.length - 1, initialMeasure + 3),
  );
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(demoLaunch?.metronome ?? false);
  const [showHints, setShowHints] = useState(true);
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [expandedKeyboard, setExpandedKeyboard] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [deviceName, setDeviceName] = useState(
    () => midiSession.state.device?.name ?? "",
  );
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [searchTransport, setSearchTransport] = useState<"usb" | "bluetooth">(
    "usb",
  );
  const [busy, setBusy] = useState(false);
  const [busyAudio, setBusyAudio] = useState(false);
  const [busyNext, setBusyNext] = useState(false);
  const demoAbort = useRef<AbortController | null>(null);
  const [autoTurn, setAutoTurn] = useState(demoLaunch?.autoTurn ?? true);
  const demoControl = useRef({ shuffleDemo, onNextDemo, autoTurn });
  demoControl.current = { shuffleDemo, onNextDemo, autoTurn };
  const cancelNextDemo = useCallback(() => {
    demoAbort.current?.abort();
    demoAbort.current = null;
    setBusyNext(false);
  }, []);
  const manualTurn = useCallback(() => setAutoTurn(false), []);
  const [volume, setVolume] = useState(() =>
    Math.round(getPlaybackVolume() * 100),
  );
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("qinban-muted") === "true";
    } catch {
      return false;
    }
  });
  const lastVolume = useRef(volume > 0 ? volume : 70);
  const toggleMute = () => {
    if (muted) {
      const restored = lastVolume.current > 0 ? lastVolume.current : 70;
      setMuted(false);
      setVolume(restored);
      setPlaybackVolume(restored / 100);
      try {
        localStorage.setItem("qinban-muted", "false");
      } catch {
        /* Storage may be unavailable in private windows. */
      }
    } else {
      lastVolume.current = volume > 0 ? volume : 70;
      setMuted(true);
      setVolume(0);
      setPlaybackVolume(0);
      try {
        localStorage.setItem("qinban-muted", "true");
      } catch {
        /* Storage may be unavailable in private windows. */
      }
    }
  };
  useEffect(() => {
    if (muted) {
      setPlaybackVolume(0);
      setVolume(0);
    }
  }, [muted]);
  const [pedal, setPedal] = useState(() => {
    try {
      return localStorage.getItem("qinban-auto-pedal") !== "false";
    } catch {
      return true;
    }
  });
  const [voice, setVoice] = useState(getPianoVoice);
  useEffect(() => {
    setPianoSustain(pedal);
  }, [pedal]);
  const [playbackStyle, setPlaybackStyle] = useState<PlaybackStyle>(() => {
    try {
      return localStorage.getItem("qinban-playback-style") === "score"
        ? "score"
        : "expressive";
    } catch {
      return "expressive";
    }
  });
  const audioTransport = useRef<AudioTransport | null>(null);
  const planCache = useRef<{
    events: ExpectedEvent[];
    key: string;
    plan: PerformancePlan;
  } | null>(null);
  const playbackGeneration = useRef(0);
  const keySoundGeneration = useRef(0);
  const [inputError, setInputError] = useState("");
  const [micReading, setMicReading] = useState<MicReading>({
    midi: null,
    rms: 0,
    confidence: 0,
  });
  const [pressed, setPressed] = useState<number | null>(null);
  const [wrongPitches, setWrongPitches] = useState<number[]>([]);
  const wrongPitchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const recentHit = useRef<{ time: number; pitches: number[] } | null>(null);
  const flashWrongPitches = useCallback((pitches: number[]) => {
    clearTimeout(wrongPitchTimeout.current);
    setWrongPitches(pitches);
    wrongPitchTimeout.current = setTimeout(() => setWrongPitches([]), 650);
  }, []);
  const [heldPitches, setHeldPitches] = useState<readonly number[]>(
    () => midiSession.held,
  );
  const keyboardHeld = useRef(new Set<number>());
  const keyboardOwners = useRef(new Map<number, Set<string>>());
  const keyboardAttacks = useRef(new Map<number, number>());
  const keyboardAttackTimes = useRef(new Map<number, number>());
  const keyboardReleaseTimes = useRef(new Map<number, number>());
  const [feedback, setFeedback] = useState<Feedback>({
    text:
      initialMode === "wait"
        ? "Play the highlighted notes. The score will wait for you."
        : initialMode === "rhythm"
          ? "Follow the count-in and keep playing in time."
          : "Press Play to hear an expressive two-hand performance, or choose a practice mode.",
    kind: "neutral",
  });
  const [countdown, setCountdownState] = useState<number | null>(null);
  const countdownValue = useRef<number | null>(null);
  const setCountdown = useCallback((value: number | null) => {
    if (countdownValue.current === value) return;
    countdownValue.current = value;
    setCountdownState(value);
  }, []);
  const [session, setSession] = useState(freshSession);
  const [result, setResult] = useState<Session | null>(null);
  const [hit, setHit] = useState<{
    id: number;
    judgement: string;
    earned: number;
    combo: number;
  } | null>(null);
  const hitId = useRef(0);
  const hitTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const engine = useRef<Session>(freshSession());
  const evaluator = useRef(new ChordEvaluator());
  const inputCleanup = useRef<(() => void) | null>(null);
  const inputGeneration = useRef(0);
  const bluetoothSearching = useRef(false);
  const mounted = useRef(true);
  const handler = useRef<(pitch: number, held?: readonly number[]) => void>(
    () => {},
  );
  const pressTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const events = useMemo(
    () => getEvents(song, hands, from, to),
    [song, hands, from, to],
  );
  const totalBeats = useMemo(
    () => rangeBeats(song, from, to),
    [song, from, to],
  );
  const tempoClock = useMemo(
    () => new TempoTimeline(rangeTempoMap(song, from, to, tempo), tempo),
    [song, from, to, tempo],
  );
  const fullEvents = useMemo(() => getEvents(song, "both"), [song]);
  useEffect(() => {
    const controller = new AbortController();
    if (mode === "listen") {
      const key = `${from}:${to}:${tempo}:${playbackStyle}:${pedal}`;
      const plan = makePerformance(
        events,
        totalBeats,
        tempo,
        song.meter,
        playbackStyle,
        pedal,
        tempoClock.points,
      );
      planCache.current = { events, key, plan };
      const offset =
        engine.current.listenSeconds ??
        plan.events[engine.current.index]?.time ??
        0;
      const opening = plan.events
        .filter(
          (event) => event.time >= offset - 0.001 && event.time <= offset + 8,
        )
        .flatMap((event) => event.notes);
      void prefetchPianoNotes(opening, { signal: controller.signal }).catch(
        () => {},
      );
    } else {
      const pitches = [
        ...new Set(events.slice(0, 8).flatMap((event) => event.pitches)),
      ].slice(0, 6);
      void prefetchPianoKeys(pitches).catch(() => {});
    }
    return () => controller.abort();
  }, [
    events,
    voice,
    mode,
    from,
    to,
    tempo,
    playbackStyle,
    pedal,
    totalBeats,
    tempoClock,
    song.meter,
  ]);
  const published = useRef<Session | null>(null);
  const options = useRef({
    clock: tempoClock,
    mode,
    source,
    tempo,
    hands,
    from,
    to,
    loop,
    metronome,
    pedal,
    events,
  });
  options.current = {
    clock: tempoClock,
    mode,
    source,
    tempo,
    hands,
    from,
    to,
    loop,
    metronome,
    pedal,
    events,
  };
  const publish = useCallback(() => {
    const next = engine.current,
      previous = published.current;
    if (
      previous &&
      previous.index === next.index &&
      previous.running === next.running &&
      previous.correct === next.correct &&
      previous.wrong === next.wrong &&
      previous.missed === next.missed &&
      previous.loops === next.loops &&
      previous.saved === next.saved &&
      previous.completed === next.completed &&
      previous.statuses === next.statuses &&
      Math.floor(previous.activeSeconds) === Math.floor(next.activeSeconds)
    )
      return;
    countWork("sessionPublishes");
    published.current = { ...next };
    setSession(published.current);
  }, []);
  const save = useCallback(
    (completed = false) => {
      const e = engine.current,
        opts = options.current;
      if (
        e.saved ||
        opts.mode === "listen" ||
        opts.mode === "game" ||
        (!e.correct && !e.wrong && !e.missed && e.activeSeconds < 2)
      )
        return;
      e.saved = true;
      onSave({
        id: crypto.randomUUID(),
        songId: song.id,
        title: song.title,
        date: new Date().toISOString(),
        activeSeconds: Math.round(e.activeSeconds),
        correct: e.correct,
        wrong: e.wrong,
        missed: e.missed,
        completed: (completed || e.completed) && e.startedIndex === 0,
        tempo: opts.tempo,
        mode: opts.mode,
        source: opts.source,
        hands: opts.hands,
        points: e.game.points,
        bestCombo: e.game.bestCombo,
        rounds: 1,
        fromMeasure:
          e.startedIndex === 0
            ? opts.from
            : (opts.events[e.startedIndex]?.measure ?? opts.from),
        toMeasure: opts.to,
        mistakes: [...e.mistakes],
      });
    },
    [onSave, song],
  );
  const pause = useCallback(() => {
    cancelNextDemo();
    playbackGeneration.current++;
    keySoundGeneration.current++;
    setBusyAudio(false);
    engine.current.listenSeconds = audioTransport.current?.stop();
    engine.current.running = false;
    setCountdown(null);
    stopPlayback();
    publish();
  }, [publish, cancelNextDemo]);
  const reset = useCallback(() => {
    pause();
    save();
    engine.current = freshSession();
    evaluator.current.reset();
    setResult(null);
    setHit(null);
    recentHit.current = null;
    flashWrongPitches([]);
    clearTimeout(hitTimeout.current);
    setFeedback({ text: "Start again and take your time with this passage.", kind: "neutral" });
    publish();
  }, [pause, save, publish, flashWrongPitches]);
  const disconnect = useCallback(() => {
    inputGeneration.current++;
    keySoundGeneration.current++;
    inputCleanup.current?.();
    inputCleanup.current = null;
    setDeviceName("");
    keyboardHeld.current.clear();
    keyboardOwners.current.clear();
    setHeldPitches([]);
    setMicReading({ midi: null, rms: 0, confidence: 0 });
  }, []);
  const deviceDisconnected = useCallback(() => {
    if (options.current.mode !== "listen") {
      pause();
      save();
    }
    disconnect();
    setSource("keyboard");
    notify(
      options.current.mode === "listen"
        ? "The piano disconnected. Waiting for it to reconnect."
        : "Your input device disconnected and practice is paused. Reconnect it or use the on-screen keys.",
    );
  }, [pause, save, disconnect, notify]);

  useEffect(() => {
    mounted.current = true;
    // Keep the controls consistent after a development refresh or remount.
    publish();
    const setIosWake = (enabled: boolean) => {
      if (Capacitor.getPlatform() === "ios")
        void PianoWake.setEnabled({ enabled }).catch(() => {});
    };
    setIosWake(!document.hidden);
    const suspendInput = () => {
      pause();
      save();
      if (options.current.source === "microphone") {
        disconnect();
        setSource("keyboard");
      }
      keyboardHeld.current.clear();
      keyboardOwners.current.clear();
      setHeldPitches([]);
    };
    const hidden = () => {
      setIosWake(!document.hidden);
      if (document.hidden && options.current.mode !== "listen") suspendInput();
      else if (
        !document.hidden &&
        options.current.mode === "listen" &&
        engine.current.running
      )
        void readyAudio().catch((error) => notify((error as Error).message));
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("qinban-desktop-before-close", suspendInput);
    const nativeListener = Capacitor.isNativePlatform()
      ? NativeApp.addListener("appStateChange", (state) => {
          setIosWake(state.isActive);
          if (!state.isActive && options.current.mode !== "listen")
            suspendInput();
          else if (state.isActive) {
            if (options.current.mode === "listen" && engine.current.running)
              void readyAudio().catch((error) =>
                notify((error as Error).message),
              );
            if (midiSession.preference === "midi") {
              setHeldPitches(midiSession.held);
              void midiSession.ensureConnected();
            }
          }
        })
      : null;
    let wake: WakeLockSentinel | undefined;
    if ("wakeLock" in navigator && Capacitor.getPlatform() !== "ios")
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (mounted.current) wake = lock;
          else void lock.release();
        })
        .catch(() => {});
    return () => {
      mounted.current = false;
      demoAbort.current?.abort();
      setIosWake(false);
      playbackGeneration.current++;
      keySoundGeneration.current++;
      engine.current.listenSeconds = audioTransport.current?.stop();
      engine.current.running = false;
      save();
      disconnect();
      audioTransport.current?.stop();
      stopPlayback();
      clearTimeout(pressTimeout.current);
      clearTimeout(hitTimeout.current);
      clearTimeout(wrongPitchTimeout.current);
      cancelBluetoothMidiSearch();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("qinban-desktop-before-close", suspendInput);
      void nativeListener?.then((listener) => listener.remove());
      void wake?.release();
    };
  }, [disconnect, pause, save, publish, notify]);

  useEffect(() => {
    watchMidiDevices();
    let previousDevice = midiSession.state.device;
    const unsubscribe = midiSession.subscribe(
      (note, held) => {
        if (options.current.source !== "midi" || document.hidden) return;
        setHeldPitches(held);
        if (note.on && note.velocity > 0) handler.current(note.pitch, held);
      },
      (state) => {
        setDeviceName(state.device?.name ?? "");
        if (state.device && midiSession.preference === "midi") {
          inputCleanup.current?.();
          inputCleanup.current = null;
          setSource("midi");
          setHeldPitches(midiSession.held);
          setInputError("");
        } else if (
          previousDevice &&
          !state.device &&
          midiSession.preference === "midi"
        ) {
          if (options.current.mode !== "listen") {
            pause();
            save();
          }
          setSource("keyboard");
          setHeldPitches([]);
          setFeedback({
            text: state.error || "The piano disconnected. Waiting for it to reconnect.",
            kind: "neutral",
          });
        }
        previousDevice = state.device;
      },
    );
    if (midiSession.preference === "midi") void midiSession.ensureConnected();
    return unsubscribe;
  }, [pause, save]);

  const nextDemo = useCallback(async () => {
    const control = demoControl.current;
    if (!control.onNextDemo || demoAbort.current) return;
    pause();
    const controller = new AbortController();
    demoAbort.current = controller;
    setBusyNext(true);
    setFeedback({ text: "Preparing the next song…", kind: "neutral" });
    try {
      const loaded = await control.onNextDemo(
        {
          hands: options.current.hands,
          speedRatio: options.current.tempo / song.tempo,
          autoTurn: control.autoTurn,
          metronome: options.current.metronome,
        },
        controller.signal,
      );
      if (!loaded && !controller.signal.aborted && mounted.current)
        notify("The next song could not load. Check the network or choose another piece.");
    } catch {
      if (!controller.signal.aborted && mounted.current)
        notify("The next song could not load. Check the network or choose another piece.");
    } finally {
      if (demoAbort.current === controller && mounted.current) {
        demoAbort.current = null;
        setBusyNext(false);
      }
    }
  }, [pause, song.tempo, notify]);

  const finish = useCallback(() => {
    const e = engine.current;
    e.completed = e.startedIndex === 0;
    e.loops++;
    const shuffle =
      options.current.mode === "listen" && demoControl.current.shuffleDemo;
    if (options.current.loop && !shuffle) {
      // Each loop has its own score. A partial next loop cannot inflate the
      // completed round's leaderboard entry.
      save(e.completed);
      const next = freshSession();
      next.running = true;
      next.loops = e.loops;
      next.lastTick = performance.now();
      next.lastActivity = next.lastTick;
      engine.current = next;
      setHit(null);
      clearTimeout(hitTimeout.current);
      if (options.current.mode === "listen") audioTransport.current?.start();
      next.startTime =
        performance.now() +
        (song.meter * 60000) / options.current.clock.bpmAt(0);
      evaluator.current.reset();
      setFeedback({
        text: "Round {count} complete. Take a breath; the next round starts shortly.",
        values: { count: e.loops },
        kind: "correct",
      });
    } else {
      playbackGeneration.current++;
      e.running = false;
      // A finished transport has consumed every event, including the final onset.
      e.index = options.current.events.length;
      save(e.completed);
      setCountdown(null);
      if (
        options.current.mode !== "listen" &&
        options.current.source !== "keyboard"
      )
        stopPlayback();
      if (options.current.mode !== "listen") setResult({ ...e });
      else
        setFeedback({
          text: "The demonstration is finished. Try it yourself in Wait for Notes mode.",
          kind: "neutral",
        });
    }
    publish();
    if (shuffle) void nextDemo();
  }, [save, publish, song.meter, nextDemo]);

  // The meter belongs to the current score; this ref also avoids timer re-subscription.
  const meterRef = useRef(song.meter);
  meterRef.current = song.meter;
  const advance = useCallback(() => {
    const e = engine.current;
    e.index++;
    if (
      e.index >= options.current.events.length &&
      options.current.mode === "wait"
    )
      finish();
    publish();
  }, [finish, publish]);

  const onNote = useCallback(
    (pitch: number, held?: readonly number[]) => {
      setPressed(pitch);
      clearTimeout(pressTimeout.current);
      pressTimeout.current = setTimeout(() => setPressed(null), 220);
      const opts = options.current;
      if (opts.mode === "game") return;
      let e = engine.current;
      if (!opts.events.length) return;
      if (opts.mode !== "listen" && !e.running) {
        if (e.completed || e.index >= opts.events.length) return;
        if (opts.source === "microphone" && !inputCleanup.current) {
          setFeedback({
            text: "Turn on the microphone before starting practice.",
            kind: "neutral",
          });
          return;
        }
        if (e.saved) {
          engine.current = freshSession();
          e = engine.current;
          evaluator.current.reset();
        }
        const now = performance.now();
        playbackGeneration.current++;
        setBusyAudio(false);
        e.running = true;
        e.lastActivity = now;
        e.lastTick = now;
        e.startBeat = opts.events[e.index]?.beat ?? 0;
        e.startTime = now;
        e.lastClick = -999;
        setCountdown(null);
        publish();
      }
      if (opts.source === "keyboard") {
        const attack = keyboardAttacks.current.get(pitch),
          generation = keySoundGeneration.current,
          attackTime =
            keyboardAttackTimes.current.get(pitch) ?? performance.now();
        void readyAudio([pitch])
          .then(() => {
            if (
              mounted.current &&
              generation === keySoundGeneration.current &&
              options.current.source === "keyboard" &&
              keyboardAttacks.current.get(pitch) === attack
            ) {
              if (
                keyboardHeld.current.has(pitch) ||
                (options.current.pedal && performance.now() - attackTime < 750)
              ) {
                playPianoKey(pitch);
                if (!keyboardHeld.current.has(pitch)) releasePianoKey(pitch);
              } else if (performance.now() - attackTime < 750)
                playPiano(
                  pitch,
                  Math.max(
                    0.08,
                    Math.min(
                      0.3,
                      ((keyboardReleaseTimes.current.get(pitch) ?? attackTime) -
                        attackTime) /
                        1000,
                    ),
                  ),
                );
            }
          })
          .catch(() => {});
      }
      if (opts.mode === "listen") return;
      if (opts.mode === "rhythm" && performance.now() < e.startTime) return;
      e.lastActivity = performance.now();
      const event = opts.events[e.index];
      if (!event) return;
      if (opts.mode === "rhythm") {
        const beat = practiceBeatAt(
          opts.clock,
          e.startBeat,
          e.startTime,
          performance.now(),
        );
        if (Math.abs(beat - event.beat) > 0.48) {
          setFeedback({
            text: "Wait for the beat and follow the count-in.",
            kind: "neutral",
          });
          return;
        }
      }
      // Both practice modes advance on a fresh attack matching any target.
      // Other fingers in the same chord must not become wrong notes in the next group.
      const now = performance.now();
      if (
        !event.pitches.includes(pitch) &&
        recentHit.current &&
        now - recentHit.current.time < 90 &&
        recentHit.current.pitches.includes(pitch)
      )
        return;
      const verdict = event.pitches.includes(pitch) ? "correct" : "wrong";
      if (verdict === "correct") {
        e.correct++;
        const unplayed = event.pitches.filter((target) => target !== pitch);
        e.missed += unplayed.length;
        if (unplayed.length)
          e.mistakes.push({
            measure: event.measure,
            expected: unplayed,
            played: -1,
            kind: "missed",
          });
        flashWrongPitches(unplayed);
        recentHit.current = { time: now, pitches: event.pitches };
        const timing =
          opts.mode === "rhythm"
            ? practiceBeatAt(
                opts.clock,
                e.startBeat,
                e.startTime,
                performance.now(),
              ) - event.beat
            : undefined;
        const reward = awardHit(e.game, timing);
        e.game = reward.score;
        setHit({
          id: ++hitId.current,
          judgement: reward.judgement,
          earned: reward.earned,
          combo: reward.score.combo,
        });
        clearTimeout(hitTimeout.current);
        hitTimeout.current = setTimeout(() => setHit(null), 650);
        e.statuses = {
          ...e.statuses,
          ...eventHitStatuses(song, event, pitch),
        };
        setFeedback({
          text: "{judgement}! +{points} points · {combo} combo",
          values: {
            judgement: opts.mode === "rhythm" ? reward.judgement : "Correct",
            points: reward.earned,
            combo: reward.score.combo,
          },
          kind: "correct",
        });
        advance();
      } else {
        flashWrongPitches([pitch]);
        e.wrong++;
        e.game = { ...e.game, combo: 0 };
        setHit(null);
        e.mistakes.push({
          measure: event.measure,
          expected: event.pitches,
          played: pitch,
          kind: "wrong",
        });
        e.statuses = {
          ...e.statuses,
          ...Object.fromEntries(event.noteIds.map((id) => [id, "wrong"])),
        };
        setFeedback({
          text: "Expected {expected}; you played {played}. Try again.",
          values: {
            expected: event.pitches.map(noteName).join(" + "),
            played: noteName(pitch),
          },
          kind: "wrong",
        });
        publish();
      }
    },
    [advance, publish, flashWrongPitches, song],
  );
  handler.current = onNote;

  useEffect(() => {
    if (!session.running) return;
    let frame = 0,
      lastUiTick = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastUiTick < 1000 / 30) return;
      lastUiTick = now;
      const e = engine.current,
        opts = options.current;
      if (!e.running) return;
      if (e.lastTick && opts.mode !== "listen" && now - e.lastActivity < 30000)
        e.activeSeconds += Math.min(0.2, (now - e.lastTick) / 1000);
      e.lastTick = now;
      if (opts.mode === "wait") {
        publish();
        return;
      }
      const ms = 60000 / opts.clock.bpmAt(e.startBeat);
      const relative = (now - e.startTime) / ms;
      if (relative < 0 && opts.mode !== "listen") {
        setCountdown(Math.ceil(-relative));
        const click = Math.floor(relative);
        if (click !== e.lastClick) {
          if (opts.source !== "microphone")
            playClick(click === -meterRef.current);
          e.lastClick = click;
        }
        publish();
        return;
      }
      setCountdown(null);
      const beat =
        opts.mode === "listen"
          ? (audioTransport.current?.beat ?? e.startBeat)
          : practiceBeatAt(opts.clock, e.startBeat, e.startTime, now);
      const click = Math.floor(beat);
      if (click !== e.lastClick) {
        if (opts.metronome && opts.source !== "microphone")
          playClick(click % meterRef.current === 0);
        e.lastClick = click;
      }
      if (opts.mode === "listen") {
        const transport = audioTransport.current;
        if (transport) {
          e.index = transport.index;
          if (transport.done) {
            finish();
            return;
          }
        }
      } else {
        while (
          e.index < opts.events.length &&
          opts.events[e.index].beat < beat - 0.48
        ) {
          const event = opts.events[e.index];
          e.missed += event.pitches.length;
          e.game = { ...e.game, combo: 0 };
          setHit(null);
          e.mistakes.push({
            measure: event.measure,
            expected: event.pitches,
            played: -1,
            kind: "missed",
          });
          e.statuses = {
            ...e.statuses,
            ...Object.fromEntries(event.noteIds.map((id) => [id, "wrong"])),
          };
          e.index++;
          evaluator.current.reset();
          setFeedback({
            text: "You missed this group. Keep going and revisit it afterwards.",
            kind: "wrong",
          });
        }
      }
      if (opts.mode !== "listen" && beat >= totalBeats) {
        finish();
        return;
      }
      publish();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finish, publish, totalBeats, session.running]);

  const prepareListen = useCallback(
    async (
      selected = options.current.events,
      startIndex = engine.current.index,
    ) => {
      const generation = playbackGeneration.current;
      const opts = options.current;
      const key = `${opts.from}:${opts.to}:${opts.tempo}:${playbackStyle}:${pedal}`;
      let plan =
        planCache.current?.events === selected && planCache.current.key === key
          ? planCache.current.plan
          : undefined;
      if (!plan) {
        plan = makePerformance(
          selected,
          rangeBeats(song, opts.from, opts.to),
          opts.tempo,
          song.meter,
          playbackStyle,
          pedal,
          opts.clock.points,
        );
        planCache.current = { events: selected, key, plan };
      }
      const offset =
        engine.current.listenSeconds ?? plan.events[startIndex]?.time ?? 0;
      const initial = plan.events
        .filter(
          (event) => event.time >= offset - 0.001 && event.time <= offset + 1,
        )
        .flatMap((event) => event.notes);
      await preparePianoNotes(initial);
      const context = await readyAudio();
      if (!mounted.current || generation !== playbackGeneration.current) return;
      const transport = new AudioTransport(
        context,
        plan,
        (note, audioTime, chordSize) =>
          playPianoAt(
            note.pitch,
            note.duration,
            0.17 / Math.sqrt(chordSize),
            audioTime,
            note.velocity,
          ),
        preparePianoNotes,
        pianoNotesReady,
        (error) => {
          pause();
          notify(error.message || "Piano sound loading stopped. Press Play to continue.");
        },
        (notes, signal) => prefetchPianoNotes(notes, { signal, decode: false }),
      );
      audioTransport.current?.stop();
      audioTransport.current = transport;
      return { transport, offset };
    },
    [song, playbackStyle, pedal, pause, notify],
  );
  async function startPause() {
    if (busyNext) {
      cancelNextDemo();
      return;
    }
    if (engine.current.running) {
      pause();
      return;
    }
    if (!events.length) {
      notify("This part has no playable notes. Choose the right hand or both hands.");
      return;
    }
    if (mode !== "listen" && source === "microphone" && !inputCleanup.current) {
      notify("Turn on the microphone before starting practice.");
      return;
    }
    if (mode !== "listen" && source === "midi" && !midiSession.state.device) {
      setShowInput(true);
      return;
    }
    if (engine.current.saved || engine.current.index >= events.length) {
      engine.current = freshSession();
      evaluator.current.reset();
    }
    const generation = ++playbackGeneration.current;
    setBusyAudio(true);
    const endPrepare = timeWork("playbackStartup");
    try {
      if (mode === "listen") {
        const prepared = await prepareListen();
        if (!prepared) return;
        if (generation === playbackGeneration.current && mounted.current)
          prepared.transport.start(prepared.offset);
      } else await readyAudio();
      if (generation !== playbackGeneration.current || !mounted.current) return;
    } catch (error) {
      if (mounted.current && generation === playbackGeneration.current)
        notify(
          (error as Error).message || "Audio output could not start. Check your device settings.",
        );
      return;
    } finally {
      endPrepare();
      if (mounted.current && generation === playbackGeneration.current)
        setBusyAudio(false);
    }
    const e = engine.current,
      now = performance.now();
    e.running = true;
    e.lastActivity = now;
    e.lastTick = now;
    e.startBeat = events[e.index]?.beat ?? 0;
    e.listenIndex = e.index;
    e.startTime =
      now +
      (mode === "rhythm"
        ? (song.meter * 60000) / options.current.clock.bpmAt(e.startBeat)
        : mode === "listen"
          ? 120
          : 0);
    e.lastClick = -999;
    setFeedback({
      text:
        mode === "wait"
          ? "Play the highlighted notes. The score will wait for you."
          : mode === "listen"
            ? "Listen to the melody and follow the moving notes."
            : "Follow the count-in and keep playing in time.",
      kind: "neutral",
    });
    publish();
  }
  useEffect(() => {
    if (!demoLaunch) return;
    // Defer one task so Strict Mode's throwaway mount cannot start a second transport.
    const timer = setTimeout(() => void startPause(), 0);
    return () => clearTimeout(timer);
    // Autoplay belongs to this song's mount, not subsequent UI updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function playFullScore() {
    if (engine.current.running && options.current.mode === "listen") {
      pause();
      return;
    }
    reset();
    if (source === "microphone") {
      disconnect();
      setSource("keyboard");
    }
    const allEvents = fullEvents;
    setMode("listen");
    setHands("both");
    setFrom(0);
    setTo(song.measures.length - 1);
    setTempo(song.defaultPracticeTempo ?? song.tempo);
    setLoop(false);
    setMetronome(false);
    options.current = {
      ...options.current,
      mode: "listen",
      hands: "both",
      from: 0,
      to: song.measures.length - 1,
      tempo: song.defaultPracticeTempo ?? song.tempo,
      clock: new TempoTimeline(rangeTempoMap(song), song.tempo),
      loop: false,
      metronome: false,
      events: allEvents,
    };
    const generation = ++playbackGeneration.current;
    setBusyAudio(true);
    setFeedback({ text: "Preparing piano sounds…", kind: "neutral" });
    try {
      const prepared = await prepareListen(allEvents, 0);
      if (
        !prepared ||
        !mounted.current ||
        generation !== playbackGeneration.current
      )
        return;
      prepared.transport.start(0);
      const now = performance.now();
      engine.current = {
        ...freshSession(),
        running: true,
        startTime: now + 120,
        lastTick: now,
        lastActivity: now,
      };
      setFeedback({
        text:
          playbackStyle === "expressive"
            ? "Expressive touch brings out the melody and dynamics, following the score's tempo changes."
            : "Playing both hands with the score's tempo changes.",
        kind: "neutral",
      });
      publish();
    } catch (error) {
      if (mounted.current && generation === playbackGeneration.current)
        notify((error as Error).message || "Piano sounds could not load. Please try again.");
    } finally {
      if (mounted.current && generation === playbackGeneration.current)
        setBusyAudio(false);
    }
  }
  const selectMeasure = useCallback(
    // Page navigation never scrolls a partially visible staff into view.
    (measure: number, beat = 0) => {
      cancelNextDemo();
      const opts = options.current;
      if (measure < opts.from || measure > opts.to) return;
      const index = opts.events.findIndex(
        (event) =>
          event.measure === measure &&
          (event.localBeat ?? event.beat % meterRef.current) >= beat - 0.000001,
      );
      if (index < 0) return;
      playbackGeneration.current++;
      keySoundGeneration.current++;
      setBusyAudio(false);
      if (engine.current.running) {
        audioTransport.current?.stop();
        engine.current.running = false;
        stopPlayback();
        setCountdown(null);
      }
      // Start a new segment so completed statistics do not pretend skipped notes were played.
      save();
      engine.current = freshSession();
      engine.current.index = index;
      engine.current.startedIndex = index;
      evaluator.current.reset();
      publish();
    },
    [publish, save, cancelNextDemo],
  );
  const playFromMeasure = useCallback(
    async (measure: number, beat = 0) => {
      if (measure < 0 || measure >= song.measures.length) return;
      const opts = options.current;
      const inside = measure >= opts.from && measure <= opts.to;
      const rangeFrom = inside ? opts.from : 0;
      const rangeTo = inside ? opts.to : song.measures.length - 1;
      const selected = inside
        ? opts.events
        : getEvents(song, opts.hands, rangeFrom, rangeTo);
      const index = selected.findIndex(
        (event) =>
          event.measure > measure ||
          (event.measure === measure &&
            (event.localBeat ?? event.beat % song.meter) >= beat - 0.000001),
      );
      if (index < 0) {
        notify("There are no playable notes after this position.");
        return;
      }
      pause();
      save();
      if (opts.source === "microphone") {
        disconnect();
        setSource("keyboard");
      }
      setMode("listen");
      setFrom(rangeFrom);
      setTo(rangeTo);
      options.current = {
        ...opts,
        mode: "listen",
        source: opts.source === "microphone" ? "keyboard" : opts.source,
        from: rangeFrom,
        to: rangeTo,
        events: selected,
      };
      engine.current = { ...freshSession(), index, startedIndex: index };
      evaluator.current.reset();
      setResult(null);
      setHit(null);
      clearTimeout(hitTimeout.current);
      publish();
      const generation = ++playbackGeneration.current;
      setBusyAudio(true);
      try {
        const prepared = await prepareListen(selected, index);
        if (
          !prepared ||
          !mounted.current ||
          generation !== playbackGeneration.current
        )
          return;
        prepared.transport.start(prepared.offset);
        const now = performance.now();
        Object.assign(engine.current, {
          running: true,
          lastActivity: now,
          lastTick: now,
          startBeat: selected[index].beat,
          listenIndex: index,
          startTime: now + 120,
          lastClick: -999,
        });
        setFeedback({
          text: "Playing a demo from measure {measure}, beat {beat}.",
          values: {
            measure: measure + 1,
            beat: Number((beat + 1).toFixed(2)),
          },
          kind: "neutral",
        });
        publish();
      } catch (error) {
        if (mounted.current && generation === playbackGeneration.current)
          notify((error as Error).message || "Piano sounds could not load. Please try again.");
      } finally {
        if (mounted.current && generation === playbackGeneration.current)
          setBusyAudio(false);
      }
    },
    [song, pause, save, disconnect, publish, prepareListen, notify],
  );
  const configure = (change: () => void) => {
    reset();
    change();
  };
  const changeHands = (target: Hands) => {
    if (source === "microphone" && target === "both") {
      notify("Microphone input supports one note at a time. Connect MIDI to practise both hands.");
      return;
    }
    configure(() => setHands(target));
  };
  const changeMode = (target: PracticeMode) =>
    configure(() => {
      setMode(target);
      setFeedback({
        text:
          target === "listen"
            ? "Press Play to hear the demonstration."
            : target === "wait"
              ? "Play the highlighted keys to begin. The score waits until the notes are correct."
              : "Play the first note group to begin. Your first attack sets the starting beat.",
        kind: "neutral",
      });
      if (target === "listen" && source === "microphone") {
        disconnect();
        setSource("keyboard");
      }
      if (target !== "listen" && target !== "game" && source !== "microphone")
        void midiSession.ensureConnected();
    });
  async function chooseMicrophone() {
    midiSession.selectInput("microphone");
    setBusy(true);
    setInputError("");
    pause();
    save();
    disconnect();
    const generation = inputGeneration.current;
    try {
      const cleanup = await listenMicrophone(
        setMicReading,
        (pitch) => handler.current(pitch),
        deviceDisconnected,
      );
      if (!mounted.current || generation !== inputGeneration.current) {
        cleanup();
        return;
      }
      inputCleanup.current = cleanup;
      setSource("microphone");
      setHands("right");
      setMode("wait");
      setMetronome(false);
      engine.current = freshSession();
      evaluator.current.reset();
      publish();
      setShowInput(false);
      setFeedback({
        text: "Microphone input is ready. Play one hand at a time and turn off accompaniment and sustain.",
        kind: "neutral",
      });
    } catch (error) {
      if (!mounted.current || generation !== inputGeneration.current) return;
      const message = await microphoneError(error);
      if (!mounted.current || generation !== inputGeneration.current) return;
      setSource("keyboard");
      setInputError(message);
    } finally {
      if (mounted.current && generation === inputGeneration.current)
        setBusy(false);
    }
  }
  async function searchMidi(transport: "usb" | "bluetooth" = "usb") {
    const generation = ++inputGeneration.current;
    bluetoothSearching.current = transport === "bluetooth";
    setBusy(true);
    setSearchTransport(transport);
    setInputError("");
    try {
      const found =
        transport === "bluetooth"
          ? await bluetoothMidiDevices()
          : await midiDevices();
      if (!mounted.current || generation !== inputGeneration.current) return;
      setDevices(found);
      if (!found.length)
        setInputError(
          transport === "bluetooth"
            ? "No Bluetooth MIDI device found. Enable Bluetooth MIDI on your piano, close other apps connected to it, and search again. Bluetooth audio alone does not send note events."
            : "No device found. Connect a compatible USB MIDI piano, then select Search Again.",
        );
    } catch (error) {
      if (mounted.current && generation === inputGeneration.current)
        setInputError((error as Error).message);
    } finally {
      if (mounted.current && generation === inputGeneration.current) {
        bluetoothSearching.current = false;
        setBusy(false);
      }
    }
  }
  async function chooseMidi(device: MidiDevice) {
    setBusy(true);
    setInputError("");
    pause();
    save();
    disconnect();
    const generation = inputGeneration.current;
    try {
      const connected = await midiSession.connect(device);
      if (!mounted.current || generation !== inputGeneration.current) {
        return;
      }
      if (!connected) return;
      setSource("midi");
      setDeviceName(device.name);
      engine.current = freshSession();
      evaluator.current.reset();
      publish();
      setShowInput(false);
      setFeedback({
        text: "Connected to {device}. You can start practising on your piano.",
        values: { device: device.name },
        kind: "neutral",
      });
    } catch (error) {
      if (!mounted.current || generation !== inputGeneration.current) return;
      setSource("keyboard");
      setInputError((error as Error).message);
    } finally {
      if (mounted.current && generation === inputGeneration.current)
        setBusy(false);
    }
  }
  const keyboardNote = useCallback((pitch: number, owner = "keyboard") => {
    if (options.current.source !== "keyboard") return;
    let owners = keyboardOwners.current.get(pitch);
    if (!owners) {
      owners = new Set();
      keyboardOwners.current.set(pitch, owners);
    }
    if (owners.has(owner)) return;
    owners.add(owner);
    if (
      options.current.source === "keyboard" &&
      !keyboardHeld.current.has(pitch)
    ) {
      keyboardHeld.current.add(pitch);
      keyboardAttackTimes.current.set(pitch, performance.now());
      keyboardAttacks.current.set(
        pitch,
        (keyboardAttacks.current.get(pitch) ?? 0) + 1,
      );
      const held = [...keyboardHeld.current];
      setHeldPitches(held);
      handler.current(pitch, held);
    }
  }, []);
  const keyboardRelease = useCallback((pitch: number, owner = "keyboard") => {
    const owners = keyboardOwners.current.get(pitch);
    owners?.delete(owner);
    if (owners?.size) return;
    keyboardOwners.current.delete(pitch);
    keyboardHeld.current.delete(pitch);
    keyboardReleaseTimes.current.set(pitch, performance.now());
    if (options.current.source === "keyboard") {
      releasePianoKey(pitch);
      setHeldPitches([...keyboardHeld.current]);
    }
  }, []);
  const playbackPosition = useCallback(() => {
    const transport = audioTransport.current;
    if (options.current.mode === "listen" && transport)
      return {
        seconds: transport.seconds,
        plan: transport.plan,
        moving: engine.current.running,
      };
    const e = engine.current,
      opts = options.current;
    const beat =
      opts.mode === "rhythm" && e.running
        ? Math.max(
            0,
            practiceBeatAt(
              opts.clock,
              e.startBeat,
              e.startTime,
              performance.now(),
            ),
          )
        : (opts.events[e.index]?.beat ?? 0);
    return {
      beat,
      clock: opts.clock,
      moving: opts.mode === "rhythm" && e.running,
    };
  }, []);
  const current = events[Math.min(session.index, events.length - 1)];
  const activeIds = current?.noteIds ?? [];
  const currentMeasure = current?.measure ?? from;
  const expected = current?.pitches ?? [];
  const handHints = useMemo(() => {
    const measure = song.measures[current?.measure ?? 0];
    const pitches = (hand: "right" | "left") => [
      ...new Set(
        measure?.[hand]
          .filter((n) => current?.noteIds.includes(n.id))
          .flatMap((n) => n.pitches) ?? [],
      ),
    ];
    return { right: pitches("right"), left: pitches("left") };
  }, [song, current]);
  const percentage = events.length
    ? Math.min(100, (session.index / events.length) * 100)
    : 0;
  const InputIcon =
    source === "microphone"
      ? Mic
      : source === "midi"
        ? midiSession.state.device?.transport === "bluetooth"
          ? Bluetooth
          : Usb
        : KeyboardIcon;
  function exit() {
    pause();
    save();
    disconnect();
    onExit();
  }
  function skip() {
    const e = engine.current,
      event = options.current.events[e.index];
    if (!event || mode === "listen") return;
    e.missed++;
    e.game = { ...e.game, combo: 0 };
    setHit(null);
    e.mistakes.push({
      measure: event.measure,
      expected: event.pitches,
      played: -1,
      kind: "missed",
    });
    e.statuses = {
      ...e.statuses,
      ...Object.fromEntries(event.noteIds.map((id) => [id, "wrong"])),
    };
    evaluator.current.reset();
    advance();
  }
  if (mode === "game")
    return (
      <PianoGame
        song={song}
        initialHands={hands}
        initialTempo={tempo}
        onMode={changeMode}
        onExit={exit}
        onSave={onSave}
        records={records}
        notify={notify}
        toast={toast}
      />
    );
  return (
    <div className={`practice-app ${hit ? "has-hit" : ""}`}>
      <header className="practice-header">
        <button type="button" className="back-button" onClick={exit}>
          <ArrowLeft size={21} />
          <span>{t("Back")}</span>
        </button>
        <div className="practice-title">
          <h1>
            <a
              href={import.meta.env.VITE_PIANO_WEBSITE || undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={t("Open the Xiaoma Piano website")}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {songTitle(song, locale)}
            </a>
            <small className="practice-artist">{displayArtist(song)}</small>
          </h1>
        </div>
        {song.editionLabel?.includes("OMR draft · review pending") && (
          <button
            type="button"
            className="practice-edition-notice"
            onClick={() => setShowHelp(true)}
          >
            {t("OMR draft · review pending")}
          </button>
        )}
        <div className="piano-selectors">
          <select
            aria-label={t("Piano sound")}
            value={voice}
            onChange={(e) => {
              pause();
              const value = e.target.value as PianoVoice;
              setPianoVoice(value);
              setVoice(value);
            }}
          >
            {PIANO_VOICES.map((piano) => (
              <option key={piano.id} value={piano.id}>
                {t(piano.name)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Playback style")}
            value={playbackStyle}
            onChange={(e) => {
              pause();
              const value = e.target.value as PlaybackStyle;
              setPlaybackStyle(value);
              engine.current.listenSeconds = undefined;
              try {
                localStorage.setItem("qinban-playback-style", value);
              } catch {
                /* Optional preference. */
              }
            }}
          >
            <option value="expressive">{t("Expressive")}</option>
            <option value="score">{t("Written rhythm")}</option>
          </select>
        </div>
        <div className="practice-header-actions">
          <OfflineSongControl song={song} />
          <LanguageToggle />
          <ThemeToggle />
          <button
            type="button"
            className="icon-button"
            aria-label={t("Song leaderboard")}
            title={t("Song leaderboard and practice progress")}
            onClick={() => {
              pause();
              setShowLeaderboard(true);
            }}
          >
            <Trophy size={19} />
          </button>
          <button
            type="button"
            className="full-score-play"
            disabled={busyAudio}
            onClick={() => void playFullScore()}
          >
            {mode === "listen" && session.running ? (
              <Pause size={16} />
            ) : (
              <Volume2 size={17} />
            )}
            <span>
              {busyAudio
                ? t("Loading sounds…")
                : mode === "listen" && session.running
                  ? t("Pause demo")
                  : t("Play full score")}
            </span>
          </button>
          <button
            type="button"
            className={`input-status ${source === "microphone" ? "listening" : ""}`}
            aria-label={
              source === "microphone"
                ? t("Microphone on")
                : source === "midi"
                  ? t("MIDI connected")
                  : t("On-screen keys")
            }
            onClick={() => {
              setInputError("");
              setShowInput(true);
            }}
          >
            <InputIcon size={17} />
            <span>
              {source === "microphone"
                ? t("Microphone on")
                : source === "midi"
                  ? t("MIDI connected")
                  : t("On-screen keys")}
            </span>
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("Practice help")}
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={21} />
          </button>
        </div>
      </header>
      <div className="practice-toolbar">
        <AnimatedSegmented
          value={notation}
          className="segmented notation-switch"
          role="group"
          aria-label={t("Notation")}
        >
          {[
            { id: "staff", label: t("Staff") },
            { id: "beginner", label: t("Easy numbers") },
            { id: "numbered", label: t("Numbered") },
            { id: "waterfall", label: t("Waterfall") },
            { id: "hybrid", label: t("Number hints") },
          ].map((n) => (
            <button
              type="button"
              key={n.id}
              data-segment-id={n.id}
              aria-pressed={notation === n.id}
              className={notation === n.id ? "selected" : ""}
              onClick={() => onNotation(n.id as Notation)}
            >
              {n.label}
            </button>
          ))}
        </AnimatedSegmented>
        <div className="toolbar-divider" />
        <AnimatedSegmented
          value={hands}
          className="segmented hand-switch"
          role="group"
          aria-label={t("Practice hands")}
        >
          {[
            { id: "left", label: t("Left hand") },
            { id: "right", label: t("Right hand") },
            { id: "both", label: t("Both hands") },
          ].map((n) => (
            <button
              type="button"
              key={n.id}
              data-segment-id={n.id}
              aria-pressed={hands === n.id}
              className={hands === n.id ? "selected" : ""}
              onClick={() => changeHands(n.id as Hands)}
            >
              {n.label}
            </button>
          ))}
        </AnimatedSegmented>
        <button
          type="button"
          className={`loop-toggle ${loop ? "selected" : ""}`}
          aria-pressed={loop}
          onClick={() => {
            if (!loop) onShuffleDemo?.(false);
            setLoop((v) => !v);
          }}
        >
          <Repeat2 size={17} />
          <span>{t("Loop")}</span>
        </button>
        <div className="toolbar-keyboard-controls">
          <button
            type="button"
            className="icon-button"
            aria-label={showKeyboard ? t("Hide keys") : t("Show keys")}
            title={showKeyboard ? t("Hide keys") : t("Show keys")}
            aria-pressed={showKeyboard}
            onClick={() => {
              setShowKeyboard((v) => !v);
              setExpandedKeyboard(false);
            }}
          >
            <KeyboardIcon size={17} />
            <span>{showKeyboard ? t("Hide keys") : t("Show keys")}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={expandedKeyboard ? t("Restore keys") : t("Enlarge keys")}
            title={expandedKeyboard ? t("Restore keys") : t("Enlarge keys")}
            aria-expanded={expandedKeyboard}
            disabled={!showKeyboard || heldPitches.length > 0}
            onClick={() => setExpandedKeyboard((v) => !v)}
          >
            {expandedKeyboard ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
            <span>{expandedKeyboard ? t("Restore keys") : t("Enlarge keys")}</span>
          </button>
        </div>
        <button
          type="button"
          className="range-button"
          onClick={() => setShowOptions(true)}
        >
          {t("Measures {from}–{to}", { from: from + 1, to: to + 1 })}
          <SlidersHorizontal size={15} />
        </button>
        <button
          type="button"
          className={`auto-turn-toggle ${autoTurn ? "selected" : ""}`}
          aria-pressed={autoTurn}
          onClick={() => setAutoTurn((v) => !v)}
        >
          <BookOpen size={16} />
          <span>{t("Auto-turn")}</span>
        </button>
      </div>
      <div className="practice-workspace">
        {countdown !== null && (
          <div className="practice-countdown" aria-hidden="true">
            <span>{countdown}</span>
          </div>
        )}
        <main
          className={`score-paper ${notation === "waterfall" ? "waterfall-paper" : ""}`}
        >
          <div className="paper-heading">
            {showHints && (
              <div className="hand-hint-legend">
                <span className="left-hand-dot" />
                {t("Left hand")}
                <span className="right-hand-dot" />
                {t("Right hand")}
              </div>
            )}
            <div>
              <h2>{songTitle(song, locale)}</h2>
              <span>{songSubtitle(song, locale)}</span>
            </div>
            <div className="score-signature">
              <span>
                {scoreKeyLabel(
                  notation === "beginner"
                    ? "C"
                    : (song.measures[currentMeasure]?.key ?? song.key),
                )}
              </span>
              <span>{song.signature ?? `${song.meter}/4`}</span>
              <span>
                ♩ = {Math.round(tempoClock.bpmAt(current?.beat ?? 0))}
              </span>
            </div>
          </div>
          <div className="score-view">
            <Score
              song={song}
              notation={notation}
              hands={hands}
              currentMeasure={currentMeasure}
              activeIds={showHints ? activeIds : NO_HINTS}
              statuses={session.statuses}
              from={from}
              to={to}
              onSelect={selectMeasure}
              onPlayFrom={playFromMeasure}
              autoTurn={autoTurn}
              onManualTurn={manualTurn}
              running={session.running}
              playbackPosition={playbackPosition}
            />
          </div>
          <div className="score-paper-footer">
            <span>
              {notation === "beginner"
                ? null
                : notation === "numbered"
                  ? t(
                      "Swipe to turn pages · Click to select; double-click to play · Dots mark octaves, dashes extend notes, and an underline marks eighth notes",
                    )
                  : notation === "waterfall"
                    ? t("Click to select; double-click a bar to play · Swipe to change measures")
                    : t("Swipe to turn pages · Click to select; double-click a note to play")}
            </span>
            <span>{t("{count} measures", { count: song.measures.length })}</span>
          </div>
        </main>
        <aside className="practice-side">
          <div className="side-section">
            <div className="section-kicker">{t("Your practice mode")}</div>
            <AnimatedSegmented
              value={mode}
              className="mode-options"
              role="group"
              aria-label={t("Practice mode")}
            >
              {[
                {
                  id: "wait",
                  title: t("Wait for Notes"),
                  detail: t("Find each note; the score waits for you"),
                  icon: Leaf,
                },
                {
                  id: "rhythm",
                  title: t("Play in Time"),
                  detail: t("Follow the beat and keep the flow"),
                  icon: Clock3,
                },
                {
                  id: "listen",
                  title: t("Listen"),
                  detail: t("Hear how the melody flows first"),
                  icon: Headphones,
                },
                {
                  id: "game",
                  title: t("Piano game"),
                  detail: t("Play the piano keys as the notes reach the line"),
                  icon: Gamepad2,
                },
              ].map((m) => (
                <button
                  type="button"
                  key={m.id}
                  data-segment-id={m.id}
                  aria-pressed={mode === m.id}
                  aria-label={m.title}
                  className={mode === m.id ? "selected" : ""}
                  onClick={() => changeMode(m.id as PracticeMode)}
                >
                  <m.icon size={19} />
                  <span>
                    <strong>{m.title}</strong>
                    <small>{m.detail}</small>
                  </span>
                  {mode === m.id && <Check size={16} />}
                </button>
              ))}
            </AnimatedSegmented>
          </div>
          <div className="side-section now-playing">
            <div className="section-kicker">
              {mode === "listen" ? t("Now playing") : t("Play next")}
            </div>
            <div className="expected-note">
              {expected.map(noteName).join(" + ") || t("Rest")}
            </div>
            <p>
              {t("Measure {count}", { count: currentMeasure + 1 })}
              {current
                ? t(" · Beat {count}", {
                    count: Number(
                      (
                        (current.localBeat ?? current.beat % song.meter) + 1
                      ).toFixed(2),
                    ),
                  })
                : ""}
            </p>
            {source === "microphone" && (
              <div className="mic-live">
                <span className={micReading.midi !== null ? "heard" : ""} />
                <small>
                  {micReading.midi !== null
                    ? t("Heard {note}", { note: noteName(micReading.midi) })
                    : t("Waiting for a clear single note")}
                </small>
              </div>
            )}
            <div className="mini-progress">
              <div style={{ width: `${percentage}%` }} />
            </div>
            <span className="progress-caption">
              {t("{current} / {total} note groups", {
                current: Math.min(session.index, events.length),
                total: events.length,
              })}
              {session.loops
                ? t(" · {count} rounds complete", { count: session.loops })
                : ""}
            </span>
          </div>
          <div className="side-section practice-counts">
            <span>
              <Check size={16} />
              {t("Correct")}
              <strong>{session.correct}</strong>
            </span>
            <span>
              <RotateCcw size={16} />
              {t("Try again")}
              <strong>{session.wrong}</strong>
            </span>
            <span>
              <Clock3 size={16} />
              {t("Practice time")}
              <strong>{durationText(session.activeSeconds)}</strong>
            </span>
          </div>
          <div className="practice-tip">
            <Leaf size={18} />
            <p>{t("Hold keys or slide across them. The sustain pedal keeps the natural tail after release.")}</p>
          </div>
        </aside>
      </div>
      <div className="practice-bottom">
        {mode !== "listen" && (
          <div className="game-hud" aria-label={t("Practice points and combo")}>
            <span className="game-points">
              <small>{t("Points")}</small>
              <strong>
                {session.game.points.toLocaleString(
                  locale === "en" ? "en-US" : "zh-CN",
                )}
              </strong>
            </span>
            <span
              className={`game-combo ${session.game.combo >= 10 ? "combo-hot" : ""}`}
            >
              <strong>{session.game.combo}</strong>
              <small>COMBO</small>
            </span>
            <span className="game-multiplier">
              ×{comboMultiplier(session.game.combo)}
              <small>{t("Combo multiplier")}</small>
            </span>
            <span className="game-hit-slot" aria-hidden="true">
              {hit && (
                <span key={hit.id} className="hit-burst">
                  <strong>{t(hit.judgement)}</strong>
                  <b>+{hit.earned}</b>
                </span>
              )}
            </span>
            <span className="game-best">
              {t("Best combo {count}", { count: session.game.bestCombo })}
            </span>
          </div>
        )}
        <div className={`feedback feedback-${feedback.kind}`} role="status">
          {countdown !== null ? (
            <>
              <span className="countdown-number">{countdown}</span>
              <span>{t("Count-in: get ready")}</span>
            </>
          ) : (
            <>
              {feedback.kind === "correct" ? (
                <Check size={18} />
              ) : feedback.kind === "wrong" ? (
                <RotateCcw size={18} />
              ) : (
                <Leaf size={18} />
              )}
              <span>
                {practiceText(feedback.text, locale, feedback.values)}
              </span>
              <small className="inline-position">
                {t("Measure {count}", { count: currentMeasure + 1 })} ·{" "}
                {expected.map(noteName).join(" + ")} · {Math.round(percentage)}%
              </small>
            </>
          )}
        </div>
        {showKeyboard && (
          <div className="keyboard-wrap">
            <Keyboard
              expanded={expandedKeyboard}
              expected={expected}
              hintEvent={current ? `${song.id}:${current.beat}:${current.noteIds.join(",")}` : undefined}
              rightHints={handHints.right}
              leftHints={handHints.left}
              pressed={pressed}
              wrongPitches={wrongPitches}
              held={heldPitches}
              showHints={showHints}
              onNote={keyboardNote}
              onRelease={keyboardRelease}
            />
          </div>
        )}
        <div className="playback-controls">
          <div className="tempo-control">
            <span>{t("Tempo")}</span>
            <button
              type="button"
              aria-label={t("Slow down")}
              onClick={() =>
                configure(() => setTempo((t) => Math.max(30, t - 5)))
              }
            >
              −
            </button>
            <strong>
              {tempo}
              <small>
                {t(
                  song.tempoIsReference
                    ? "Reference tempo {percent}%"
                    : "Score speed {percent}%",
                  {
                    percent: Math.round((tempo / song.tempo) * 100),
                  },
                )}
              </small>
            </strong>
            <button
              type="button"
              aria-label={t("Speed up")}
              onClick={() =>
                configure(() =>
                  setTempo((t) =>
                    Math.min(Math.max(360, song.tempo * 2), t + 5),
                  ),
                )
              }
            >
              ＋
            </button>
          </div>
          <AnimatedSegmented
            value={mode}
            className="segmented practice-mode-switch"
            role="group"
            aria-label={t("Practice mode")}
          >
            {(
              [
                { id: "wait", label: t("Wait for Notes") },
                { id: "rhythm", label: t("Play in Time") },
                { id: "listen", label: t("Listen") },
                { id: "game", label: t("Piano game") },
              ] as const
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                data-segment-id={item.id}
                aria-pressed={mode === item.id}
                className={mode === item.id ? "selected" : ""}
                onClick={() => changeMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </AnimatedSegmented>
          <div className="playback-center">
            <button
              type="button"
              className="icon-button"
              aria-label={t("Restart practice")}
              onClick={reset}
            >
              <RotateCcw size={21} />
            </button>
            <button
              type="button"
              className="play-button"
              disabled={busyAudio}
              onClick={() => void startPause()}
            >
              {session.running ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
              <span>
                {busyNext
                  ? t("Cancel song change")
                  : busyAudio
                    ? t("Loading sounds…")
                    : session.running
                      ? t("Pause")
                      : mode === "listen"
                        ? t("Play")
                        : t("Start practice")}
              </span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t("Skip this note group")}
              disabled={mode !== "wait" || !session.running}
              onClick={skip}
            >
              <SkipForward size={21} />
            </button>
          </div>
          <div className="playback-right">
            {mode === "listen" && onShuffleDemo && (
              <>
                <button
                  type="button"
                  aria-label={t("Shuffle")}
                  aria-pressed={shuffleDemo}
                  className={shuffleDemo ? "selected" : ""}
                  title={t("Automatically play another song, without repeats within a round")}
                  onClick={() => {
                    if (shuffleDemo) cancelNextDemo();
                    else setLoop(false);
                    onShuffleDemo(!shuffleDemo);
                  }}
                >
                  <Shuffle size={17} />
                  <span>{t("Shuffle")}</span>
                </button>
                {shuffleDemo && (
                  <button
                    type="button"
                    aria-label={t("Next random song")}
                    disabled={busyNext || busyAudio}
                    onClick={() => void nextDemo()}
                  >
                    <SkipForward size={17} />
                    <span>{t("Next song")}</span>
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              aria-pressed={pedal}
              aria-label={t("Sustain")}
              className={pedal ? "selected" : ""}
              title={t("Sustain: keep natural note tails after release; demo playback changes the pedal automatically")}
              onClick={() => {
                if (mode === "listen") {
                  pause();
                  engine.current.listenSeconds = undefined;
                }
                const next = !pedal;
                setPianoSustain(next);
                setPedal(next);
                try {
                  localStorage.setItem("qinban-auto-pedal", String(next));
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              <Footprints size={17} />
              <span>{t("Sustain")}</span>
            </button>
            <label className="volume-control">
              <Volume2 size={17} />
              <span>{t("Volume {value}%", { value: volume })}</span>
              <input
                aria-label={t("Playback volume")}
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setVolume(value);
                  setPlaybackVolume(value / 100);
                  if (value > 0 && muted) {
                    setMuted(false);
                    try {
                      localStorage.setItem("qinban-muted", "false");
                    } catch {
                      /* Storage may be unavailable in private windows. */
                    }
                  }
                }}
              />
            </label>
            <button
              type="button"
              aria-pressed={metronome}
              aria-label={t("Metronome")}
              disabled={source === "microphone"}
              className={metronome ? "selected" : ""}
              onClick={() => setMetronome((v) => !v)}
            >
              <Clock3 size={18} />
              <span>{t("Metronome")}</span>
            </button>
            <button
              type="button"
              aria-pressed={showHints}
              aria-label={t("Key hints")}
              className={showHints ? "selected" : ""}
              onClick={() => setShowHints((v) => !v)}
            >
              <Settings2 size={18} />
              <span>{t("Key hints")}</span>
            </button>
            <button
              type="button"
              className={`mute-toggle${muted ? " selected" : ""}`}
              aria-label={muted ? t("Unmute") : t("Mute")}
              aria-pressed={muted}
              title={muted ? t("Unmute") : t("Mute")}
              onClick={toggleMute}
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              <span>{muted ? t("Unmute") : t("Mute")}</span>
            </button>
          </div>
        </div>
      </div>
      {showOptions && (
        <Modal
          title={t("Focus on this passage")}
          onClose={() => setShowOptions(false)}
        >
          <p className="modal-description">
            {t("Choose the start and end measures, then enable looping to repeat the passage.")}
          </p>
          <label className="setting-row">
            <span>{t("Start measure")}</span>
            <select
              value={from}
              onChange={(e) =>
                configure(() => {
                  const value = Number(e.target.value);
                  setFrom(value);
                  if (to < value) setTo(value);
                })
              }
            >
              {song.measures.map((_, i) => (
                <option key={i} value={i}>
                  {t("Measure {count}", { count: i + 1 })}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            <span>{t("End measure")}</span>
            <select
              value={to}
              onChange={(e) => configure(() => setTo(Number(e.target.value)))}
            >
              {song.measures.map(
                (_, i) =>
                  i >= from && (
                    <option key={i} value={i}>
                      {t("Measure {count}", { count: i + 1 })}
                    </option>
                  ),
              )}
            </select>
          </label>
          <label className="setting-row">
            <span>{t("Repeat automatically")}</span>
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => {
                if (e.target.checked) onShuffleDemo?.(false);
                setLoop(e.target.checked);
              }}
            />
          </label>
          <button
            type="button"
            className="primary-button full-width"
            onClick={() => setShowOptions(false)}
          >
            {t("Practise this passage")}
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {showInput && (
        <Modal
          title={t("Choose your input")}
          onClose={() => {
            if (!busy || bluetoothSearching.current) {
              inputGeneration.current++;
              if (bluetoothSearching.current) cancelBluetoothMidiSearch();
              bluetoothSearching.current = false;
              setBusy(false);
              setShowInput(false);
            }
          }}
        >
          <p className="modal-description">
            {t(
              "Use a microphone with an acoustic piano, or USB/Bluetooth MIDI with a digital piano. Connections stay active between songs and reconnect when the device returns.",
            )}
          </p>
          <button
            type="button"
            className="input-choice"
            disabled={busy}
            onClick={() => {
              reset();
              midiSession.selectInput("keyboard");
              disconnect();
              setSource("keyboard");
              setShowInput(false);
            }}
          >
            <KeyboardIcon size={25} />
            <span>
              <strong>{t("On-screen keys")}</strong>
              <small>{t("Try reading music and practising without connecting an instrument")}</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button
            type="button"
            className="input-choice"
            disabled={busy}
            onClick={() => void chooseMicrophone()}
          >
            <Mic size={25} />
            <span>
              <strong>{busy ? t("Connecting…") : t("Microphone input")}</strong>
              <small>{t("Single-note input; audio is processed on your device")}</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button
            type="button"
            className="input-choice"
            disabled={busy}
            onClick={() => void searchMidi()}
          >
            <Usb size={25} />
            <span>
              <strong>{t("USB MIDI piano")}</strong>
              <small>{t("Receive key events directly, including both hands and chords")}</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button
            type="button"
            className="input-choice"
            disabled={busy}
            onClick={() => void searchMidi("bluetooth")}
          >
            <Bluetooth size={25} />
            <span>
              <strong>
                {busy && searchTransport === "bluetooth"
                  ? t("Searching Bluetooth MIDI…")
                  : t("Bluetooth MIDI piano")}
              </strong>
              <small>{t("TERENCE V60 / V70 and others · Both hands and chords")}</small>
            </span>
            <ArrowRight size={18} />
          </button>
          {devices.length > 0 && (
            <div className="midi-list">
              {devices.map((device) => (
                <button
                  type="button"
                  disabled={busy}
                  key={device.id}
                  onClick={() => void chooseMidi(device)}
                >
                  {device.transport === "bluetooth" ? (
                    <Bluetooth size={18} />
                  ) : (
                    <Usb size={18} />
                  )}
                  <span>{practiceText(device.name, locale)}</span>
                  <span>{t("Connect")}</span>
                </button>
              ))}
            </div>
          )}
          {inputError && (
            <p className="input-error" role="alert">
              {practiceText(inputError, locale)}
            </p>
          )}
          {inputError && Capacitor.isNativePlatform() && (
            <button
              type="button"
              className="text-button"
              onClick={() => void openInputSettings()}
            >
              {t("Open Xiaoma Piano permission settings")}
              <Settings2 size={15} />
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void searchMidi(searchTransport)}
          >
            {t("Search MIDI devices again")}
            <RotateCcw size={15} />
          </button>
        </Modal>
      )}
      {showHelp && (
        <Modal title={t("Make practice easier")} onClose={() => setShowHelp(false)}>
          {song.scoreNotice && (
            <div className="score-edition-details">
              <h3>{t("Score edition")}</h3>
              <p>
                {locale === "en" && song.editionLabel?.includes("OMR draft · review pending")
                  ? "This image-recognized piano arrangement is a draft. Pitch, accidentals, repeats and expression still need page-by-page review."
                  : song.scoreNotice}
              </p>
              {song.originalScoreUrl && (
                <a
                  href={song.originalScoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("View source score")}
                </a>
              )}
            </div>
          )}
          <div className="help-list">
            <p>
              <strong>{t("Score navigation")}</strong>
              {t(
                "Swipe across the score to turn pages. Click a note to select it, or double-click to play a demo from there. Demo playback earns no practice points.",
              )}
            </p>
            <p>
              <strong>{t("Choose a practice mode")}</strong>
              {t(
                "Wait for Notes helps you find notes. Play in Time builds fluency. Listening does not count towards your practice score.",
              )}
            </p>
            <p>
              <strong>{t("One score, three views")}</strong>
              {t("Switch between staff notation, numbered notation, and number hints at any time. Your practice position is preserved.")}
            </p>
            <p>
              <strong>{t("Practise difficult passages")}</strong>
              {t("Choose a measure range at the top and enable looping. Start slowly and learn one passage at a time.")}
            </p>
            <p>
              <strong>{t("Microphone support")}</strong>
              {t(
                "Microphone input supports clear single notes. Both hands, chords, sustain, and accompaniment can affect detection; use MIDI for these.",
              )}
            </p>
            <p>
              <strong>{t("Wait without penalties")}</strong>
              {t(
                "Uncertain sounds do not count as wrong notes in Wait for Notes. Play in Time records unfinished note groups as their beats pass.",
              )}
            </p>
            {song.xml && (
              <p>
                <strong>{t("Full-score playback")}</strong>
                {t(
                  "Playback follows the displayed measure order. Choose expressive or written-rhythm playback and sustain; use measure ranges and loops for difficult passages.",
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            className="primary-button full-width"
            onClick={() => setShowHelp(false)}
          >
            {t("Got it")}
            <Check size={17} />
          </button>
        </Modal>
      )}
      {result && (
        <Modal
          title={t("Every passage is progress")}
          onClose={() => setResult(null)}
        >
          <div className="result-icon">
            <Leaf size={38} strokeWidth={1.2} />
          </div>
          <p className="result-description">
            {songTitle(song, locale)} ·{" "}
            {t("Measures {from}–{to}", { from: from + 1, to: to + 1 })}
          </p>
          <div className="result-grid">
            <div>
              <strong>
                {result.game.points.toLocaleString(
                  locale === "en" ? "en-US" : "zh-CN",
                )}
              </strong>
              <span>{t("Session points")}</span>
            </div>
            <div>
              <strong>{result.game.bestCombo}</strong>
              <span>{t("Best combo")}</span>
            </div>
            <div>
              <strong>{result.correct}</strong>
              <span>{t("Correct groups")}</span>
            </div>
            <div>
              <strong>{result.wrong}</strong>
              <span>{t("Wrong-note attempts")}</span>
            </div>
            <div>
              <strong>{result.missed}</strong>
              <span>{t("Skipped / missed")}</span>
            </div>
          </div>
          <p className="result-note">
            {t("Practice time: {duration}. ", {
              duration: durationText(result.activeSeconds),
            })}
            {result.wrong || result.missed
              ? t("Your session is saved. Return to difficult measures from your practice history.")
              : t("The melody is becoming familiar. Try fewer hints next time.")}
          </p>
          <PracticeProgressNote
            history={getSongPracticeHistory(
              records,
              song.id,
              mode === "rhythm" ? "rhythm" : "wait",
              {
                conditions: {
                  hands,
                  tempo,
                  fromMeasure:
                    result.startedIndex === 0
                      ? from
                      : (events[result.startedIndex]?.measure ?? from),
                  toMeasure: to,
                  rounds: 1,
                  completed: result.completed,
                },
              },
            )}
          />
          <button
            type="button"
            className="text-button result-ranking-link"
            onClick={() => {
              setResult(null);
              setShowLeaderboard(true);
            }}
          >
            <Trophy size={16} />
            {t("View leaderboard and progress")}
          </button>
          <div className="result-actions">
            <button type="button" className="secondary-button" onClick={exit}>
              {t("Back to library")}
            </button>
            <button type="button" className="primary-button" onClick={reset}>
              {t("Practise again")}
              <RotateCcw size={16} />
            </button>
          </div>
        </Modal>
      )}
      {showLeaderboard && (
        <SongLeaderboard
          song={song}
          records={records}
          initialMode={mode === "rhythm" ? "rhythm" : "wait"}
          conditions={{
            hands,
            tempo,
            fromMeasure: from,
            toMeasure: to,
            rounds: 1,
          }}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
      <AnimatedToast>
        {toast ? practiceText(toast, locale) : null}
      </AnimatedToast>
    </div>
  );
}
