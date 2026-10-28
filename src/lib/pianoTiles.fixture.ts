import type { Song } from "../types";
export function tilePiece(
  notes: { beat: number; beats: number; pitches: number[] }[],
): Song {
  return {
    id: "tiles",
    title: "Tiles",
    tempo: 120,
    meter: 4,
    subtitle: "",
    composer: "",
    category: "My scores",
    level: 1,
    key: "C",
    color: "",
    motif: "",
    description: "",
    skills: [],
    measures: [
      {
        left: [],
        right: notes.map((note, index) => ({
          ...note,
          id: String(index),
          hand: "right",
          measure: 0,
        })),
      },
    ],
  };
}
