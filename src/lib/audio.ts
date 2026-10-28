import type { PianoVoice } from "./pianoVoices";
import type { PerformedNote } from "./performance";
import { estimatePitch } from "./pitch";
import { frequencyToMidi } from "./music";
import { prepareMicrophone } from "./microphone";
import { countWork, measureGauge, timeWork } from "./diagnostics";
import { AsyncLimiter } from "./asyncLimiter";
import { appAsset } from "./assets";
import {
  beginMicrophoneSession,
  preparePlaybackSession,
  stopPlaybackSession,
} from "./audioSession";

let playbackContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let pianoInput: AudioNode | undefined;
let masterVolume = 1;
try {
  const saved = localStorage.getItem("qinban-playback-volume");
  if (saved !== null && Number.isFinite(Number(saved)))
    masterVolume = Math.max(0, Math.min(1, Number(saved)));
} catch {
  /* Storage may be unavailable in a private browser. */
}
const sounding = new Set<AudioScheduledSourceNode>();
interface PianoSound {
  node: AudioBufferSourceNode;
  gain: GainNode;
  end: number;
  live: boolean;
  released: boolean;
}
const heldKeys = new Map<string, PianoSound>();
const liveSounds = new Set<PianoSound>();
const MAX_LIVE_SOURCES = 192; // Enough for all 88 held keys with two velocity layers.
let pianoSustain = false;
let voice: PianoVoice = "yamaha";
try {
  const saved = localStorage.getItem("qinban-piano-voice");
  if (["yamaha", "steinway", "fluid"].includes(saved ?? ""))
    voice = saved as PianoVoice;
} catch {
  /* Optional preference. */
}
const buffers = new Map<string, AudioBuffer>();
const manifests = new Map<PianoVoice, Promise<Record<string, string[]>>>();
let decodedBytes = 0;
const memoryGB =
  typeof navigator === "undefined"
    ? 4
    : ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4);
const cacheBudget =
  (memoryGB >= 8 ? 256 : memoryGB >= 4 ? 192 : 96) * 1024 * 1024;
