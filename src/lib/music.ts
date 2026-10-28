import type { ExpectedEvent, Hands, ScoreNote, Song } from "../types";
import { rangeTempoMap, TempoTimeline } from "./tempo";

const NATURAL: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
export function pitchToMidi(pitch: string): number {
  const match = /^([A-G])([#b]?)([0-8])$/.exec(pitch);
  if (!match) throw new Error(`Invalid pitch: ${pitch}`);
  return (
    (Number(match[3]) + 1) * 12 +
    NATURAL[match[1]] +
    (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0)
  );
}
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
export function frequencyToMidi(frequency: number): number {
  return Math.round(69 + 12 * Math.log2(frequency / 440));
}
export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
export function vexKey(midi: number): { key: string; accidental?: string } {
  const keys = [
    "c",
    "c#",
    "d",
    "eb",
    "e",
    "f",
    "f#",
    "g",
    "ab",
    "a",
    "bb",
    "b",
  ];
  const name = keys[midi % 12];
  return {
    key: `${name}/${Math.floor(midi / 12) - 1}`,
    accidental: name.length > 1 ? name[1] : undefined,
  };
}
export { numberedPitch, numberedKeyLabel } from "./numbered";
export function getEvents(
  song: Song,
  hands: Hands,
  start = 0,
  end = song.measures.length - 1,
): ExpectedEvent[] {
  const grouped = new Map<number, ExpectedEvent>();
  let offsetBeat = 0;
  song.measures.slice(start, end + 1).forEach((measure) => {
    const notes =
      hands === "both" ? [...measure.right, ...measure.left] : measure[hands];
    notes
      .filter((n) => (n.attackPitches ?? n.pitches).length > 0)
      .forEach((n) => {
        const beat = Math.round((offsetBeat + n.beat) * 1e6) / 1e6;
        const pitches = n.attackPitches ?? n.pitches;
        const previous = grouped.get(beat);
        if (previous) {
          previous.pitches = [...new Set([...previous.pitches, ...pitches])];
          pitches.forEach((p) => {
            previous.durations[p] = Math.max(
              previous.durations[p] ?? 0,
              n.playDurations?.[p] ?? n.beats,
            );
          });
          previous.noteIds.push(n.id);
        } else {
          grouped.set(beat, {
            id: n.id,
            beat,
            beats: n.beats,
            measure: n.measure,
            pitches: [...pitches],
            durations: Object.fromEntries(
              pitches.map((p) => [p, n.playDurations?.[p] ?? n.beats]),
            ),
            noteIds: [n.id],
            localBeat: n.beat,
          });
        }
      });
    offsetBeat += measure.duration ?? song.meter;
  });
  return [...grouped.values()].sort((a, b) => a.beat - b.beat);
}
export function scoreDuration(song: Song, tempo = song.tempo) {
  if (song.measures.length && song.tempoMap?.length)
    return Math.ceil(new TempoTimeline(rangeTempoMap(song, 0, song.measures.length - 1, tempo), tempo)
      .secondsAt(rangeBeats(song, 0, song.measures.length - 1)));
  return (
    (song.durationSeconds
      ? Math.ceil((song.durationSeconds * song.tempo) / tempo)
      : undefined) ??
    Math.ceil(
      ((song.measures.length
        ? rangeBeats(song, 0, song.measures.length - 1)
        : (song.measureCount ?? 0) * song.meter) *
        60) /
        tempo,
    )
  );
}
export function rangeBeats(song: Song, from: number, to: number) {
  return song.measures
    .slice(from, to + 1)
    .reduce((sum, m) => sum + (m.duration ?? song.meter), 0);
}
export function durationText(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export function notationDuration(note: ScoreNote): {
  duration: string;
  dots: number;
} {
  const map: Record<number, string> = {
    4: "w",
    2: "h",
    1: "q",
    0.5: "8",
    0.25: "16",
  };
  const dotted: Record<number, string> = { 3: "h", 1.5: "q", 0.75: "8" };
  const duration = map[note.beats] ?? dotted[note.beats] ?? "q";
  return {
    duration: duration + (note.pitches.length ? "" : "r"),
    dots: dotted[note.beats] ? 1 : 0,
  };
}
