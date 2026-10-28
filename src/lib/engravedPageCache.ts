import type { Song } from "../types";

/** Static markup only, never live DOM, closures, highlights or practice state. */
export class EngravedPageCache {
  private entries = new Map<
    string,
    { xml: string | undefined; markup: string; bytes: number }
  >();
  private bytes = 0;
  constructor(
    private maxBytes = 8 * 1024 * 1024,
    private maxEntries = 8,
  ) {}
  get size() {
    return this.entries.size;
  }
  get estimatedBytes() {
    return this.bytes;
  }
  private key(song: Song, width: number, first: number, count: number) {
    return JSON.stringify([song.id, width, first, count]);
  }
  get(song: Song, width: number, first: number, count: number) {
    const key = this.key(song, width, first, count),
      entry = this.entries.get(key);
    if (!entry) return;
    if (entry.xml !== song.xml) {
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.markup;
  }
  set(song: Song, width: number, first: number, count: number, markup: string) {
    const key = this.key(song, width, first, count),
      old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
    }
    const bytes = ((song.xml?.length ?? 0) + markup.length) * 2;
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { xml: song.xml, markup, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(first)!.bytes;
      this.entries.delete(first);
    }
  }
}
