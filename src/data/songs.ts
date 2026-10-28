import type { Song } from "../types";

// Generated technical exercise; no imported score, arrangement or recording.
export const songs: Song[] = [{
  id: "demo-c-major", title: "C Major Steps", subtitle: "Generated practice exercise",
  composer: "Xiaoma Piano", category: "Exercises", level: 1, tempo: 72,
  meter: 4, key: "C", color: "sage", motif: "steps",
  description: "Play four even beats per measure. Practise each hand separately, then together.",
  skills: ["Even quarter notes", "Hand coordination"],
  editionLabel: "Generated exercise", scoreNotice: "A technical scale pattern, not a transcription.",
  measures: [[60, 62, 64, 65], [67, 65, 64, 62]].map((pitches, measure) => ({
    right: pitches.map((pitch, beat) => ({id: `demo-r-${measure}-${beat}`, pitches: [pitch], beats: 1, beat, measure, hand: "right" as const})),
    left: [{id: `demo-l-${measure}`, pitches: [48], beats: 4, beat: 0, measure, hand: "left" as const}],
  })),
}];
export const songById = (id: string) => songs.find(song => song.id === id) ?? songs[0];
