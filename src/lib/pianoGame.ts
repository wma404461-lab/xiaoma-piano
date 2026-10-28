import type { Hands, Song } from "../types";
import { getEvents } from "./music";
import { rangeTempoMap, TempoTimeline } from "./tempo";
import { waterfallNotes, type WaterfallNote } from "./waterfall";
import { WaterfallNoteIndex } from "./waterfallIndex";
import { awardHit, emptyGameScore } from "./gameScore";

export type GameNoteState =
  "pending" | "holding" | "suspended" | "hit" | "missed";
export interface GameNote extends WaterfallNote {
  group: number;
  state: GameNoteState;
  hold: boolean;
}
interface GameGroup {
  time: number;
  notes: GameNote[];
  settled: boolean;
  distance: number;
}
export const GAME_HIT_WINDOW = 0.4;
export const GAME_PREVIEW_SECONDS = 3.2;

/** A score-derived game: every target is an actual piano key, never a lane number. */
export class PianoGameEngine {
  readonly notes: GameNote[];
  readonly index: WaterfallNoteIndex;
  private readonly groups: GameGroup[];
  private readonly byPitch = new Map<
    number,
    { notes: GameNote[]; cursor: number }
  >();
  private readonly held = new Map<number, GameNote>();
  private readonly active = new Set<number>();
  private expiryCursor = 0;
  private previewCursor = 0;
  private settled = 0;
  score = emptyGameScore();
  correct = 0;
  wrong = 0;
  missed = 0;
  feedback = "Play the piano keys as the notes reach the line";

  constructor(song: Song, hands: Hands, tempo: number) {
    const events = getEvents(song, hands);
    const clock = new TempoTimeline(
      rangeTempoMap(song, 0, song.measures.length - 1, tempo),
      tempo,
    );
    const originalTimes = events.map((event) => clock.secondsAt(event.beat));
    const groupByTime = new Map(originalTimes.map((time, i) => [time, i]));
    this.groups = events.map((event, i) => ({
      time: originalTimes[i],
      notes: [],
      settled: false,
      distance: 0,
    }));
    this.notes = waterfallNotes(song, events, undefined, clock).map((note) => {
      const duration = Math.max(
        0.08,
        Math.min(note.duration, (note.nextAttack ?? Infinity) - note.time),
      );
      return {
        ...note,
        duration,
        group: groupByTime.get(note.time)!,
        state: "pending",
        hold: duration >= 0.7,
      };
    });
    for (const note of this.notes) {
      this.groups[note.group].notes.push(note);
      let pitches = this.byPitch.get(note.pitch);
      if (!pitches) {
        pitches = { notes: [], cursor: 0 };
        this.byPitch.set(note.pitch, pitches);
      }
      pitches.notes.push(note);
    }
    this.index = new WaterfallNoteIndex(this.notes);
  }
  get total() {
    return this.groups.length;
  }
  get hitWindow() {
    return GAME_HIT_WINDOW;
  }
  get progress() {
    return this.total ? this.settled / this.total : 0;
  }
  get done() {
    return this.settled >= this.total;
  }
  get completed() {
    return this.total > 0 && this.settled >= this.total;
  }
  get holdingPitches() {
    return [...this.held.keys()];
  }

  private complete(group: GameGroup) {
    if (group.settled || !group.notes.every((note) => note.state === "hit"))
      return;
    group.settled = true;
    this.settled++;
    this.correct++;
    const hit = awardHit(this.score, group.distance * 2);
    this.score = hit.score;
    this.feedback = hit.judgement;
    this.active.delete(group.notes[0]?.group);
  }
  private miss(group: GameGroup, early = false) {
    if (group.settled) return;
    group.settled = true;
    this.settled++;
    this.missed++;
    this.score = { ...this.score, combo: 0 };
    this.feedback = early ? "Hold the key until the light trail ends" : "Missed this note group";
    for (const note of group.notes) {
      note.state = "missed";
      if (this.held.get(note.pitch) === note) this.held.delete(note.pitch);
    }
    this.active.delete(group.notes[0]?.group);
  }
  tick(seconds: number) {
    if (this.done) return;
    while (
      this.expiryCursor < this.groups.length &&
      this.groups[this.expiryCursor].time < seconds - this.hitWindow
    ) {
      const group = this.groups[this.expiryCursor++];
      if (
        !group.settled &&
        group.notes.some((note) => note.state === "pending")
      )
        this.miss(group);
      if (this.done) return;
    }
    for (const id of this.active) {
      const group = this.groups[id];
      for (const note of group.notes) {
        if (note.state === "holding" && seconds >= note.time + note.duration) {
          note.state = "hit";
          if (this.held.get(note.pitch) === note) this.held.delete(note.pitch);
        } else if (
          note.state === "suspended" &&
          seconds > note.time + note.duration + this.hitWindow
        ) {
          this.miss(group, true);
          break;
        }
      }
      this.complete(group);
    }
  }
  press(pitch: number, seconds: number): GameNote | undefined {
    if (this.done || seconds < -this.hitWindow) return;
    this.tick(seconds);
    if (this.done || this.held.has(pitch)) return;
    const list = this.byPitch.get(pitch);
    while (
      list &&
      list.cursor < list.notes.length &&
      ["hit", "missed"].includes(list.notes[list.cursor].state)
    )
      list.cursor++;
    const note = list?.notes[list.cursor];
    if (
      !note ||
      (note.state !== "suspended" &&
        Math.abs(note.time - seconds) > this.hitWindow)
    ) {
      this.wrong++;
      this.score = { ...this.score, combo: 0 };
      this.feedback = "Follow the falling notes and play the matching piano keys";
      return;
    }
    const group = this.groups[note.group];
    if (note.state !== "suspended")
      group.distance = Math.max(group.distance, Math.abs(note.time - seconds));
    note.state = note.hold ? "holding" : "hit";
    this.active.add(note.group);
    if (note.hold) this.held.set(pitch, note);
    this.complete(group);
    return note;
  }
  release(pitch: number, seconds: number) {
    const note = this.held.get(pitch);
    if (!note || this.done) return;
    this.held.delete(pitch);
    if (seconds < note.time + note.duration - 0.08)
      this.miss(this.groups[note.group], true);
    else {
      note.state = "hit";
      this.complete(this.groups[note.group]);
    }
  }
  suspendHolds() {
    for (const note of this.held.values()) note.state = "suspended";
    this.held.clear();
  }
  upcoming(seconds: number) {
    this.advancePreview();
    const next = this.groups
      .slice(this.previewCursor, this.previewCursor + 2)
      .find(
        (group) => !group.settled && group.time >= seconds - this.hitWindow,
      );
    return (
      next?.notes
        .filter((note) => note.state === "pending")
        .map((note) => note.pitch) ?? []
    );
  }
  targetPitches() {
    this.advancePreview();
    const targets = this.groups
      .slice(this.previewCursor, this.previewCursor + 2)
      .filter((group) => !group.settled)
      .flatMap((group) => group.notes.map((note) => note.pitch));
    for (const id of this.active)
      targets.push(
        ...this.groups[id].notes
          .filter(
            (note) => note.state === "holding" || note.state === "suspended",
          )
          .map((note) => note.pitch),
      );
    return [...new Set(targets)];
  }
  visiblePitches(seconds: number) {
    const targets = this.index
      .visible(seconds, GAME_PREVIEW_SECONDS, this.hitWindow)
      .filter((raw) => {
        const note = raw as GameNote;
        return (
          note.state === "pending" ||
          note.state === "holding" ||
          note.state === "suspended"
        );
      })
      .map((note) => note.pitch);
    targets.push(...this.holdingPitches);
    return [...new Set(targets)];
  }
  private advancePreview() {
    while (
      this.previewCursor < this.groups.length &&
      !this.groups[this.previewCursor].notes.some(
        (note) => note.state === "pending",
      )
    )
      this.previewCursor++;
  }
}

