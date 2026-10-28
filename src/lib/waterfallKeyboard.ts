const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

/** Match Keyboard.tsx's 52 white keys and 62%-width centered black keys. */
export function waterfallKeyboardKeys(width: number, left = 0) {
  const unit = width / 52;
  const keys = new Map<number, { x: number; width: number }>();
  let precedingWhites = 0;
  for (let pitch = 21; pitch <= 108; pitch++) {
    const white = WHITE_CLASSES.has(pitch % 12);
    keys.set(pitch, {
      x: left + precedingWhites * unit - (white ? 0 : unit * 0.31),
      width: unit * (white ? 1 : 0.62),
    });
    if (white) precedingWhites++;
  }
  return keys;
}
