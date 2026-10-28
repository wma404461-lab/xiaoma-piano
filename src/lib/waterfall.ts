import type { ExpectedEvent, Song } from "../types";
import type { PerformancePlan } from "./performance";
import { rangeTempoMap, TempoTimeline } from "./tempo";

export interface WaterfallNote {
  pitch: number;
  time: number;
  duration: number;
  nextAttack?: number;
  hand: "right" | "left" | "both";
  measure: number;
  beat: number;
}

/** One bar per hammer strike. Pedal resonance is separate from holding a key. */
export function waterfallNotes(
  song: Song,
  events: ExpectedEvent[],
  plan?: PerformancePlan,
  clock = new TempoTimeline(rangeTempoMap(song, events[0]?.measure ?? 0), song.tempo),
): WaterfallNote[] {
  const notes = events
    .flatMap((event, index) => {
      const measure = song.measures[event.measure];
      const pitches = (hand: "right" | "left") =>
        new Set(
          measure?.[hand]
            .filter((note) => event.noteIds.includes(note.id))
            .flatMap((note) => note.attackPitches ?? note.pitches),
        );
      const right = pitches("right"),
        left = pitches("left");
      return event.pitches.map((pitch) => {
        const performed = plan?.events[index]?.notes.find(
          (note) => note.pitch === pitch,
        );
        return {
          pitch,
          time: performed?.time ?? clock.secondsAt(event.beat),
          duration:
            performed?.keyDuration ??
            clock.secondsAt(event.beat + (event.durations[pitch] ?? event.beats)) - clock.secondsAt(event.beat),
          hand:
            right.has(pitch) && left.has(pitch)
              ? "both"
              : left.has(pitch)
                ? "left"
                : "right",
          measure: event.measure,
          beat: event.localBeat ?? 0,
        } satisfies WaterfallNote;
      });
    })
    .sort((a, b) => a.time - b.time) as WaterfallNote[];
  const next = new Map<number, number>();
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    note.nextAttack = next.get(note.pitch);
    if (note.nextAttack !== undefined)
      note.duration = Math.min(
        note.duration,
        Math.max(0, note.nextAttack - note.time),
      );
    next.set(note.pitch, note.time);
  }
  return notes;
}

/** Preserve a visible gap even when rapid repeats are smaller than the minimum bar height. */
export function waterfallLength(
  note: WaterfallNote,
  pixelsPerSecond: number,
): number {
  const length = Math.max(6, note.duration * pixelsPerSecond - 4);
  if (note.nextAttack === undefined) return length;
  const spacing = Math.max(0, (note.nextAttack - note.time) * pixelsPerSecond);
  return Math.min(length, spacing - Math.min(4, spacing * 0.3));
}