let pinned = new Set<string>();
const decoder = new AsyncLimiter(memoryGB <= 4 ? 1 : 2);
const downloads = new AsyncLimiter(4);
const encoded = new Map<string, ArrayBuffer>();
const fetching = new Map<string, Promise<ArrayBuffer>>();
let encodedBytes = 0;
function rememberBuffer(key: string, buffer: AudioBuffer) {
  decodedBytes += buffer.length * buffer.numberOfChannels * 4;
  buffers.set(key, buffer);
  // Playing sources retain their buffers; removing old cache entries is safe.
  for (const [oldest, removed] of buffers) {
    if (decodedBytes <= cacheBudget || buffers.size <= 1) break;
    if (pinned.has(oldest)) continue;
    decodedBytes -= removed.length * removed.numberOfChannels * 4;
    buffers.delete(oldest);
    countWork("sampleCacheEvictions");
  }
  measureGauge("sampleCacheMB", +(decodedBytes / 1024 / 1024).toFixed(1));
  measureGauge("sampleCacheBudgetMB", cacheBudget / 1024 / 1024);
}
const loading = new Map<string, Promise<void>>();
let sampleData: Promise<Record<string, string>> | undefined;
const SAMPLE_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
function missingManifest(response: Response) {
  // Development and older app hosts may return the SPA HTML fallback with 200.
  return (
    response.status === 404 ||
    response.headers?.get("content-type")?.includes("text/html")
  );
}
function getManifest(bank: PianoVoice) {
  let request = manifests.get(bank);
  if (!request) {
    request = fetch(appAsset(`/samples/${bank}/manifest.json`))
      .then((response) =>
        missingManifest(response)
          ? fetch(appAsset(`/audio/${bank}/manifest.json`))
          : response,
      )
      .then(async (response) => {
        // Older installed packages contain the legacy lightweight JSON bank.
        if (bank === "fluid" && missingManifest(response)) return {};
        if (!response.ok) throw new Error("Grand piano samples could not load. Please try again.");
        return response.json() as Promise<Record<string, string[]>>;
      })
      .catch((error) => {
        manifests.delete(bank);
        throw error;
      });
    manifests.set(bank, request);
  }
  return request;
}
function anchor(pitch: number, bank: PianoVoice) {
  return bank === "fluid"
    ? pitch
    : Math.max(21, Math.min(108, 21 + Math.round((pitch - 21) / 3) * 3));
}
async function sampleBytes(
  pitch: number,
  bank: PianoVoice,
  layer: number,
  priority = 0,
) {
  const key = `${bank}:${pitch}:${layer}`;
  const cached = encoded.get(key);
  if (cached) {
    encoded.delete(key);
    encoded.set(key, cached);
    return cached;
  }
  const existing = fetching.get(key);
  if (existing) return existing;
  const request = (async () => {
    const manifest = await getManifest(bank);
    let data: ArrayBuffer;
    if (bank === "fluid" && !manifest[pitch]) {
      sampleData ??= fetch(appAsset("/audio/piano.json"))
        .then((response) => {
          if (!response.ok) throw new Error("Practice piano samples could not load. Please try again.");
          return response.json();
        })
        .catch((error) => {
          sampleData = undefined;
          throw error;
        });
      const samples = await sampleData;
      const name = `${SAMPLE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
      const sample = samples[name];
      if (!sample) throw new Error(`Missing piano sample for ${name}.`);
      data = Uint8Array.from(atob(sample.split(",")[1]), (char) =>
        char.charCodeAt(0),
      ).buffer;
    } else {
      const resource = manifest[pitch]?.[layer];
      if (!resource) throw new Error("Grand piano samples could not be read. Please try again.");
      data = await downloads.run(async () => {
        const response = await fetch(appAsset(resource));
        if (!response.ok) throw new Error("Grand piano samples could not be read. Please try again.");
        return response.arrayBuffer();
      }, priority);
    }
    encoded.set(key, data);
    encodedBytes += data.byteLength;
    for (const [oldest, bytes] of encoded) {
      if (encodedBytes <= 8 * 1024 * 1024) break;
      encoded.delete(oldest);
      encodedBytes -= bytes.byteLength;
    }
    return data;
  })();
  fetching.set(key, request);
  try {
    return await request;
  } finally {
    fetching.delete(key);
  }
}
/** Warm a small keyboard phrase without asking for audio permission. */
export async function prefetchPianoKeys(pitches: number[]) {
  await prefetchPianoNotes(
    pitches.slice(0, 12).map((pitch) => ({
      pitch,
      velocity: 0.7,
      time: 0,
      duration: 1,
    })),
  );
}
/** Warm the actual opening's velocity layers without resuming audio outside a gesture. */
export async function prefetchPianoNotes(
  notes: PerformedNote[],
  options: { signal?: AbortSignal; decode?: boolean } = {},
) {
  const { signal } = options;
  const bank = voice;
  const tasks = sampleTasks(notes, bank).slice(0, 24);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, tasks.length) }, async () => {
      while (next < tasks.length && bank === voice && !signal?.aborted) {
        const { pitch, layer } = tasks[next++];
        if (buffers.has(`${bank}:${pitch}:${layer}`)) continue;
        if (playbackContext && options.decode !== false)
          await loadSample(pitch, playbackContext, bank, layer, -1);
        else await sampleBytes(pitch, bank, layer, -1);
      }
    }),
  );
}
async function loadSample(
  pitch: number,
  context: AudioContext,
  bank: PianoVoice,
  layer: number,
  priority = 0,
) {
  if (bank !== voice) return;
  const key = `${bank}:${pitch}:${layer}`;
  if (buffers.has(key)) return;
  const existing = loading.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const data = await sampleBytes(pitch, bank, layer, priority);
    if (bank !== voice) return;
    await decoder.run(async () => {
      if (bank !== voice) return;
      const endDecode = timeWork("sampleDecode");
      // Decode at the playback context's rate; never lower the sample rate to save memory.
      const buffer = await context.decodeAudioData(data.slice(0));
      if (bank === "fluid") normalizePianoSample(buffer);
      endDecode();
      countWork("sampleDecodes");
      if (bank === voice) rememberBuffer(key, buffer);
    }, priority);
  })();
  loading.set(key, promise);
  try {
    await promise;
  } finally {
    loading.delete(key);
  }
}
export function getPianoVoice() {
  return voice;
}
export function setPianoVoice(value: PianoVoice) {
  voice = value;
  pinned.clear();
  try {
    localStorage.setItem("qinban-piano-voice", value);
  } catch {
    /* Optional preference. */
  }
  // Bound decoded banks to the chosen voice, preventing tablet memory growth.
  buffers.forEach((buffer, key) => {
    if (!key.startsWith(value + ":")) {
      decodedBytes -= buffer.length * buffer.numberOfChannels * 4;
      buffers.delete(key);
    }
  });
}
function velocityLayers(velocity: number, bank = voice) {
  if (bank === "fluid") return [0];
  const position = Math.max(0, Math.min(2, ((velocity - 0.3) / 0.6) * 2));
  return [...new Set([Math.floor(position), Math.ceil(position)])];
}
export async function preparePianoNotes(notes: PerformedNote[]) {
  const context = await readyAudio();
  const bank = voice;
  const list = sampleTasks(notes, bank);
  pinned = new Set(list.map(({ pitch, layer }) => `${bank}:${pitch}:${layer}`));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, list.length) }, async () => {
      while (next < list.length && bank === voice) {
        const task = list[next++];
        await loadSample(task.pitch, context, bank, task.layer);
      }
    }),
  );
}
function sampleTasks(notes: PerformedNote[], bank: PianoVoice) {
  const tasks = new Map<string, { pitch: number; layer: number }>();
  for (const note of notes)
    for (const layer of velocityLayers(note.velocity, bank)) {
      const pitch = anchor(note.pitch, bank),
        key = `${bank}:${pitch}:${layer}`;
      const cached = buffers.get(key);
      if (cached) {
        buffers.delete(key);
        buffers.set(key, cached);
      }
      tasks.set(key, { pitch, layer });
    }
  return [...tasks.values()];
}
export function pianoNotesReady(notes: PerformedNote[]) {
  countWork("audioReadinessNotes", notes.length);
  return notes.every((n) =>
    velocityLayers(n.velocity).every((layer) =>
      buffers.has(`${voice}:${anchor(n.pitch, voice)}:${layer}`),
    ),
  );
}
/** Match sample peaks while retaining each piano note's natural decay. */
export function normalizePianoSample(buffer: AudioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const value of buffer.getChannelData(channel))
      peak = Math.max(peak, Math.abs(value));
  }
  if (peak < 0.00001) return;
  const gain = Math.min(8, 0.85 / peak);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}
/** Limit dense chords before applying the user's final volume setting. */
export function createPianoOutput(context: BaseAudioContext, volume: number) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 3;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  const limiter = context.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    const magnitude = Math.abs(x);
    curve[i] =
      Math.sign(x) *
      (magnitude <= 0.85
        ? magnitude
        : 0.85 + 0.13 * Math.tanh((magnitude - 0.85) / 0.13));
  }
  limiter.curve = curve;
  limiter.oversample = "4x";
  const volumeGain = context.createGain();
  volumeGain.gain.value = volume;
  compressor.connect(limiter);
  limiter.connect(volumeGain);
  volumeGain.connect(context.destination);
  return { input: compressor, volumeGain };
}
export async function readyAudio(pitches: number[] = [], velocity = 0.7) {
  const session = preparePlaybackSession();
  playbackContext ??= new AudioContext({ latencyHint: "interactive" });
  if (!masterGain) {
    const output = createPianoOutput(playbackContext, masterVolume);
    pianoInput = output.input;
    masterGain = output.volumeGain;
  }
  if (playbackContext.state !== "running") await playbackContext.resume();
  await session;
  const bank = voice;
  const tasks = [...new Set(pitches.map((p) => anchor(p, bank)))].flatMap(
    (pitch) =>
      velocityLayers(velocity, bank).map((layer) => ({ pitch, layer })),
  );
  // Limit parallel decoding; 88 simultaneous decoders previously froze the UI.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (next < tasks.length && bank === voice) {
        const task = tasks[next++];
        await loadSample(task.pitch, playbackContext!, bank, task.layer);
      }
    }),
  );
  // Load only the exact velocity layers that will sound, retaining their original blend.
  return playbackContext;
}
export function setPlaybackVolume(value: number) {
  masterVolume = Math.max(0, Math.min(1, value));
  try {
    localStorage.setItem("qinban-playback-volume", String(masterVolume));
  } catch {
    /* Optional preference. */
  }
  if (masterGain && playbackContext)
    masterGain.gain.setTargetAtTime(
      masterVolume,
      playbackContext.currentTime,
      0.02,
    );
}
export function getPlaybackVolume() {
  return masterVolume;
}
export function playPiano(
  pitch: number,
  seconds = 0.7,
  volume = 0.2,
  delaySeconds = 0,
  velocity = 0.7,
) {
  if (!playbackContext || playbackContext.state !== "running") return;
  playPianoAt(
    pitch,
    seconds,
    volume,
    playbackContext.currentTime + Math.max(0, delaySeconds),
    velocity,
  );
}
export function playPianoAt(
  pitch: number,
  seconds: number,
  volume: number,
  audioTime: number,
  velocity = 0.7,
) {
  startPiano(pitch, seconds, volume, audioTime, velocity);
}
/** Live keys keep the sample's natural tail until key-up or pedal-up. */
export function playPianoKey(pitch: number, volume = 0.2, velocity = 0.7) {
  if (!playbackContext) return;
  startPiano(pitch, null, volume, playbackContext.currentTime, velocity);
}
function dampPianoSound(sound: PianoSound, time: number) {
  sound.gain.gain.cancelScheduledValues(time);
  sound.gain.gain.setTargetAtTime(0.0001, time, 0.06);
  try {
    sound.node.stop(time + 0.3);
  } catch {
    /* Already ended. */
  }
}
export function setPianoSustain(enabled: boolean) {
  pianoSustain = enabled;
  if (!enabled && playbackContext)
    for (const sound of liveSounds)
      if (sound.released) dampPianoSound(sound, playbackContext.currentTime);
}
function startPiano(
  pitch: number,
  seconds: number | null,
  volume: number,
  audioTime: number,
  velocity: number,
) {
  if (!playbackContext || playbackContext.state !== "running") return;
  const ctx = playbackContext,
    bank = voice,
    samplePitch = anchor(pitch, bank);
  const position = Math.max(0, Math.min(2, ((velocity - 0.3) / 0.6) * 2));
  const low = Math.floor(position),
    high = Math.ceil(position);
  let layers =
    bank === "fluid"
      ? [{ layer: 0, mix: 1 }]
      : low === high
        ? [{ layer: low, mix: 1 }]
        : [
            { layer: low, mix: 1 - (position - low) },
            { layer: high, mix: position - low },
          ];
  if (
    layers.some(({ layer }) => !buffers.has(`${bank}:${samplePitch}:${layer}`))
  ) {
    const available = layers.filter(({ layer }) =>
      buffers.has(`${bank}:${samplePitch}:${layer}`),
    );
    if (available.length) {
      const total = available.reduce((sum, item) => sum + item.mix, 0);
      layers = available.map((item) => ({ ...item, mix: item.mix / total }));
    } else {
      const fallback = [1, 0, 2].find((layer) =>
        buffers.has(`${bank}:${samplePitch}:${layer}`),
      );
      layers = fallback === undefined ? [] : [{ layer: fallback, mix: 1 }];
    }
  }
  const t = Math.max(ctx.currentTime, audioTime);
  for (const { layer, mix } of layers) {
    const sampleKey = `${bank}:${samplePitch}:${layer}`,
      buffer = buffers.get(sampleKey);
    if (!buffer || mix < 0.005) continue;
    buffers.delete(sampleKey);
    buffers.set(sampleKey, buffer);
    const node = ctx.createBufferSource(),
      gain = ctx.createGain();
    node.buffer = buffer;
    node.playbackRate.value = 2 ** ((pitch - samplePitch) / 12);
    const level = volume * 4.5 * mix * (velocity / 0.7) ** 1.4;
    const heldKey = `${bank}:${pitch}:${layer}`,
      previous = heldKeys.get(heldKey);
    // A lifted damper keeps earlier hammer strikes ringing under the pedal.
    if (
      previous &&
      previous.end > t &&
      !(pianoSustain && previous.live && previous.released && seconds === null)
    )
      dampPianoSound(previous, t);
    gain.gain.setValueAtTime(level, t);
    if (seconds !== null) {
      gain.gain.setValueAtTime(level, t + Math.max(0.05, seconds));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.25);
    }
    node.connect(gain);
    gain.connect(pianoInput!);
    countWork("audioSources");
    if (t < ctx.currentTime + 0.003) countWork("audioLateStarts");
    node.start(t);
    if (seconds !== null) node.stop(t + seconds + 0.27);
    const sound: PianoSound = {
      node,
      gain,
      end:
        t +
        (seconds === null
          ? buffer.duration / node.playbackRate.value
          : seconds + 0.27),
      live: seconds === null,
      released: false,
    };
    heldKeys.set(heldKey, sound);
    if (sound.live) {
      liveSounds.add(sound);
      if (liveSounds.size > MAX_LIVE_SOURCES) {
        const oldestTail = [...liveSounds].find(
          (candidate) => candidate.released,
        );
        if (oldestTail) {
          dampPianoSound(oldestTail, t);
          liveSounds.delete(oldestTail);
          for (const [key, candidate] of heldKeys)
            if (candidate === oldestTail) heldKeys.delete(key);
        }
      }
    }
    sounding.add(node);
    node.onended = () => {
      sounding.delete(node);
      liveSounds.delete(sound);
      if (heldKeys.get(heldKey)?.node === node) heldKeys.delete(heldKey);
      node.disconnect();
      gain.disconnect();
    };
  }
}
export function playClick(strong: boolean) {
  if (!playbackContext || playbackContext.state !== "running") return;
  const ctx = playbackContext,
    t = ctx.currentTime;
  const oscillator = ctx.createOscillator(),
    gain = ctx.createGain();
  oscillator.frequency.value = strong ? 1200 : 800;
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
  oscillator.connect(gain);
  gain.connect(masterGain!);
  oscillator.start();
  oscillator.stop(t + 0.06);
  sounding.add(oscillator);
  oscillator.onended = () => {
    sounding.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
}
export function releasePianoKey(pitch: number) {
  if (!playbackContext) return;
  const now = playbackContext.currentTime;
  for (const [key, active] of heldKeys) {
    if (!key.startsWith(`${voice}:${pitch}:`) || !active.live) continue;
    active.released = true;
    if (!pianoSustain) {
      dampPianoSound(active, now);
      heldKeys.delete(key);
    }
  }
}
export function stopPlayback() {
  stopPlaybackSession();
  pinned.clear();
  heldKeys.clear();
  liveSounds.clear();
  sounding.forEach((node) => {
    try {
      node.stop();
    } catch {
      /* Already stopped. */
    }
  });
  sounding.clear();
}
export interface MicReading {
  midi: number | null;
  confidence: number;
  rms: number;
}
export async function listenMicrophone(
  onReading: (reading: MicReading) => void,
  onNote: (midi: number) => void,
  onEnded: () => void,
) {
  await prepareMicrophone();
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Microphone access is unavailable here. Use the Android app, localhost, or an HTTPS page.",
    );
  const releaseSession = beginMicrophoneSession();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (error) {
    releaseSession();
    throw error;
  }
  const context = new AudioContext();
  try {
    await context.resume();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    releaseSession();
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const analyzer = context.createAnalyser();
  analyzer.fftSize = 4096;
  source.connect(analyzer);
  const samples = new Float32Array(analyzer.fftSize);
  let previous: number | null = null,
    stable = 0,
    lastEmitted: number | null = null;
  let lastTime = 0,
    previousEnergy = 0,
    silentFrames = 0;
  let released = true,
    cancelled = false;
  const interval = window.setInterval(() => {
    analyzer.getFloatTimeDomainData(samples);
    const estimate = estimatePitch(samples, context.sampleRate);
    if (!estimate) {
      onReading({ midi: null, confidence: 0, rms: 0 });
      silentFrames++;
      if (silentFrames >= 2) {
        released = true;
        previous = null;
        stable = 0;
        previousEnergy = 0;
      }
      return;
    }
    silentFrames = 0;
    const precise = 69 + 12 * Math.log2(estimate.frequency / 440);
    const midi = frequencyToMidi(estimate.frequency);
    const inTune = Math.abs(precise - midi) <= 0.38;
    onReading({
      midi: inTune ? midi : null,
      confidence: inTune ? estimate.confidence : 0,
      rms: estimate.rms,
    });
    const attack = estimate.rms > Math.max(0.014, previousEnergy * 1.6);
    if (attack && performance.now() - lastTime > 180) released = true;
    previousEnergy = previousEnergy
      ? previousEnergy * 0.7 + estimate.rms * 0.3
      : estimate.rms;
    stable = previous === midi ? stable + 1 : 1;
    previous = midi;
    if (
      inTune &&
      stable >= 2 &&
      (released || midi !== lastEmitted) &&
      performance.now() - lastTime > 130
    ) {
      onNote(midi);
      lastEmitted = midi;
      lastTime = performance.now();
      released = false;
    }
  }, 60);
  stream.getAudioTracks().forEach((track) => {
    track.onended = () => {
      if (!cancelled) {
        releaseSession();
        onEnded();
      }
    };
  });
  return () => {
    cancelled = true;
    clearInterval(interval);
    source.disconnect();
    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    void context.close();
    releaseSession();
  };
}
