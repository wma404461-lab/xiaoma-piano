import type { Song } from "../types";

/** Decoded scores contain note objects and large XML strings. Keep recent
 * scores without retaining every long piece visited during a session. */
export class ScoreCache {
  private entries = new Map<string, { song: Song; bytes: number }>();
  private bytes = 0;
  constructor(private maxBytes = 32 * 1024 * 1024, private maxEntries = 4) {}
  get size() { return this.entries.size; }
  get estimatedBytes() { return this.bytes; }
  has(id: string) { return this.entries.has(id); }
  get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id); this.entries.set(id, entry);
    return entry.song;
  }
  set(id: string, song: Song) {
    const previous = this.entries.get(id);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(id); }
    const notes = song.measures.reduce((sum, bar) => sum + bar.right.length + bar.left.length, 0);
    const bytes = 128 * 1024 + (song.xml?.length ?? 0) * 4 + notes * 512;
    this.entries.set(id, { song, bytes }); this.bytes += bytes;
    while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
    return this;
  }
}
