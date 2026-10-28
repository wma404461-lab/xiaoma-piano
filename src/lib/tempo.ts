import type { Song, TempoPoint } from "../types";

/** Integrate the written tempo changes, with reversible beat/time conversion. */
export class TempoTimeline {
  readonly points: TempoPoint[];
  readonly times: number[];
  constructor(points: TempoPoint[], fallback: number) {
    const byBeat = new Map<number, number>([[0, fallback]]);
    for (const point of points)
      if (Number.isFinite(point.beat) && point.beat >= 0 && Number.isFinite(point.bpm) && point.bpm > 0)
        byBeat.set(point.beat, point.bpm);
    this.points = [...byBeat].sort((a, b) => a[0] - b[0]).map(([beat, bpm]) => ({ beat, bpm }));
    this.times = [0];
    for (let i = 1; i < this.points.length; i++)
      this.times.push(this.times[i - 1] + (this.points[i].beat - this.points[i - 1].beat) * 60 / this.points[i - 1].bpm);
  }
  private index(value: number, positions: readonly number[]) {
    let low = 0, high = positions.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (positions[mid] <= value) low = mid; else high = mid - 1;
    }
    return low;
  }
  private atBeat(beat: number) {
    let low = 0, high = this.points.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.points[mid].beat <= beat) low = mid; else high = mid - 1;
    }
    return low;
  }
  secondsAt(beat: number) {
    const i = this.atBeat(beat), point = this.points[i];
    return this.times[i] + (beat - point.beat) * 60 / point.bpm;
  }
  beatAt(seconds: number) {
    const i = this.index(seconds, this.times), point = this.points[i];
    return point.beat + (seconds - this.times[i]) * point.bpm / 60;
  }
  bpmAt(beat: number) { return this.points[this.atBeat(beat)].bpm; }
}

/** Practice speed scales every original tempo together, including range starts. */
export function rangeTempoMap(song: Song, from = 0, to = song.measures.length - 1, tempo = song.tempo): TempoPoint[] {
  const start = song.measures.slice(0, from).reduce((sum, bar) => sum + (bar.duration ?? song.meter), 0);
  const length = song.measures.slice(from, to + 1).reduce((sum, bar) => sum + (bar.duration ?? song.meter), 0);
  const original = new TempoTimeline(song.tempoMap ?? [], song.tempo);
  const scale = tempo / song.tempo;
  return [{ beat: 0, bpm: original.bpmAt(start) * scale }, ...original.points
    .filter(point => point.beat > start && point.beat < start + length)
    .map(point => ({ beat: point.beat - start, bpm: point.bpm * scale }))];
}

export function practiceBeatAt(clock: TempoTimeline, startBeat: number, startTime: number, now: number) {
  return clock.beatAt(clock.secondsAt(startBeat) + (now - startTime) / 1000);
}
