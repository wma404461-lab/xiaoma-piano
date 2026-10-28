interface PointerPosition {
  x: number;
  y: number;
  pitch: number | null;
}

/** Track each finger separately, including key crossings between move events. */
export class PianoGesture {
  private pointers = new Map<number, PointerPosition>();
  constructor(
    private owner: string,
    private hitTest: (x: number, y: number) => number | null,
    private press: (pitch: number, owner: string) => void,
    private release: (pitch: number, owner: string) => void,
  ) {}
  get active() {
    return this.pointers.size > 0;
  }
  private transition(
    id: number,
    pointer: PointerPosition,
    pitch: number | null,
  ) {
    if (pointer.pitch === pitch) return;
    const owner = `${this.owner}:pointer:${id}`;
    if (pointer.pitch !== null) this.release(pointer.pitch, owner);
    pointer.pitch = pitch;
    if (pitch !== null) this.press(pitch, owner);
  }
  start(id: number, x: number, y: number) {
    this.end(id);
    const pointer = { x, y, pitch: null };
    this.pointers.set(id, pointer);
    this.transition(id, pointer, this.hitTest(x, y));
  }
  move(id: number, x: number, y: number) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    const dx = x - pointer.x,
      dy = y - pointer.y;
    const steps = Math.min(512, Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3)));
    for (let step = 1; step <= steps; step++)
      this.transition(
        id,
        pointer,
        this.hitTest(
          pointer.x + (dx * step) / steps,
          pointer.y + (dy * step) / steps,
        ),
      );
    pointer.x = x;
    pointer.y = y;
  }
  end(id: number) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.transition(id, pointer, null);
    this.pointers.delete(id);
  }
  clear() {
    for (const id of this.pointers.keys()) this.end(id);
  }
}
