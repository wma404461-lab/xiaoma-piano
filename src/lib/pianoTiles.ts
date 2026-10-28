import type { Hands, Song } from "../types";
import type { GameNote } from "./pianoGame";
import { awardHit, emptyGameScore } from "./gameScore";
import { getEvents } from "./music";
import { rangeTempoMap, TempoTimeline } from "./tempo";
import { waterfallNotes } from "./waterfall";
import { WaterfallNoteIndex } from "./waterfallIndex";

export type TileDifficulty = "easy" | "standard" | "challenge";
export const PIANO_TILE_LANES = 5;
/** Historical labels remain readable in saved practice records. */
export const LEGACY_INTENSITY = {
  easy: 1,
  standard: 50,
  challenge: 100,
} as const;
export const tileIntensity = (value: number | TileDifficulty) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(100, Math.round(value)))
    : (LEGACY_INTENSITY[value as TileDifficulty] ?? 50);
export const tileBeatSpan = (intensity: number) =>
  2 ** (-1 - tileIntensity(intensity) / 25);
export interface PianoTile {
  id: number;
  time: number;
  beat: number;
  lane: number;
  notes: GameNote[];
}

/** Musical subdivisions determine the chart, independently of practice speed. */
export class PianoTileEngine {
  readonly source: {
    notes: GameNote[];
    index: WaterfallNoteIndex;
    total: number;
  };
  readonly timeline: TempoTimeline;
  readonly tiles: PianoTile[] = [];
  readonly end: number;
  readonly intensity: number;
  cursor = 0;
  correct = 0;
  wrong = 0;
  missed = 0;
  lastMissed: PianoTile | undefined;
  score = emptyGameScore();
  feedback = "Tap tiles in order and follow the score's rhythm";
  constructor(
    song: Song,
    hands: Hands,
    tempo: number,
    intensity: number | TileDifficulty = 50,
  ) {
    this.intensity = tileIntensity(intensity);
    this.timeline = new TempoTimeline(
      rangeTempoMap(song, 0, song.measures.length - 1, tempo),
      tempo,
    );
    const events = getEvents(song, hands);
    const notes: GameNote[] = waterfallNotes(
      song,
      events,
      undefined,
      this.timeline,
    ).map((note) => ({ ...note, group: 0, state: "pending", hold: false }));
    this.source = {
      notes,
      index: new WaterfallNoteIndex(notes),
      total: events.length,
    };
    for (const note of notes) {
      const beat = this.timeline.beatAt(note.time);
      let tile = this.tiles.at(-1);
      if (
        !tile ||
        beat - tile.beat >= tileBeatSpan(this.intensity) - 1e-7 ||
        note.measure !== tile.notes[0].measure
      ) {
        const previous = tile?.lane;
        let lane = Math.floor(note.pitch / 2) % PIANO_TILE_LANES;
        if (lane === previous) lane = (lane + 1) % PIANO_TILE_LANES;
        tile = {
          id: this.tiles.length,
          time: note.time,
          beat,
          lane,
          notes: [],
        };
        this.tiles.push(tile);
      }
      tile.notes.push(note);
      note.group = tile.id;
    }
    this.end = notes.reduce(
      (end, note) => Math.max(end, note.time + note.duration),
      0,
    );
  }
  get total() {
    return this.tiles.length;
  }
  get next() {
    return this.tiles[this.cursor];
  }
  get progress() {
    return this.total ? this.cursor / this.total : 0;
  }
  get completed() {
    return this.total > 0 && this.cursor === this.total;
  }
  ready(_seconds: number, tile = this.next) {
    return !!tile && tile.id >= this.cursor;
  }
  miss() {
    const tile = this.next;
    if (!tile) return;
    this.cursor++;
    this.missed++;
    this.lastMissed = tile;
    this.score = { ...this.score, combo: 0 };
    this.feedback = "Miss · Combo broken. Keep playing.";
    for (const note of tile.notes) note.state = "missed";
    return tile;
  }
  /** Inputs can be early, but may never reorder the written melody. */
  press(lane: number, seconds: number, tileId = this.next?.id) {
    if (tileId === undefined || tileId < this.cursor || tileId >= this.total)
      return;
    const tile = this.tiles[tileId];
    if (tile !== this.next || lane !== tile.lane) {
      this.wrong++;
      this.score = { ...this.score, combo: 0 };
      this.feedback = "Tap the lowest tile in order to keep the melody's rhythm";
      return;
    }
    this.cursor++;
    this.correct++;
    for (const note of tile.notes) note.state = "hit";
    const hit = awardHit(
      this.score,
      Math.abs(this.timeline.beatAt(seconds) - tile.beat),
    );
    this.score = hit.score;
    this.feedback = hit.judgement;
    return tile;
  }
  preview(count = 20) {
    return this.tiles.slice(this.cursor, this.cursor + count);
  }
}
