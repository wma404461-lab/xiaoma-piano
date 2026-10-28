import type { ExpectedEvent } from "../types";

export type NoteVerdict = "correct" | "partial" | "wrong";
export class ChordEvaluator {
  private collected = new Set<number>();
  private eventId = "";
  private started: number | null = null;
  private heldEventId = "";
  private attacks = new Set<number>();
  constructor(private windowMs = 650) {}
  reset() {
    this.collected.clear();
    this.eventId = "";
    this.started = null;
    this.heldEventId = "";
    this.attacks.clear();
  }
  accept(event: ExpectedEvent, pitch: number, time: number): NoteVerdict {
    if (
      event.id !== this.eventId ||
      (this.started !== null && time - this.started > this.windowMs)
    ) {
      this.collected.clear();
      this.eventId = event.id;
      this.started = time;
    }
    if (!event.pitches.includes(pitch)) {
      this.reset();
      return "wrong";
    }
    this.collected.add(pitch);
    if (event.pitches.every((p) => this.collected.has(p))) {
      this.reset();
      return "correct";
    }
    return "partial";
  }

  acceptHeld(
    event: ExpectedEvent,
    pitch: number,
    held: readonly number[],
  ): NoteVerdict {
    // Held keys have no timeout, but each written attack must be played again
    // in the next group. getEvents excludes notes that only continue a tie.
    if (this.heldEventId !== event.id) {
      this.heldEventId = event.id;
      this.attacks.clear();
    }
    for (const previous of this.attacks)
      if (!held.includes(previous)) this.attacks.delete(previous);
    if (!event.pitches.includes(pitch)) {
      this.reset();
      return "wrong";
    }
    if (held.includes(pitch)) this.attacks.add(pitch);
    if (event.pitches.every((p) => held.includes(p) && this.attacks.has(p))) {
      this.reset();
      return "correct";
    }
    return "partial";
  }
  acceptKeyboard(
    event: ExpectedEvent,
    pitch: number,
    held: readonly number[],
    time: number,
  ): NoteVerdict {
    const tapped = this.accept(event, pitch, time);
    if (tapped !== "partial") return tapped;
    const sustained = this.acceptHeld(event, pitch, held);
    // A held bass can outlive the tap window while the upper chord tones are
    // clicked in sequence. Only attacks from this group may supply held notes.
    if (
      sustained === "correct" ||
      event.pitches.every(
        (p) =>
          this.collected.has(p) || (held.includes(p) && this.attacks.has(p)),
      )
    ) {
      this.reset();
      return "correct";
    }
    return "partial";
  }
}
