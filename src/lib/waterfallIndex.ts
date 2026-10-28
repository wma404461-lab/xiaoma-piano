import type { WaterfallNote } from "./waterfall";

/** Index immutable notes already sorted by time. A long held note does not
 * force each frame to scan all shorter notes played after its attack. */
export class WaterfallNoteIndex {
  private readonly leafCount: number;
  private readonly maxEnd: Float64Array;
  private visited = 0;

  constructor(private readonly notes: readonly WaterfallNote[]) {
    let leaves = 1;
    while (leaves < notes.length) leaves *= 2;
    this.leafCount = leaves;
    this.maxEnd = new Float64Array(leaves * 2);
    this.maxEnd.fill(-Infinity);
    for (let i = 0; i < notes.length; i++)
      this.maxEnd[leaves + i] = notes[i].time + notes[i].duration;
    for (let i = leaves - 1; i > 0; i--)
      this.maxEnd[i] = Math.max(this.maxEnd[i * 2], this.maxEnd[i * 2 + 1]);
  }

  get visitedNodes() {
    return this.visited;
  }

  visible(
    seconds: number,
    horizon: number,
    minimumSeconds = 0,
  ): readonly WaterfallNote[] {
    this.visited = 0;
    const until = seconds + horizon;
    if (
      !this.notes.length ||
      Number.isNaN(until) ||
      Number.isNaN(minimumSeconds)
    )
      return [];
    const minimum = Math.max(0, minimumSeconds),
      visible: WaterfallNote[] = [];
    const visit = (node: number, left: number, right: number) => {
      this.visited++;
      if (
        left >= this.notes.length ||
        this.notes[left].time >= until ||
        // Equivalent to maxEnd < seconds - minimum, without subtraction
        // rounding an exact minimum-height boundary above a zero-length note.
        this.maxEnd[node] + minimum < seconds
      )
        return;
      if (right - left === 1) {
        const note = this.notes[left];
        if (note.time + Math.max(note.duration, minimum) >= seconds)
          visible.push(note);
        return;
      }
      const middle = left + (right - left) / 2;
      visit(node * 2, left, middle);
      visit(node * 2 + 1, middle, right);
    };
    visit(1, 0, this.leafCount);
    return visible;
  }
}
