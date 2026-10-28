import type { PianoTile } from "./pianoTiles";
import { tileBeatSpan } from "./pianoTiles";

/** Immutable chart coordinates: removing a tile never repacks the remaining ones. */
export class PianoTileLayout {
  readonly line: number;
  readonly blockHeight: number;
  readonly offsets: number[];
  private readonly scale: number;
  constructor(
    private readonly tiles: readonly PianoTile[],
    height: number,
    intensity: number,
  ) {
    this.line = Math.max(0, height - 66);
    const rows = Math.max(3, Math.min(9, Math.floor(this.line / 56)));
    this.scale = this.line / (rows * Math.max(0.25, tileBeatSpan(intensity)));
    this.blockHeight = Math.max(36, Math.min(80, this.line / rows - 8));
    const firstBeat = tiles[0]?.beat ?? 0;
    this.offsets = [];
    for (const tile of tiles)
      this.offsets.push(
        Math.max(
          (tile.beat - firstBeat) * this.scale,
          tile.id ? this.offsets[tile.id - 1] + this.blockHeight + 7 : 0,
        ),
      );
  }
  /** Continuous projection through dense passages, with original rests preserved. */
  scrollAt(beat: number) {
    if (!this.tiles.length) return 0;
    let low = 0,
      high = this.tiles.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.tiles[mid].beat <= beat) low = mid + 1;
      else high = mid;
    }
    const index = Math.max(0, low - 1);
    const current = this.tiles[index],
      next = this.tiles[index + 1];
    if (!next || beat < current.beat)
      return this.offsets[index] + (beat - current.beat) * this.scale;
    const fraction = (beat - current.beat) / (next.beat - current.beat);
    return (
      this.offsets[index] +
      fraction * (this.offsets[index + 1] - this.offsets[index])
    );
  }
  top(tileId: number, scroll: number) {
    return this.line + scroll - this.offsets[tileId] - this.blockHeight;
  }
}
