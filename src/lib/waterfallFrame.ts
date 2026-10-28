import { waterfallLength, type WaterfallNote } from "./waterfall";

/** Keep canvas fill/copy work bounded on high-density tablets. */
export function waterfallPixelRatio(
  width: number,
  height: number,
  density: number,
) {
  return Math.min(
    Math.max(1, density),
    1.5,
    Math.sqrt(2_000_000 / Math.max(1, width * height)),
  );
}

/** Align the 60 Hz budget to a deadline, instead of restarting it after every
 * paint (which drops to 48 Hz on a 144 Hz display and skips jittered 60 Hz frames). */
export class WaterfallFrameClock {
  private next = -Infinity;
  due(now: number, force = false) {
    const interval = 1000 / 60;
    if (!force && now + 0.5 < this.next) return false;
    this.next =
      force || now - this.next > interval
        ? now + interval
        : this.next + interval;
    return true;
  }
}

export interface WaterfallBar {
  note: WaterfallNote;
  x: number;
  y: number;
  width: number;
  height: number;
  bottom: number;
  active: boolean;
  leading: boolean;
  judgement?: string;
}

/** Clip before drawing: a held note can extend far beyond the viewport, but
 * its rounded path and hit rectangle always remain canvas-sized. */
export function waterfallBar(
  note: WaterfallNote,
  key: { x: number; width: number },
  seconds: number,
  target: number,
  scale: number,
  density: number,
  reuse?: WaterfallBar,
): WaterfallBar | null {
  const bottom = target - (note.time - seconds) * scale;
  const top = bottom - waterfallLength(note, scale);
  if (bottom < 22 || top > target) return null;
  const snap = (value: number) => Math.round(value * density) / density;
  const y = snap(Math.max(23, top)),
    edge = snap(Math.min(target, bottom)),
    height = edge - y;
  if (height <= 0) return null;
  const bar = reuse ?? ({} as WaterfallBar);
  bar.note = note;
  bar.x = key.x + 2;
  bar.width = Math.max(4, key.width - 4);
  bar.y = y;
  bar.height = height;
  bar.bottom = edge;
  bar.active =
    note.time <= seconds + 0.025 && note.time + note.duration > seconds;
  bar.leading = bottom <= target;
  return bar;
}

/** Full-height sustained bars often look identical for many seconds. Retain
 * those pixels while the lightweight visibility query keeps watching ahead. */
export function sameWaterfallBars(
  previous: readonly WaterfallBar[],
  next: readonly WaterfallBar[],
) {
  return (
    previous.length === next.length &&
    previous.every((a, i) => {
      const b = next[i];
      return (
        a.note === b.note &&
        a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height &&
        a.bottom === b.bottom &&
        a.active === b.active &&
        a.leading === b.leading &&
        a.judgement === b.judgement
      );
    })
  );
}