export interface GameKeyRange {
  low: number;
  high: number;
}
/** Reserve enough cells for the whole piece so new octaves never change key geometry. */
export function gameKeyCapacity(notes: readonly WaterfallNote[]) {
  const boundaries = notes
    .flatMap((note) => [
      {
        time: note.time - GAME_PREVIEW_SECONDS,
        octave: Math.floor(note.pitch / 12),
        delta: 1,
      },
      {
        time:
          note.time +
          Math.max(note.duration, GAME_HIT_WINDOW) +
          GAME_HIT_WINDOW,
        octave: Math.floor(note.pitch / 12),
        delta: -1,
      },
    ])
    .sort((a, b) => a.time - b.time || b.delta - a.delta);
  const counts = new Map<number, number>();
  let capacity = 1;
  for (const boundary of boundaries) {
    const count = (counts.get(boundary.octave) ?? 0) + boundary.delta;
    if (count) counts.set(boundary.octave, count);
    else counts.delete(boundary.octave);
    capacity = Math.max(capacity, counts.size);
  }
  return capacity;
}
/** Recycle empty slots, never resize or move a range still needed on screen. */
export function gameKeySlots(
  pitches: readonly number[],
  previous: readonly (GameKeyRange | null)[] = [],
): (GameKeyRange | null)[] {
  const targets = [...new Set(pitches)];
  const slots = previous.map((range) =>
    range && targets.some((pitch) => pitch >= range.low && pitch <= range.high)
      ? range
      : null,
  );
  const missing = targets.filter(
    (pitch) =>
      !slots.some(
        (range) => range && pitch >= range.low && pitch <= range.high,
      ),
  );
  // Fixed octave bounds keep key widths constant and never duplicate a pitch
  // when new notes appear just beyond the edge of an existing range.
  const bands = [
    ...new Set(
      missing
        .filter((pitch) => pitch >= 21 && pitch <= 108)
        .map((pitch) => (pitch < 24 ? 21 : Math.floor(pitch / 12) * 12)),
    ),
  ].sort((a, b) => a - b);
  for (const low of bands) {
    const range = { low, high: Math.min(low === 21 ? 23 : low + 11, 108) };
    const free = slots.indexOf(null);
    if (free < 0) slots.push(range);
    else slots[free] = range;
  }
  while (slots.length && slots.at(-1) === null) slots.pop();
  return slots;
}
/** Add white-key context around targets. Never truncate a chord or transpose a key. */
export function gameKeyRanges(
  pitches: readonly number[],
  locked: readonly GameKeyRange[] = [],
): GameKeyRange[] {
  const ranges = [...locked];
  for (const pitch of [...new Set(pitches)].sort((a, b) => a - b)) {
    if (
      pitch < 21 ||
      pitch > 108 ||
      ranges.some((range) => pitch >= range.low && pitch <= range.high)
    )
      continue;
    let low = Math.max(21, pitch - 2),
      high = Math.min(108, pitch + 2);
    const white = (pitch: number) =>
      [0, 2, 4, 5, 7, 9, 11].includes(pitch % 12);
    while (low > 21 && !white(low)) low--;
    while (high < 108 && !white(high)) high++;
    const previous = ranges[ranges.length - 1];
    // Held keys keep both their range and screen slot. New ranges append below.
    if (
      !locked.length &&
      previous &&
      low <= previous.high + 3 &&
      high - previous.low <= 18
    )
      previous.high = Math.max(high, previous.high);
    else ranges.push({ low, high });
  }
  return ranges.length ? ranges : [{ low: 60, high: 72 }];
}
