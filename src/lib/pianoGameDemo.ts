import { PianoGameEngine, type GameNote } from "./pianoGame";

/** Runs real engine key presses in score order. The caller keeps demos out of history. */
export class PianoGameDemo {
  private cursor = 0;
  private sounding = new Map<number, GameNote>();
  private suspended: number[] = [];
  private flashes = new Map<number, number>();

  constructor(private readonly game: PianoGameEngine) {}

  suspend() {
    this.suspended = this.game.holdingPitches;
    this.sounding.clear();
    this.flashes.clear();
  }

  advance(seconds: number) {
    const attacks: GameNote[] = [];
    const previous = this.sounding;
    for (const pitch of this.suspended) {
      const note = this.game.press(pitch, seconds);
      if (note) attacks.push(note);
    }
    this.suspended = [];
    // Process attacks before advancing to the frame's end, including dense passages.
    while (
      this.cursor < this.game.notes.length &&
      this.game.notes[this.cursor].time <= seconds
    ) {
      const target = this.game.notes[this.cursor++];
      this.game.tick(target.time);
      const note = this.game.press(target.pitch, target.time);
      if (note) attacks.push(note);
    }
    this.game.tick(seconds);
    const releases = [...previous]
      .filter(([, note]) => note.state !== "holding")
      .map(([pitch]) => pitch);
    this.sounding = new Map(
      [...previous].filter(([, note]) => note.state === "holding"),
    );
    for (const note of attacks) {
      this.flashes.set(note.pitch, seconds + 0.12);
      if (note.state === "holding") this.sounding.set(note.pitch, note);
    }
    return { attacks, releases };
  }

  pressedPitches(seconds: number) {
    for (const [pitch, end] of this.flashes)
      if (end <= seconds) this.flashes.delete(pitch);
    return [...new Set([...this.flashes.keys(), ...this.game.holdingPitches])];
  }
}
