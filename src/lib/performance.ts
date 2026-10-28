import type { ExpectedEvent, TempoPoint } from "../types";
import { timeWork } from "./diagnostics";
import { TempoTimeline } from "./tempo";

export type PlaybackStyle = "expressive" | "score";
export interface PerformedNote {
  pitch: number;
  time: number;
  duration: number;
  keyDuration?: number;
  velocity: number;
}
export interface PerformancePlan {
  clock?: TempoTimeline;
  events: {
    index: number;
    beat: number;
    time: number;
    notes: PerformedNote[];
  }[];
  duration: number;
}
const variation = (seed: number) =>
  (((Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1) + 1) % 1;
/** A repeatable automatic interpretation. Score mode retains exact metrical timing. */
export function makePerformance(
  events: ExpectedEvent[],
  beats: number,
  tempo: number,
  meter: number,
  style: PlaybackStyle,
  pedal = false,
  tempoMap: TempoPoint[] = [],
): PerformancePlan {
  const endWork = timeWork("performancePlan");
  const endBeat = Math.max(
    beats,
    ...events.map(
      (e) => e.beat + Math.max(...Object.values(e.durations), e.beats),
    ),
  );
  const clock = new TempoTimeline(tempoMap, tempo);
  const at = (beat: number) => clock.secondsAt(Math.max(0, beat));
  const barStarts = new Map<number, number>();
  events.forEach((event) => {
    if (!barStarts.has(event.measure))
      barStarts.set(
        event.measure,
        event.beat - (event.localBeat ?? event.beat % meter),
      );
  });
  const changes = new Set([...barStarts.values(), beats]);
  let harmony = "",
    lastChange = -1;
  events.forEach((event) => {
    const bass = event.pitches.filter((p) => p < 60);
    const chord = [...new Set(bass.map((p) => p % 12))]
      .sort((a, b) => a - b)
      .join("-");
    if (bass.length >= 2 && chord !== harmony && event.beat - lastChange >= 1) {
      changes.add(event.beat);
      lastChange = event.beat;
      harmony = chord;
    }
  });
  const pedalChanges = [...changes].sort((a, b) => a - b);
  const pedalEnd = (event: ExpectedEvent) => {
    let low = 0,
      high = pedalChanges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (pedalChanges[mid] <= event.beat + 0.001) low = mid + 1;
      else high = mid;
    }
    return Math.min(beats, pedalChanges[low] ?? beats, event.beat + meter);
  };
  let previous = -1;
  const performed = events.map((event, index) => {
    const expressive = style === "expressive";
    const time = Math.max(
      previous + 0.001,
      at(event.beat) +
        (expressive && index ? (variation(index + 1) - 0.5) * 0.012 : 0),
    );
    previous = time;
    const phase =
      ((event.measure % 8) + (event.localBeat ?? event.beat % meter) / meter) /
      8;
    const phrase = 0.62 + 0.15 * Math.sin(phase * Math.PI);
    const accent =
      Math.abs(event.localBeat ?? event.beat % meter) < 0.01 ? 0.06 : 0;
    const highest = Math.max(...event.pitches);
    return {
      index,
      beat: event.beat,
      time,
      notes: event.pitches.map((pitch, n) => ({
        pitch,
        time: time + (expressive ? variation(index * 131 + pitch) * 0.009 : 0),
        duration: Math.max(
          0.055,
          at(
            Math.max(
              event.beat + (event.durations[pitch] ?? event.beats),
              pedal ? pedalEnd(event) - 0.08 : 0,
            ),
          ) - at(event.beat),
        ),
        keyDuration: Math.max(
          0.055,
          at(event.beat + (event.durations[pitch] ?? event.beats)) -
            at(event.beat),
        ),
        velocity: expressive
          ? Math.max(
              0.3,
              Math.min(
                0.92,
                (phrase + accent + (variation(index * 17 + n) - 0.5) * 0.05) *
                  (pitch === highest ? 1.13 : pitch < 60 ? 0.82 : 0.9),
              ),
            )
          : 0.7,
      })),
    };
  });
  let duration = at(endBeat);
  for (const event of performed)
    for (const note of event.notes)
      duration = Math.max(duration, note.time + note.duration);
  endWork();
  return { events: performed, duration, clock };
}

