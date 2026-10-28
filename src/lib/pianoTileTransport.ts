import type { GameNote } from "./pianoGame";
import { PianoTileEngine } from "./pianoTiles";

export interface TileAttack {
  note: GameNote;
  at: number;
  duration: number;
  lane: number;
}
export interface TileTransportOptions {
  acceleration?: boolean;
  autoMiss?: boolean;
}
const LOOKAHEAD = 0.04;
const EPSILON = 1e-7;

/** Pointer attacks are immediate; written subdivisions use the audio clock. */
export class PianoTileTransport {
  position: number;
  activeSeconds = 0;
  private running = false;
  private begun = false;
  private lastNow = 0;
  private pauseAt: number | undefined;
  private noteCursor = 0;
  private tailUntil = 0;
  private rates = new Map<number, number>();
  private anchors = new Map<number, { at: number; rate: number }>();
  private played = new Set<GameNote>();
  private scheduled: { note: GameNote; at: number }[] = [];
  constructor(
    readonly engine: PianoTileEngine,
    readonly options: TileTransportOptions = {},
  ) {
    this.position = engine.tiles[0]?.time ?? 0;
  }
  /** Continuous exponential ramp: no tiers, jumps or changes to sample pitch. */
  get acceleration() {
    if (this.options.acceleration === false) return 1;
    const ceiling = 0.25 + (this.engine.intensity / 100) * 0.85;
    return 1 + ceiling * (1 - Math.exp(-this.activeSeconds / 100));
  }
  get rate() {
    return this.rateAt(this.position);
  }
  get waiting() {
    return !this.begun;
  }
  start(now: number) {
    if (this.pauseAt !== undefined) {
      const gap = Math.max(0, now - this.pauseAt);
      for (const anchor of this.anchors.values()) anchor.at += gap;
    }
    this.pauseAt = undefined;
    this.running = true;
    this.lastNow = now;
    this.rateAt(this.position);
  }
  pause(now: number) {
    this.running = false;
    this.pauseAt = now;
    for (const event of this.scheduled)
      if (event.at > now + EPSILON) {
        this.played.delete(event.note);
        this.noteCursor = Math.min(
          this.noteCursor,
          this.engine.source.notes.indexOf(event.note),
        );
      }
    this.scheduled = [];
    this.tailUntil = now;
  }
  finished(now: number) {
    return (
      this.engine.completed &&
      this.noteCursor === this.engine.source.notes.length &&
      this.position >= this.engine.end - EPSILON &&
      now >= this.tailUntil
    );
  }
  private subdivisionAt(time: number) {
    return Math.floor(this.engine.timeline.beatAt(time) * 4 + EPSILON);
  }
  private rateAt(time: number) {
    const subdivision = this.subdivisionAt(time);
    if (!this.rates.has(subdivision))
      this.rates.set(subdivision, this.acceleration);
    return this.rates.get(subdivision)!;
  }
  private boundary(time: number) {
    return this.engine.timeline.secondsAt((this.subdivisionAt(time) + 1) / 4);
  }
  private attack(note: GameNote, at: number, rate: number) {
    this.played.add(note);
    this.scheduled.push({ note, at });
    const duration = Math.max(0.025, note.duration / rate);
    this.tailUntil = Math.max(this.tailUntil, at + duration + 0.27);
    return { note, at, duration, lane: this.engine.tiles[note.group].lane };
  }
  press(lane: number, tileId: number | undefined, now: number) {
    const attacks = this.advance(now);
    const tile = this.engine.press(lane, this.position, tileId);
    if (!tile) return { tile, attacks };
    this.begun = true;
    // Sound is anchored to the press. Early input must not seek the chart clock
    // and teleport every remaining tile. Demo and challenge share the same rate.
    const rate = this.rateAt(this.position);
    this.anchors.set(tile.id, { at: now, rate });
    // Never swallow a valid press into a queue. Strike the actual chord now.
    for (const note of tile.notes)
      if (Math.abs(note.time - tile.time) < EPSILON && !this.played.has(note))
        attacks.push(this.attack(note, now, rate));
    attacks.push(...this.advance(now));
    return { tile, attacks };
  }
  private secondsBetween(from: number, to: number) {
    let time = from,
      seconds = 0;
    while (time < to - EPSILON) {
      const end = Math.min(to, this.boundary(time));
      seconds +=
        (end - time) /
        (this.rates.get(this.subdivisionAt(time)) ?? this.acceleration);
      time = end;
    }
    return seconds;
  }
  advance(now: number, demo = false): TileAttack[] {
    if (!this.running) return [];
    const wallElapsed = Math.max(0, now - this.lastNow);
    // A blocked UI must not punish the player with a burst of unreachable misses.
    const elapsed =
      wallElapsed > 0.25 && this.options.autoMiss !== false && !demo
        ? 0.05
        : wallElapsed;
    this.lastNow = now;
    if (demo || this.engine.correct > 0) this.begun = true;
    if (!this.begun) return [];
    if (elapsed < wallElapsed)
      for (const anchor of this.anchors.values())
        anchor.at += wallElapsed - elapsed;
    this.activeSeconds += elapsed;
    this.scheduled = this.scheduled.filter((event) => event.at > now);
    let remaining = elapsed;
    const limit =
      this.options.autoMiss === false && !demo
        ? (this.engine.next?.time ?? this.engine.end)
        : this.engine.end;
    while (remaining > EPSILON && this.position < limit - EPSILON) {
      const rate = this.rateAt(this.position);
      const end = Math.min(limit, this.boundary(this.position));
      const duration = (end - this.position) / rate;
      if (remaining < duration) {
        this.position += remaining * rate;
        break;
      }
      this.position = end;
      remaining -= duration;
    }
    if (demo) {
      while (
        this.engine.next &&
        this.secondsBetween(
          this.position,
          Math.max(this.position, this.engine.next.time),
        ) <= LOOKAHEAD
      )
        this.engine.press(this.engine.next.lane, this.engine.next.time);
    } else if (this.options.autoMiss !== false) {
      const grace = 0.22 - this.engine.intensity / 1000;
      while (
        this.engine.next &&
        this.position - this.engine.next.time > grace * this.rate + EPSILON
      )
        this.engine.miss();
    }
    const notes = this.engine.source.notes;
    const attacks: TileAttack[] = [];
    while (this.noteCursor < notes.length) {
      const note = notes[this.noteCursor];
      if (this.played.has(note) || note.state === "missed") {
        this.noteCursor++;
        continue;
      }
      if (note.state !== "hit") break;
      const anchor = this.anchors.get(note.group);
      const delay = anchor
        ? anchor.at +
          (note.time - this.engine.tiles[note.group].time) / anchor.rate -
          now
        : this.secondsBetween(
            this.position,
            Math.max(this.position, note.time),
          );
      if (delay > LOOKAHEAD + EPSILON) break;
      // Preserve a delayed frame's remaining phrase instead of a burst of overdue notes.
      if (!anchor && note.time < this.position - 0.04)
        this.position = note.time;
      attacks.push(
        this.attack(
          note,
          now + Math.max(0, delay),
          // Looking ahead for demo audio must not lock a future scroll rate
          // earlier than the challenge clock reaches that subdivision.
          anchor?.rate ??
            this.rates.get(this.subdivisionAt(note.time)) ??
            this.acceleration,
        ),
      );
      this.noteCursor++;
    }
    return attacks;
  }
}
