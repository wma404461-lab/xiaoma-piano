import type { Hands, Song } from "../types";

export interface DemoSettings {
  hands: Hands;
  speedRatio: number;
  autoTurn: boolean;
  metronome: boolean;
}

/** Shuffle stays inside one family: pop with pop, classical with classical. */
export function sameFamilyPool(
  songs: readonly Song[],
  current: Song,
): readonly Song[] {
  const family = (category: string) =>
    category.includes("Popular")
      ? "Popular"
      : category.includes("Classical")
        ? "Classical"
        : category;
  const key = family(current.category);
  const pool = songs.filter((song) => family(song.category) === key);
  return pool.length > 1 ? pool : songs;
}

/** Keep IDs only: an all-night playlist must not retain loaded scores. */
export class DemoShuffleQueue {
  private remaining: string[] = [];
  constructor(private random = Math.random) {}

  next(songs: readonly Song[], currentId: string): string | undefined {
    const eligible = new Set(
      songs
        .filter(
          (song) =>
            song.id !== currentId &&
            (song.measures.length > 0 || !!song.scoreAsset),
        )
        .map((song) => song.id),
    );
    this.remaining = this.remaining.filter((id) => eligible.has(id));
    if (!this.remaining.length) {
      this.remaining = [...eligible];
      for (let i = this.remaining.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.max(0, Math.floor(this.random() * (i + 1))));
        [this.remaining[i], this.remaining[j]] = [
          this.remaining[j],
          this.remaining[i],
        ];
      }
    }
    return this.remaining.pop();
  }
}

/** Skip a few unavailable files, but never loop forever on a broken network. */
export async function playNextDemo(
  queue: DemoShuffleQueue,
  songs: readonly Song[],
  currentId: string,
  signal: AbortSignal,
  load: (song: Song) => Promise<boolean>,
): Promise<boolean> {
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 6 && !signal.aborted; attempt++) {
    const id = queue.next(songs, currentId);
    if (!id || tried.has(id)) return false;
    tried.add(id);
    const song = songs.find((song) => song.id === id)!;
    if (await load(song)) return !signal.aborted;
  }
  return false;
}