/** Audio time drives scheduling and page position, independently of React renders. */
export class AudioTransport {
  private timer?: ReturnType<typeof setInterval>;
  private origin = 0;
  private offset = 0;
  private next = 0;
  private finished = false;
  private preparing = false;
  private active = false;
  private generation = 0;
  private nextPreparationCheck = -Infinity;
  private retryAt = -Infinity;
  private failedAttack = -1;
  private preparationFailures = 0;
  private waitingAt: number | null = null;
  private prefetching = false;
  private nextPrefetchCheck = -Infinity;
  private prefetchController?: AbortController;
  constructor(
    private context: AudioContext,
    readonly plan: PerformancePlan,
    private play: (
      note: PerformedNote,
      audioTime: number,
      chordSize: number,
    ) => void,
    private prepare: (notes: PerformedNote[]) => Promise<void>,
    private ready: (notes: PerformedNote[]) => boolean,
    private onError: (error: Error) => void,
    private prefetch?: (
      notes: PerformedNote[],
      signal: AbortSignal,
    ) => Promise<void>,
  ) {}
  start(offset = 0) {
    this.stop();
    this.offset = Math.max(0, offset);
    this.origin = this.context.currentTime + 0.12 - this.offset;
    this.finished = false;
    this.active = true;
    this.nextPreparationCheck = -Infinity;
    this.retryAt = -Infinity;
    this.failedAttack = -1;
    this.preparationFailures = 0;
    this.nextPrefetchCheck = -Infinity;
    this.prefetchController = new AbortController();
    this.next = this.plan.events.findIndex(
      (e) => e.time >= this.offset - 0.001,
    );
    if (this.next < 0) this.next = this.plan.events.length;
    this.pump();
    this.timer = setInterval(() => this.pump(), 40);
  }
  private resumeLoadedAttack() {
    // Once an unavailable attack is reached, both the score and audio clock
    // wait at its onset. Move the origin by the elapsed wait when it becomes
    // ready, so later attacks retain their spacing instead of catching up.
    if (
      this.waitingAt !== null &&
      (!this.plan.events[this.next] ||
        this.ready(this.plan.events[this.next].notes))
    ) {
      const delay = this.context.currentTime - this.origin - this.waitingAt;
      if (delay > 0) this.origin += delay;
      this.waitingAt = null;
    }
  }
  private pump() {
    if (!this.active) return;
    this.resumeLoadedAttack();
    const elapsed = this.seconds;
    if (
      !this.preparing &&
      elapsed >= this.nextPreparationCheck &&
      this.context.currentTime >= this.retryAt
    ) {
      this.nextPreparationCheck = elapsed + 0.2;
      const upcoming: PerformedNote[] = [];
      for (
        let i = this.next;
        i < this.plan.events.length && this.plan.events[i].time <= elapsed + 4;
        i++
      )
        upcoming.push(...this.plan.events[i].notes);
      if (upcoming.length && !this.ready(upcoming)) {
        const generation = this.generation;
        this.preparing = true;
        void this.prepare(upcoming)
          .then(() => {
            if (this.active && this.generation === generation) {
              this.preparationFailures = 0;
              this.retryAt = -Infinity;
              this.pump();
            }
          })
          .catch((error) => {
            if (!this.active || this.generation !== generation) return;
            // A failed lookahead sample must not pause notes that are already
            // playable. Retry even when the visual clock is frozen at an attack.
            const next = this.plan.events[this.next];
            if (next && !this.ready(next.notes)) {
              if (this.failedAttack !== this.next) {
                this.failedAttack = this.next;
                this.preparationFailures = 0;
              }
              this.preparationFailures++;
            } else this.preparationFailures = 0;
            this.retryAt =
              this.context.currentTime +
              Math.min(3, 0.5 * 2 ** this.preparationFailures);
            this.nextPreparationCheck = -Infinity;
            if (this.preparationFailures >= 4 && next && elapsed >= next.time) {
              this.onError(error);
            }
          })
          .finally(() => {
            if (this.generation === generation) this.preparing = false;
          });
      }
    }
    while (
      this.next < this.plan.events.length &&
      this.plan.events[this.next].time <= elapsed + 2
    ) {
      if (!this.ready(this.plan.events[this.next].notes)) {
        this.waitingAt = Math.max(
          this.offset,
          this.plan.events[this.next].time,
        );
        this.nextPreparationCheck = -Infinity;
        break;
      }
      // A preparation callback may make the attack ready synchronously during
      // this pump. Release its wait before advancing past the final event.
      this.resumeLoadedAttack();
      const event = this.plan.events[this.next++];
      event.notes.forEach((note) =>
        this.play(
          note,
          Math.max(this.context.currentTime + 0.002, this.origin + note.time),
          event.notes.length,
        ),
      );
    }
    // Download farther ahead without pinning twice as much decoded PCM in memory.
    if (
      this.prefetch &&
      !this.prefetching &&
      elapsed >= this.nextPrefetchCheck
    ) {
      this.nextPrefetchCheck = elapsed + 1;
      const upcoming: PerformedNote[] = [];
      for (
        let i = this.next;
        i < this.plan.events.length && this.plan.events[i].time <= elapsed + 8;
        i++
      )
        upcoming.push(...this.plan.events[i].notes);
      if (upcoming.length) {
        const generation = this.generation;
        this.prefetching = true;
        void this.prefetch(upcoming, this.prefetchController!.signal)
          .catch(() => {})
          .finally(() => {
            if (this.generation === generation) this.prefetching = false;
          });
      }
    }
    this.finished =
      elapsed >= this.plan.duration && this.next >= this.plan.events.length;
    if (this.finished) {
      this.offset = this.plan.duration;
      this.active = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }
  }
  get seconds() {
    if (!this.active) return this.offset;
    const next = this.plan.events[this.next];
    // A renderer may read the clock between scheduler ticks, including after
    // a long main-thread stall. It must never pass an unavailable attack.
    if (
      this.waitingAt === null &&
      next &&
      (!this.ready(next.notes) ||
        this.context.currentTime - this.origin > next.time + 0.12)
    )
      this.waitingAt = Math.max(this.offset, next.time);
    return Math.min(
      this.waitingAt ?? Infinity,
      Math.max(this.offset, this.context.currentTime - this.origin),
    );
  }
  get done() {
    return this.finished;
  }
  get beat() {
    if (this.plan.clock) return this.plan.clock.beatAt(this.seconds);
    const i = this.index,
      a = this.plan.events[i],
      b = this.plan.events[i + 1];
    if (!a) return 0;
    if (!b)
      return (
        a.beat +
        Math.max(0, this.seconds - a.time) *
          ((a.notes[0]?.duration ?? 1) > 0 ? 1 : 0)
      );
    return (
      a.beat +
      (b.beat - a.beat) *
        Math.max(0, Math.min(1, (this.seconds - a.time) / (b.time - a.time)))
    );
  }
  get index() {
    let low = 0,
      high = this.plan.events.length - 1;
    const seconds = this.seconds;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.plan.events[mid].time <= seconds) low = mid;
      else high = mid - 1;
    }
    return low;
  }
  stop() {
    this.offset = this.seconds;
    this.active = false;
    this.waitingAt = null;
    this.generation++;
    this.preparing = false;
    this.prefetchController?.abort();
    this.prefetching = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    return this.seconds;
  }
}
